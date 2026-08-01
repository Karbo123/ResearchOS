import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(sourceDirectory, '..')
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const action = process.argv[2] ?? 'start'
const runtimeDir = resolve(repositoryRoot, 'runtime')
const pidPath = resolve(runtimeDir, 'supermemory.pid')
const baseUrl = process.env.SUPERMEMORY_BASE_URL || 'http://127.0.0.1:6767'
const healthUrl = baseUrl.replace(/\/$/, '')

async function healthOk(): Promise<boolean> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

if (action === 'stop') {
  const pidText = existsSync(pidPath) ? readFileSync(pidPath, 'utf8').trim() : ''
  if (pidText) {
    try {
      process.kill(Number(pidText))
      console.log(`stopped supermemory pid ${pidText}`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ESRCH') throw error
      console.log(`pid ${pidText} already exited`)
    }
    rmSync(pidPath, { force: true })
  } else {
    console.log('no supermemory pid file; nothing to stop')
  }
  process.exit(0)
}

if (await healthOk()) {
  console.log(`supermemory already running at ${baseUrl}`)
  process.exit(0)
}

const bin = process.env.SUPERMEMORY_SERVER_BIN
if (!bin || !existsSync(bin)) {
  console.error('SUPERMEMORY_SERVER_BIN must point to the supermemory-server executable (see .env.example)')
  process.exit(1)
}

const modelKey = process.env.RESEARCH_MODEL_KEY_MEDIUM
if (!modelKey) {
  console.error('RESEARCH_MODEL_KEY_MEDIUM is not set in .env; Supermemory LLM extraction needs a model key')
  process.exit(1)
}

mkdirSync(runtimeDir, { recursive: true })
const outFd = openSync(resolve(runtimeDir, 'supermemory.out.log'), 'a')
const errFd = openSync(resolve(runtimeDir, 'supermemory.err.log'), 'a')
const child = spawn(bin, [], {
  cwd: dirname(bin),
  detached: true,
  windowsHide: true,
  stdio: ['ignore', outFd, errFd],
  env: {
    ...process.env,
    OPENAI_BASE_URL: process.env.RESEARCH_MODEL_URL_MEDIUM || 'http://127.0.0.1:3000/v1',
    OPENAI_MODEL: process.env.RESEARCH_MODEL_MEDIUM || 'gpt-5.6-luna',
    OPENAI_API_KEY: modelKey,
    SUPERMEMORY_DISABLE_TELEMETRY: '1',
  },
})
writeFileSync(pidPath, String(child.pid ?? ''))
child.unref()

const deadline = Date.now() + 180_000
let ready = false
while (Date.now() < deadline) {
  if (await healthOk()) {
    ready = true
    break
  }
  await new Promise(resolve => setTimeout(resolve, 2000))
}
if (!ready) {
  console.error(`supermemory did not become healthy at ${healthUrl} within 180s; see runtime/supermemory.out.log and runtime/supermemory.err.log`)
  process.exit(1)
}
console.log(`supermemory ready at ${baseUrl} (pid ${child.pid ?? 'unknown'})`)
