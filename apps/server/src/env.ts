import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Tests must stay isolated: loading the project .env would override the
// vitest runtime directory (RESEARCH_RUNTIME_DIR=runtime) and point the test
// process at the live database, which aborts when the running API already
// holds it open. Tests set the environment they need explicitly.
if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
  process.env.RESEARCH_RUNTIME_DIR = process.env.RESEARCH_RUNTIME_DIR || `runtime/test-${process.pid}`
} else {
  const envPath = resolve(process.cwd(), process.cwd().endsWith('apps\\server') || process.cwd().endsWith('apps/server') ? '../../.env' : '.env')
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
}
