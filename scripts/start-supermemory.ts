import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedModelUrl, isResponsesBaseUrl } from '../apps/server/src/model-url.js'
import { supermemoryChildEnv } from '../apps/server/src/supermemory-env.js'
import { ensureModelGatewayBridge, stopModelGatewayBridge } from '../apps/server/src/model-gateway-bridge.js'
import { runtimeRoot } from '../apps/server/src/paths.js'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(sourceDirectory, '..')
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const action = process.argv[2] ?? 'start'
const runtimeDir = runtimeRoot
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
  stopModelGatewayBridge()
  process.exit(0)
}

if (await healthOk()) {
  if (process.env.SUPERMEMORY_MODEL_BRIDGE_ENABLED !== 'false') {
    try {
      const bridgeUrl = await ensureModelGatewayBridge()
      console.log(`supermemory already running at ${baseUrl}; model bridge is ready at ${bridgeUrl}. Restart Supermemory to apply the bridge to the existing child.`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  } else {
    console.log(`supermemory already running at ${baseUrl}`)
  }
  process.exit(0)
}

const bin = process.env.SUPERMEMORY_SERVER_BIN
if (!bin || !existsSync(bin)) {
  console.error('SUPERMEMORY_SERVER_BIN must point to the supermemory-server executable (see .env.example)')
  process.exit(1)
}

const embeddingProvider = (process.env.SUPERMEMORY_EMBEDDING_PROVIDER || 'local').trim().toLowerCase()
if (embeddingProvider !== 'local') {
  const versionProbe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  const versionText = String(versionProbe.stdout || versionProbe.stderr || '').trim()
  if (versionText !== '0.0.5') {
    console.error(
      `remote embedding (SUPERMEMORY_EMBEDDING_PROVIDER=${embeddingProvider}) requires supermemory-server build v0.0.5; ` +
        `${bin} reports "${versionText || 'unknown version'}". server-v0.0.6 and 0.0.7-rc.2 do not implement ` +
        `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL; refusing to start (no fallback).`,
    )
    process.exit(1)
  }
}

const modelKey = process.env.RESEARCH_MODEL_KEY_MEDIUM
if (!modelKey) {
  console.error('RESEARCH_MODEL_KEY_MEDIUM is not set in .env; Supermemory LLM extraction needs a model key')
  process.exit(1)
}
const modelBaseUrl = (process.env.RESEARCH_MODEL_URL_MEDIUM || 'http://127.0.0.1:3000/v1').trim()
if (!isAllowedModelUrl(modelBaseUrl) || !isResponsesBaseUrl(modelBaseUrl)) {
  console.error('RESEARCH_MODEL_URL_MEDIUM must use HTTPS or loopback/private HTTP and be a Responses API base URL, not /responses, /chat/completions, or /completions')
  process.exit(1)
}
const modelRequestBaseUrl = await ensureModelGatewayBridge()

mkdirSync(runtimeDir, { recursive: true })
const outFd = openSync(resolve(runtimeDir, 'supermemory.out.log'), 'a')
const errFd = openSync(resolve(runtimeDir, 'supermemory.err.log'), 'a')
const child = spawn(bin, [], {
  cwd: dirname(bin),
  detached: true,
  stdio: ['ignore', outFd, errFd],
  env: supermemoryChildEnv({
    OPENAI_BASE_URL: modelRequestBaseUrl,
    OPENAI_MODEL: process.env.RESEARCH_MODEL_MEDIUM || 'gpt-5.6-luna',
    OPENAI_API_KEY: modelKey,
    SUPERMEMORY_DISABLE_TELEMETRY: '1',
  }),
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
