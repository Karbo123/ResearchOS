import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ensureVenv } from '../src/experiment-runner.js'
import { projectsRoot } from '../src/paths.js'

const created: string[] = []
afterAll(() => { for (const path of created) rmSync(path, { recursive: true, force: true }) }, 120_000)

describe('per-project scientific environment', () => {
  it('creates an interpreter under the project .venv', async () => {
    const project = mkdtempSync(resolve(projectsRoot, 'venv-test-'))
    created.push(project)
    const venv = await ensureVenv(project)
    expect(venv).toBe(resolve(project, '.venv'))
    const interpreter = resolve(venv, 'bin', 'python')
    expect(existsSync(interpreter)).toBe(true)
  }, 120_000)
})
