import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { projectEmbeddingSettings } from './project-embedding-settings.js'
import { runtimeRoot } from './paths.js'

const DEFAULT_GLOBAL_PORT = 6767

function projectInstanceDir(projectId: string): string {
  return resolve(runtimeRoot, 'supermemory', 'projects', projectId)
}

function projectDataDir(projectId: string): string {
  return resolve(projectInstanceDir(projectId), 'data')
}

function pidPath(projectId: string): string {
  return resolve(projectInstanceDir(projectId), 'supermemory.pid')
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
  if (settings.instance_port === null) {
    return process.env.SUPERMEMORY_BASE_URL?.trim() || `http://127.0.0.1:${DEFAULT_GLOBAL_PORT}`
  }
  await ensureProjectInstance(projectId)
  return `http://127.0.0.1:${settings.instance_port}`
}

export async function ensureProjectInstance(projectId: string): Promise<void> {
  const settings = projectEmbeddingSettings(projectId)
  if (settings.instance_port === null) return
  const port = settings.instance_port
  if (await healthOk(port)) return
  const bin = process.env.SUPERMEMORY_SERVER_BIN
  if (!bin || !existsSync(bin)) {
    throw new Error('SUPERMEMORY_SERVER_BIN must be configured to start a per-project Supermemory instance')
  }
  if (settings.provider !== 'local') {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
    const versionText = String(probe.stdout || probe.stderr || '').trim()
    if (versionText !== '0.0.5') {
      throw new Error(
        `remote embedding for project ${projectId} requires supermemory-server v0.0.5; ${bin} reports "${versionText || 'unknown version'}"; refusing to start (no fallback).`,
      )
    }
  }
  mkdirSync(projectInstanceDir(projectId), { recursive: true })
  const outFd = openSync(resolve(projectInstanceDir(projectId), 'supermemory.out.log'), 'a')
  const errFd = openSync(resolve(projectInstanceDir(projectId), 'supermemory.err.log'), 'a')
  const child = spawn(bin, [], {
    cwd: dirname(bin),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outFd, errFd],
    env: {
      ...process.env,
      SUPERMEMORY_PORT: String(port),
      SUPERMEMORY_DATA_DIR: projectDataDir(projectId),
      SUPERMEMORY_EMBEDDING_PROVIDER: settings.provider,
      SUPERMEMORY_EMBEDDING_MODEL: settings.model,
      SUPERMEMORY_EMBEDDING_DIMENSIONS: String(settings.dimensions),
      SUPERMEMORY_EMBEDDING_BASE_URL: settings.base_url,
      SUPERMEMORY_EMBEDDING_API_KEY: settings.key,
      SUPERMEMORY_NO_OPEN: '1',
      SUPERMEMORY_NO_UPDATE_CHECK: '1',
      SUPERMEMORY_DISABLE_TELEMETRY: '1',
      OPENAI_BASE_URL: process.env.RESEARCH_MODEL_URL_MEDIUM || 'http://127.0.0.1:3000/v1',
      OPENAI_MODEL: process.env.RESEARCH_MODEL_MEDIUM || 'gpt-5.6-luna',
      OPENAI_API_KEY: process.env.RESEARCH_MODEL_KEY_MEDIUM || '',
    },
  })
  writeFileSync(pidPath(projectId), String(child.pid ?? ''))
  child.unref()
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (await healthOk(port)) return
    await sleep(2000)
  }
  throw new Error(`per-project Supermemory instance for ${projectId} did not become healthy on port ${port}`)
}

export async function stopProjectInstance(projectId: string): Promise<void> {
  const pidFile = pidPath(projectId)
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
}

export async function resetProjectInstanceData(projectId: string): Promise<void> {
  await stopProjectInstance(projectId)
  const dataDir = projectDataDir(projectId)
  if (existsSync(dataDir)) {
    const backup = `${dataDir}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    renameSync(dataDir, backup)
  }
}

export async function projectInstanceStatus(projectId: string): Promise<{ mode: 'global' | 'custom'; port: number | null; running: boolean }> {
  const settings = projectEmbeddingSettings(projectId)
  if (settings.instance_port === null) return { mode: 'global', port: null, running: false }
  return { mode: 'custom', port: settings.instance_port, running: await healthOk(settings.instance_port) }
}
