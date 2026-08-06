import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { streamServerEvents } from '../src/sse.js'

const decoder = new TextDecoder()

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition_not_reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('native SSE lifecycle', () => {
  it('stays open after the initial event and aborts its producer on cancellation', async () => {
    const app = new Hono()
    let active = 0
    let polls = 0
    app.get('/events', context => streamServerEvents(context, async stream => {
      active += 1
      try {
        await stream.write({ event: 'snapshot', data: '{"version":1}' })
        while (await stream.sleep(10)) polls += 1
      } finally {
        active -= 1
      }
    }))

    const response = await app.request('/events')
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const initial = await reader.read()
    expect(initial.done).toBe(false)
    expect(decoder.decode(initial.value)).toContain('event: snapshot')
    await waitFor(() => polls >= 2)
    expect(active).toBe(1)

    await reader.cancel('test_disconnect')
    await waitFor(() => active === 0)
    const pollsAfterCancel = polls
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(polls).toBe(pollsAfterCancel)
  })

  it('does not retain producers after repeated connect and disconnect cycles', async () => {
    const app = new Hono()
    let active = 0
    let completed = 0
    app.get('/events', context => streamServerEvents(context, async stream => {
      active += 1
      try {
        await stream.write({ data: 'ready' })
        while (await stream.sleep(10)) { /* Keep the request alive until cancellation. */ }
      } finally {
        active -= 1
        completed += 1
      }
    }))

    for (let index = 0; index < 20; index += 1) {
      const response = await app.request('/events')
      const reader = response.body!.getReader()
      expect((await reader.read()).done).toBe(false)
      await reader.cancel()
    }

    await waitFor(() => completed === 20)
    expect(active).toBe(0)
  })

  it('closes the stream when the HTTP request signal aborts', async () => {
    const app = new Hono()
    const request = new AbortController()
    let active = false
    app.get('/events', context => streamServerEvents(context, async stream => {
      active = true
      try {
        await stream.write({ data: 'ready' })
        while (await stream.sleep(10)) { /* Keep the request alive until cancellation. */ }
      } finally {
        active = false
      }
    }))

    const response = await app.request('/events', { signal: request.signal })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    request.abort('request_disconnected')
    await waitFor(() => !active)
    expect((await reader.read()).done).toBe(true)
  })
})
