import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { GLOBAL_POOL_KEY, poolForKey, projectEmbeddingSettings, projectsUsingPool } from './project-embedding-settings.js'
import { isAllowedModelUrl, isResponsesBaseUrl } from './model-url.js'
import { runtimeRoot } from './paths.js'
import { supermemoryChildEnv } from './supermemory-env.js'
import { ensureModelGatewayBridge } from './model-gateway-bridge.js'

const DEFAULT_GLOBAL_PORT = 6767

function poolDir(poolKey: string): string {
  return resolve(runtimeRoot, 'supermemory', 'pools', poolKey)
}

function poolDataDir(poolKey: string): string {
  return resolve(poolDir(poolKey), 'data')
}

function pidPath(poolKey: string): string {
  return resolve(poolDir(poolKey), 'supermemory.pid')
}

function modelRoutePath(poolKey: string): string {
  return resolve(poolDir(poolKey), 'model-route')
}

async function healthOk(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function resolveProjectBaseUrl(projectId: string): Promise<string> {
  const settings = projectEmbeddingSettings(projectId)
  if (settings.pool_key === GLOBAL_POOL_KEY) {
    return process.env.SUPERMEMORY_BASE_URL?.trim() || `http://127.0.0.1:${DEFAULT_GLOBAL_PORT}`
  }
  const pool = poolForKey(settings.pool_key)
  if (!pool || !pool.port) throw new Error(`embedding pool ${settings.pool_key} is not registered`)
  await ensurePoolInstance(settings.pool_key)
  return `http://127.0.0.1:${pool.port}`
}

export async function ensurePoolInstance(poolKey: string): Promise<void> {
  const pool = poolForKey(poolKey)
  if (!pool || !pool.port) throw new Error(`embedding pool ${poolKey} is not registered`)
  const bin = process.env.SUPERMEMORY_SERVER_BIN
  if (!bin || !existsSync(bin)) {
    throw new Error('SUPERMEMORY_SERVER_BIN must be configured to start a Supermemory embedding pool instance')
  }
  if (pool.provider !== 'local') {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000 })
    const versionText = String(probe.stdout || probe.stderr || '').trim()
    if (versionText !== '0.0.5') {
      throw new Error(
        `remote embedding pool ${poolKey} requires supermemory-server v0.0.5; ${bin} reports "${versionText || 'unknown version'}"; refusing to start (no fallback).`,
      )
    }
  }
  mkdirSync(poolDir(poolKey), { recursive: true })
  const modelBaseUrl = (process.env.RESEARCH_MODEL_URL_MEDIUM || 'http://127.0.0.1:3000/v1').trim()
  if (!isAllowedModelUrl(modelBaseUrl) || !isResponsesBaseUrl(modelBaseUrl)) {
    throw new Error('RESEARCH_MODEL_URL_MEDIUM must use HTTPS or loopback/private HTTP and be a Responses API base URL before starting a Supermemory pool')
  }
  const modelRequestBaseUrl = await ensureModelGatewayBridge()
  const routePath = modelRoutePath(poolKey)
  const routeMatches = existsSync(routePath) && readFileSync(routePath, 'utf8').trim() === modelRequestBaseUrl
  if (await healthOk(pool.port) && routeMatches) return
  if (await healthOk(pool.port)) await stopPoolInstance(poolKey)
  const outFd = openSync(resolve(poolDir(poolKey), 'supermemory.out.log'), 'a')
  const errFd = openSync(resolve(poolDir(poolKey), 'supermemory.err.log'), 'a')
  const child = spawn(bin, [], {
    cwd: dirname(bin),
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: supermemoryChildEnv({
      SUPERMEMORY_PORT: String(pool.port),
      SUPERMEMORY_DATA_DIR: poolDataDir(poolKey),
      SUPERMEMORY_EMBEDDING_PROVIDER: pool.provider,
      SUPERMEMORY_EMBEDDING_MODEL: pool.model,
      SUPERMEMORY_EMBEDDING_DIMENSIONS: String(pool.dimensions),
      SUPERMEMORY_EMBEDDING_BASE_URL: pool.base_url,
      SUPERMEMORY_EMBEDDING_API_KEY: pool.key,
      SUPERMEMORY_NO_OPEN: '1',
      SUPERMEMORY_NO_UPDATE_CHECK: '1',
      SUPERMEMORY_DISABLE_TELEMETRY: '1',
      OPENAI_BASE_URL: modelRequestBaseUrl,
      OPENAI_MODEL: process.env.RESEARCH_MODEL_MEDIUM || 'gpt-5.6-luna',
      OPENAI_API_KEY: process.env.RESEARCH_MODEL_KEY_MEDIUM || '',
    }),
  })
  writeFileSync(pidPath(poolKey), String(child.pid ?? ''))
  writeFileSync(routePath, modelRequestBaseUrl)
  child.unref()
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (await healthOk(pool.port)) return
    await sleep(2000)
  }
  throw new Error(`Supermemory embedding pool ${poolKey} did not become healthy on port ${pool.port}`)
}

export async function stopPoolInstance(poolKey: string): Promise<void> {
  const pidFile = pidPath(poolKey)
  if (!existsSync(pidFile)) return
  const pidText = readFileSync(pidFile, 'utf8').trim()
  if (pidText) {
    try {
      process.kill(Number(pidText))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ESRCH') throw error
    }
  }
  rmSync(pidFile, { force: true })
  rmSync(modelRoutePath(poolKey), { force: true })
}

export async function projectInstanceStatus(projectId: string): Promise<{ mode: 'global' | 'custom'; port: number | null; running: boolean; shared_projects: number }> {
  const settings = projectEmbeddingSettings(projectId)
  if (settings.pool_key === GLOBAL_POOL_KEY) return { mode: 'global', port: null, running: false, shared_projects: 0 }
  const pool = poolForKey(settings.pool_key)
  const port = pool?.port ?? null
  return {
    mode: 'custom',
    port,
    running: port !== null && await healthOk(port),
    shared_projects: projectsUsingPool(settings.pool_key).length,
  }
}
