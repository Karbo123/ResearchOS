import { request as httpRequest } from 'node:http'
import type { ClientRequest, IncomingMessage, RequestOptions as HttpRequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Socket } from 'node:net'
import { Readable } from 'node:stream'
import { connect as tlsConnect } from 'node:tls'
import { privateModelSettings } from './model-settings.js'
import { isPrivateModelUrl } from './model-url.js'

interface FetchResult {
  status: number
  statusText: string
  headers: Record<string, string>
  stream: Readable
}

type NodeRequestOptions = HttpRequestOptions & { createConnection?: () => Socket }
type NodeRequestFunction = (options: NodeRequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest
type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function nodeRequest(isHttps: boolean): NodeRequestFunction {
  return (isHttps ? httpsRequest : httpRequest) as unknown as NodeRequestFunction
}

async function serializeBody(init: RequestInit): Promise<{ buffer: Buffer | null; contentType: string | null }> {
  const body = init.body
  if (body === null || body === undefined) return { buffer: null, contentType: null }
  if (typeof body === 'string') return { buffer: Buffer.from(body), contentType: 'text/plain;charset=UTF-8' }
  if (body instanceof URLSearchParams) {
    return { buffer: Buffer.from(body.toString()), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' }
  }
  if (body instanceof FormData) {
    const formResponse = new Response(body)
    return { buffer: Buffer.from(await formResponse.arrayBuffer()), contentType: formResponse.headers.get('content-type') }
  }
  if (body instanceof ArrayBuffer) return { buffer: Buffer.from(body), contentType: null }
  if (ArrayBuffer.isView(body)) {
    return { buffer: Buffer.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)), contentType: null }
  }
  if (body instanceof Blob) return { buffer: Buffer.from(await body.arrayBuffer()), contentType: body.type || null }
  if (body instanceof ReadableStream) {
    const chunks: Uint8Array[] = []
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return { buffer: Buffer.concat(chunks.map(chunk => Buffer.from(chunk))), contentType: null }
  }
  throw new TypeError('proxyFetch does not support this request body type')
}

function performNodeRequest(
  requestFn: NodeRequestFunction,
  options: NodeRequestOptions,
  body: Buffer | null,
  signal: AbortSignal | null,
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const requestOptions: NodeRequestOptions = signal ? { ...options, signal } : options
    const request = requestFn(requestOptions, response => {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(response.headers)) {
        if (value === undefined) continue
        headers[key] = Array.isArray(value) ? value.join(', ') : value
      }
      if (signal?.aborted) response.destroy()
      else signal?.addEventListener('abort', () => response.destroy(), { once: true })
      resolve({ status: response.statusCode ?? 0, statusText: response.statusMessage ?? '', headers, stream: response })
    })
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function directRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  signal: AbortSignal | null,
): Promise<FetchResult> {
  const options: NodeRequestOptions = {
    method,
    headers,
    hostname: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    path: `${url.pathname}${url.search}`,
  }
  return performNodeRequest(nodeRequest(url.protocol === 'https:'), options, body, signal)
}

function httpProxyRequest(
  url: URL,
  proxy: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  signal: AbortSignal | null,
): Promise<FetchResult> {
  const proxyPort = proxy.port ? Number(proxy.port) : proxy.protocol === 'https:' ? 443 : 80
  const options: NodeRequestOptions = {
    method,
    headers: { ...headers, host: url.host },
    hostname: proxy.hostname,
    ...(proxyPort ? { port: proxyPort } : {}),
    path: url.href,
  }
  return performNodeRequest(nodeRequest(proxy.protocol === 'https:'), options, body, signal)
}

function openTunnel(proxy: URL, target: URL, signal: AbortSignal | null): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const proxyPort = proxy.port ? Number(proxy.port) : proxy.protocol === 'https:' ? 443 : 80
    const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80')
    const authority = `${target.hostname}:${targetPort}`
    const options: NodeRequestOptions = {
      method: 'CONNECT',
      headers: { host: authority },
      hostname: proxy.hostname,
      ...(proxyPort ? { port: proxyPort } : {}),
      path: authority,
    }
    const request = nodeRequest(proxy.protocol === 'https:')(signal ? { ...options, signal } : options, () => undefined)
    request.on('connect', (_response, socket) => resolve(socket))
    request.on('error', reject)
    request.end()
  })
}

function secureSocket(rawSocket: Socket, target: URL): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tlsConnect({
      socket: rawSocket,
      host: target.hostname,
      servername: target.hostname,
      port: Number(target.port || 443),
    })
    tlsSocket.once('secureConnect', () => resolve(tlsSocket))
    tlsSocket.once('error', reject)
  })
}

async function tunneledHttpsRequest(
  url: URL,
  proxy: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  signal: AbortSignal | null,
): Promise<FetchResult> {
  const rawSocket = await openTunnel(proxy, url, signal)
  const tlsSocket = await secureSocket(rawSocket, url)
  const options: NodeRequestOptions = {
    method,
    headers,
    hostname: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    path: `${url.pathname}${url.search}`,
    createConnection: () => tlsSocket,
  }
  return performNodeRequest(nodeRequest(true), options, body, signal)
}

function toWebStream(stream: Readable, signal: AbortSignal | null): ReadableStream<Uint8Array> {
  if (signal?.aborted) stream.destroy()
  else signal?.addEventListener('abort', () => stream.destroy(), { once: true })
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return new URL(input.href)
  return new URL(input.url)
}

async function proxyRequest(
  url: URL,
  proxy: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  signal: AbortSignal | null,
): Promise<FetchResult> {
  if (url.protocol === 'http:') return httpProxyRequest(url, proxy, method, headers, body, signal)
  return tunneledHttpsRequest(url, proxy, method, headers, body, signal)
}

export function createProxyFetch(options: { useProxy?: boolean } = {}): FetchFunction {
  return async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = requestUrl(input)
    const proxySettings = privateModelSettings().proxy
    const proxyUrl = proxySettings.url.trim()
    const headers = new Headers(init.headers)
    const { buffer, contentType } = await serializeBody(init)
    if (contentType && !headers.has('content-type')) headers.set('content-type', contentType)
    const headerRecord: Record<string, string> = {}
    for (const [key, value] of headers.entries()) headerRecord[key] = value
    const method = (init.method || 'GET').toUpperCase()
    const signal = init.signal ?? null
    const useProxy = options.useProxy === true && Boolean(proxyUrl) && !isPrivateModelUrl(url)
    const result = useProxy
      ? await proxyRequest(url, new URL(proxyUrl), method, headerRecord, buffer, signal)
      : await directRequest(url, method, headerRecord, buffer, signal)
    return new Response(toWebStream(result.stream, signal), {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    })
  }
}

export function proxyFetch(): FetchFunction {
  return createProxyFetch({ useProxy: false })
}
