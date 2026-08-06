import type { Context } from 'hono'

export type SseMessage = {
  data: string
  event?: string
  id?: string
  retry?: number
}

export type SseConnection = {
  readonly signal: AbortSignal
  write(message: SseMessage): Promise<void>
  sleep(milliseconds: number): Promise<boolean>
}

const encoder = new TextEncoder()

function field(value: string): string {
  return value.replace(/[\r\n]/g, '')
}

function encodeMessage(message: SseMessage): Uint8Array {
  const lines: string[] = []
  if (message.event) lines.push(`event: ${field(message.event)}`)
  if (message.id) lines.push(`id: ${field(message.id)}`)
  if (message.retry !== undefined) lines.push(`retry: ${Math.max(0, Math.floor(message.retry))}`)
  for (const line of message.data.split(/\r?\n/)) lines.push(`data: ${line}`)
  return encoder.encode(`${lines.join('\n')}\n\n`)
}

export function streamServerEvents(
  context: Context,
  producer: (connection: SseConnection) => Promise<void>,
): Response {
  const lifecycle = new AbortController()
  let finished = false

  const abort = (reason?: unknown) => {
    if (!lifecycle.signal.aborted) lifecycle.abort(reason)
  }
  const requestSignal = context.req.raw.signal
  const onRequestAbort = () => abort(requestSignal.reason)
  if (requestSignal.aborted) abort(requestSignal.reason)
  else requestSignal.addEventListener('abort', onRequestAbort, { once: true })

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      const connection: SseConnection = {
        signal: lifecycle.signal,
        async write(message) {
          if (lifecycle.signal.aborted || finished) throw lifecycle.signal.reason ?? new Error('sse_connection_closed')
          try {
            streamController.enqueue(encodeMessage(message))
          } catch (error) {
            abort(error)
            throw error
          }
        },
        sleep(milliseconds) {
          if (lifecycle.signal.aborted || finished) return Promise.resolve(false)
          return new Promise(resolve => {
            const timer = setTimeout(() => {
              lifecycle.signal.removeEventListener('abort', onAbort)
              resolve(true)
            }, Math.max(0, milliseconds))
            const onAbort = () => {
              clearTimeout(timer)
              resolve(false)
            }
            lifecycle.signal.addEventListener('abort', onAbort, { once: true })
          })
        },
      }

      void producer(connection)
        .catch(error => {
          if (!lifecycle.signal.aborted) console.error('SSE producer failed', error)
        })
        .finally(() => {
          finished = true
          requestSignal.removeEventListener('abort', onRequestAbort)
          try { streamController.close() } catch { /* The consumer already closed the stream. */ }
          abort('sse_producer_finished')
        })
    },
    cancel(reason) {
      finished = true
      abort(reason ?? 'sse_consumer_cancelled')
    },
  })

  context.header('Content-Type', 'text/event-stream; charset=UTF-8')
  context.header('Cache-Control', 'no-cache, no-transform')
  context.header('Connection', 'keep-alive')
  context.header('X-Accel-Buffering', 'no')
  return context.body(body)
}
