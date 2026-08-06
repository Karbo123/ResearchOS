import { describe, expect, it } from 'vitest'
import { startTaskWorkerDispatcher } from '../src/task-worker-dispatcher.js'
import { isFatalDatabaseError } from '../src/task-worker.js'

async function delay(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

describe('task worker dispatcher', () => {
  it('backs off idle claims instead of polling once per worker every 250ms', async () => {
    let claims = 0
    const worker = startTaskWorkerDispatcher({
      async claim() { claims += 1; return null },
      async execute() { throw new Error('no task should execute') },
      async heartbeat() {},
      isFatal: () => false,
      onFatal() {},
      onError(error) { throw error },
    }, {
      concurrency: 4,
      minimumIdleDelayMs: 10,
      maximumIdleDelayMs: 40,
      heartbeatIntervalMs: 1_000,
      workerId: sequence => `idle-${sequence}`,
    })

    await delay(145)
    worker.stop()
    await worker.done
    expect(claims).toBeGreaterThanOrEqual(4)
    expect(claims).toBeLessThanOrEqual(7)
  })

  it('fills available concurrency and wakes immediately when a task finishes', async () => {
    const queue = [1, 2, 3]
    const started: number[] = []
    let maximumActive = 0
    let active = 0
    const worker = startTaskWorkerDispatcher<number>({
      async claim() { return queue.shift() ?? null },
      async execute(task) {
        started.push(task)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await delay(20)
        active -= 1
      },
      async heartbeat() {},
      isFatal: () => false,
      onFatal() {},
      onError(error) { throw error },
    }, {
      concurrency: 2,
      minimumIdleDelayMs: 100,
      maximumIdleDelayMs: 100,
      heartbeatIntervalMs: 1_000,
      workerId: sequence => `busy-${sequence}`,
    })

    const deadline = Date.now() + 500
    while (started.length < 3 && Date.now() < deadline) await delay(5)
    worker.stop()
    await worker.done
    expect(started).toEqual([1, 2, 3])
    expect(maximumActive).toBe(2)
  })

  it('stops after one fatal database failure without retry or recovery churn', async () => {
    let claims = 0
    const fatalErrors: unknown[] = []
    const fatal = new WebAssembly.RuntimeError('memory access out of bounds')
    const worker = startTaskWorkerDispatcher({
      async claim() { claims += 1; throw fatal },
      async execute() {},
      async heartbeat() {},
      isFatal: isFatalDatabaseError,
      onFatal(error) { fatalErrors.push(error) },
      onError(error) { throw error },
    }, {
      concurrency: 4,
      minimumIdleDelayMs: 10,
      maximumIdleDelayMs: 20,
      heartbeatIntervalMs: 1_000,
    })

    await worker.done
    expect(claims).toBe(1)
    expect(fatalErrors).toEqual([fatal])
    expect(worker.stats().stopped).toBe(true)
  })

  it('recognizes wrapped PGlite fatal errors without classifying ordinary task errors', () => {
    expect(isFatalDatabaseError(new Error('model request failed'))).toBe(false)
    expect(isFatalDatabaseError(new Error('query failed', { cause: new Error('Aborted(): RuntimeError') }))).toBe(true)
    expect(isFatalDatabaseError(new Error('PGlite has been closed'))).toBe(true)
  })
})
