import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/http.js'
import { isTaskErrorTerminal } from '../src/task-worker.js'

describe('task worker error policy', () => {
  it('fails structured API/model errors immediately instead of hiding them behind retries', () => {
    expect(isTaskErrorTerminal(new ApiError(502, 'model_upstream_error', 'upstream rejected the request'), 1, 3)).toBe(true)
    expect(isTaskErrorTerminal(new Error('interrupted before a durable result'), 1, 3)).toBe(false)
    expect(isTaskErrorTerminal(new Error('retry budget exhausted'), 3, 3)).toBe(true)
  })
})
