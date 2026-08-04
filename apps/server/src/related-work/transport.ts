import type { RelatedWorkProvider, SourceAttempt, SourceFailure, SourceSearchOptions } from './contracts.js'
import { sourceAttempt, sourceFailure } from './contracts.js'

export type FetchImplementation = typeof fetch

export class ProviderRequestError extends Error {
  constructor(
    public readonly code: SourceFailure['code'],
    message: string,
    public readonly retryable: boolean,
    public readonly http_status: number | null = null,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

export type RequestPayload = {
  provider: RelatedWorkProvider
  query: string
  request_url: string
  options: SourceSearchOptions
  fetch_impl: FetchImplementation
  headers?: Record<string, string>
}

type RequestResult<T> = {
  value: T | null
  attempt: SourceAttempt
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BODY_CHARS = 5_000_000
const RETRY_DELAYS_MS = [250, 500]

function userAgent(options: SourceSearchOptions): string {
  return options.user_agent || process.env.RESEARCH_USER_AGENT || 'ResearchOS/0.3 (local research tool)'
}

function failureFromError(error: unknown): ProviderRequestError {
  if (error instanceof ProviderRequestError) return error
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ProviderRequestError('timed_out', 'source request timed out', true)
  }
  return new ProviderRequestError('request_failed', 'source request failed', true)
}

function statusFor(error: ProviderRequestError): SourceAttempt['status'] {
  if (error.code === 'rate_limited') return 'rate_limited'
  if (error.code === 'timed_out') return 'timed_out'
  if (error.code === 'invalid_response') return 'invalid_response'
  if (error.code === 'cancelled') return 'cancelled'
  return 'failed'
}

function makeFailure(error: ProviderRequestError): SourceFailure {
  return sourceFailure.parse({
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    http_status: error.http_status,
  })
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

async function readBody(response: Response): Promise<string> {
  const body = await response.text()
  if (body.length > MAX_BODY_CHARS) throw new ProviderRequestError('invalid_response', 'source response exceeds the size limit', false, response.status)
  return body
}

async function requestBody({ provider, query, request_url, options, fetch_impl, headers = {} }: RequestPayload): Promise<{ body: string; status: number }> {
  const timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (options.signal?.aborted) throw new ProviderRequestError('cancelled', 'source request was cancelled', false)
    try {
      const response = await fetch_impl(request_url, {
        headers: {
          ...headers,
          accept: 'application/json, application/atom+xml, application/xml, text/xml',
          'user-agent': userAgent(options),
        },
        signal,
      })
      if (response.status === 429) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await wait(RETRY_DELAYS_MS[attempt] ?? 0)
          continue
        }
        throw new ProviderRequestError('rate_limited', `${provider} rate limit reached`, true, response.status)
      }
      if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        await wait(RETRY_DELAYS_MS[attempt] ?? 0)
        continue
      }
      if (!response.ok) throw new ProviderRequestError('http_error', `${provider} returned HTTP ${response.status}`, response.status >= 500, response.status)
      return { body: await readBody(response), status: response.status }
    } catch (error) {
      const requestError = failureFromError(error)
      if (requestError.code === 'request_failed' && options.signal?.aborted) {
        throw new ProviderRequestError('cancelled', 'source request was cancelled', false)
      }
      if (requestError.code === 'timed_out' && options.signal?.aborted) {
        throw new ProviderRequestError('cancelled', 'source request was cancelled', false)
      }
      if (requestError.retryable && attempt < RETRY_DELAYS_MS.length && requestError.code !== 'timed_out') {
        await wait(RETRY_DELAYS_MS[attempt] ?? 0)
        continue
      }
      throw requestError
    }
  }
  throw new ProviderRequestError('request_failed', 'source request failed', true)
}

export async function requestJson(payload: RequestPayload): Promise<RequestResult<unknown>> {
  const startedAt = new Date().toISOString()
  try {
    const response = await requestBody(payload)
    let value: unknown
    try {
      value = JSON.parse(response.body)
    } catch {
      throw new ProviderRequestError('invalid_response', 'source response is not valid JSON', false, response.status)
    }
    return {
      value,
      attempt: sourceAttempt.parse({
        provider: payload.provider,
        query: payload.query,
        request_url: payload.request_url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'succeeded',
        http_status: response.status,
        result_count: 0,
        failure: null,
      }),
    }
  } catch (error) {
    const requestError = failureFromError(error)
    return {
      value: null,
      attempt: sourceAttempt.parse({
        provider: payload.provider,
        query: payload.query,
        request_url: payload.request_url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: statusFor(requestError),
        http_status: requestError.http_status,
        result_count: 0,
        failure: makeFailure(requestError),
      }),
    }
  }
}

export async function requestXml(payload: RequestPayload): Promise<RequestResult<string>> {
  const startedAt = new Date().toISOString()
  try {
    const response = await requestBody(payload)
    return {
      value: response.body,
      attempt: sourceAttempt.parse({
        provider: payload.provider,
        query: payload.query,
        request_url: payload.request_url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'succeeded',
        http_status: response.status,
        result_count: 0,
        failure: null,
      }),
    }
  } catch (error) {
    const requestError = failureFromError(error)
    return {
      value: null,
      attempt: sourceAttempt.parse({
        provider: payload.provider,
        query: payload.query,
        request_url: payload.request_url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: statusFor(requestError),
        http_status: requestError.http_status,
        result_count: 0,
        failure: makeFailure(requestError),
      }),
    }
  }
}

export async function requestText(payload: RequestPayload): Promise<RequestResult<string>> {
  const startedAt = new Date().toISOString()
  try {
    const response = await requestBody(payload)
    return {
      value: response.body,
      attempt: sourceAttempt.parse({
        provider: payload.provider,
        query: payload.query,
        request_url: payload.request_url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'succeeded',
        http_status: response.status,
        result_count: 0,
        failure: null,
      }),
    }
  } catch (error) {
    const requestError = failureFromError(error)
    return {
      value: null,
      attempt: sourceAttempt.parse({
        provider: payload.provider,
        query: payload.query,
        request_url: payload.request_url,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: statusFor(requestError),
        http_status: requestError.http_status,
        result_count: 0,
        failure: makeFailure(requestError),
      }),
    }
  }
}

export function invalidResponseAttempt(attempt: SourceAttempt, message: string): SourceAttempt {
  return sourceAttempt.parse({
    ...attempt,
    status: 'invalid_response',
    result_count: 0,
    failure: {
      code: 'invalid_response',
      message,
      retryable: false,
      http_status: attempt.http_status,
    },
  })
}
