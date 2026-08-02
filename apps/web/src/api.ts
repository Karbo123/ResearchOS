import { dictionaries, getLocale, type TranslationKey } from './i18n'

const CHAT_REQUEST_TIMEOUT_MS = 300_000

function localize(key: TranslationKey): string {
  return dictionaries[getLocale()][key]
}

const CHAT_ERROR_KEYS: Record<string, TranslationKey> = {
  timeout: 'errors.timeout',
  offline: 'errors.offline',
}

export class ChatRequestError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'ChatRequestError'
    this.code = code
    this.cause = cause
  }
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = CHAT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : CHAT_REQUEST_TIMEOUT_MS
  const timer = window.setTimeout(() => controller.abort(), timeout)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ChatRequestError('timeout', '', error)
    }
    if (error instanceof TypeError) {
      throw new ChatRequestError('offline', '', error)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function messageFromErrorBody(body: unknown, status: number, statusText: string): string {
  if (!body || typeof body !== 'object') return `${status} ${statusText}`
  const record = body as Record<string, unknown>
  const detail = record.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const nested = detail as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message
  }
  return typeof record.message === 'string' ? record.message : `${status} ${statusText}`
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = CHAT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const { headers, ...rest } = init
  const response = await fetchWithTimeout(
    window.fetch.bind(window),
    path,
    {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    },
    timeoutMs,
  )
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(messageFromErrorBody(body, response.status, response.statusText))
  }
  return (await response.json()) as T
}

export async function uploadFile(sessionId: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('session_id', sessionId)
  form.append('file', file)
  const response = await fetchWithTimeout(
    window.fetch.bind(window),
    '/api/uploads',
    { method: 'POST', body: form },
    CHAT_REQUEST_TIMEOUT_MS,
  )
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const reason = messageFromErrorBody(body, response.status, response.statusText)
    throw new Error(`${file.name}: ${reason}`)
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ChatRequestError) {
    const key = CHAT_ERROR_KEYS[error.code]
    if (key) return localize(key)
  }
  return error instanceof Error && error.message ? error.message : localize('errors.requestFailed')
}
