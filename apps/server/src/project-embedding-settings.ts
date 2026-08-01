import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { embeddingProvider, projectEmbeddingSettingsRequest, type EmbeddingProvider, type ProjectEmbeddingSettingsRequest } from './contracts.js'
import { runtimeRoot } from './paths.js'

export interface ProjectEmbeddingSettings {
  provider: EmbeddingProvider
  model: string
  dimensions: number
  base_url: string
  key: string
  pool_key: string
}

export interface EmbeddingPool {
  provider: EmbeddingProvider
  model: string
  dimensions: number
  base_url: string
  key: string
  port: number
}

export const INSTANCE_PORT_BASE = 6770
export const INSTANCE_PORT_MAX = 6869
export const GLOBAL_POOL_KEY = 'global'

const projectSettingsPath = resolve(runtimeRoot, 'project-embedding-settings.json')
const poolRegistryPath = resolve(runtimeRoot, 'embedding-pools.json')

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/bge-m3'

function envDefaults(): Omit<ProjectEmbeddingSettings, 'pool_key'> {
  const providerValue = process.env.SUPERMEMORY_EMBEDDING_PROVIDER?.trim().toLowerCase()
  const provider: EmbeddingProvider = embeddingProvider.safeParse(providerValue).success ? (providerValue as EmbeddingProvider) : 'local'
  const model = process.env.SUPERMEMORY_EMBEDDING_MODEL?.trim() || (provider === 'local' ? DEFAULT_LOCAL_EMBEDDING_MODEL : '')
  const parsedDimensions = Number(process.env.SUPERMEMORY_EMBEDDING_DIMENSIONS)
  const dimensions = Number.isInteger(parsedDimensions) && parsedDimensions > 0 ? parsedDimensions : 1024
  return {
    provider,
    model,
    dimensions,
    base_url: process.env.SUPERMEMORY_EMBEDDING_BASE_URL?.trim() || '',
    key: process.env.SUPERMEMORY_EMBEDDING_API_KEY?.trim() || '',
  }
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function readProjectOverrides(): Record<string, ProjectEmbeddingSettings> {
  if (!existsSync(projectSettingsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(projectSettingsPath, 'utf8')) as Record<string, Partial<ProjectEmbeddingSettings>>
    const defaults = envDefaults()
    const result: Record<string, ProjectEmbeddingSettings> = {}
    for (const [projectId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const provider: EmbeddingProvider = embeddingProvider.safeParse(value.provider).success ? (value.provider as EmbeddingProvider) : defaults.provider
      const dimensions = Number(value.dimensions)
      const model = String(value.model || defaults.model)
      const baseUrl = String(value.base_url || '')
      const key = String(value.key || '')
      const dimensionsResolved = Number.isInteger(dimensions) && dimensions > 0 ? dimensions : defaults.dimensions
      result[projectId] = {
        provider,
        model,
        dimensions: dimensionsResolved,
        base_url: baseUrl,
        key,
        pool_key: String(value.pool_key || poolKeyOf({ provider, model, dimensions: dimensionsResolved, base_url: baseUrl, key })),
      }
    }
    return result
  } catch {
    return {}
  }
}

function readPools(): Record<string, EmbeddingPool> {
  if (!existsSync(poolRegistryPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(poolRegistryPath, 'utf8')) as Record<string, Partial<EmbeddingPool>>
    const result: Record<string, EmbeddingPool> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const provider: EmbeddingProvider = embeddingProvider.safeParse(value.provider).success ? (value.provider as EmbeddingProvider) : 'local'
      const port = Number(value.port)
      result[key] = {
        provider,
        model: String(value.model || ''),
        dimensions: Number(value.dimensions) || 1024,
        base_url: String(value.base_url || ''),
        key: String(value.key || ''),
        port: Number.isInteger(port) && port >= INSTANCE_PORT_BASE ? port : 0,
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeProjectOverrides(all: Record<string, ProjectEmbeddingSettings>): void {
  atomicWrite(projectSettingsPath, all)
}

function writePools(all: Record<string, EmbeddingPool>): void {
  atomicWrite(poolRegistryPath, all)
}

export function poolKeyOf(settings: { provider: string; model: string; dimensions: number; base_url: string; key: string }): string {
  const canonical = [settings.provider, settings.model, String(settings.dimensions), settings.base_url, settings.key].join('\u0000')
  return createHash('sha256').update(canonical).digest('hex')
}

export function poolForKey(poolKey: string): EmbeddingPool | undefined {
  return readPools()[poolKey]
}

export function projectsUsingPool(poolKey: string): string[] {
  const overrides = readProjectOverrides()
  return Object.entries(overrides).filter(([, value]) => value.pool_key === poolKey).map(([projectId]) => projectId)
}

export function projectEmbeddingSettings(projectId: string): ProjectEmbeddingSettings {
  const saved = readProjectOverrides()[projectId]
  if (!saved) return { ...envDefaults(), pool_key: GLOBAL_POOL_KEY }
  return saved
}

export function hasProjectEmbeddingOverride(projectId: string): boolean {
  return Boolean(readProjectOverrides()[projectId])
}

export function publicProjectEmbeddingSettings(projectId: string) {
  const saved = readProjectOverrides()[projectId]
  const effective = saved ?? { ...envDefaults(), pool_key: GLOBAL_POOL_KEY }
  return {
    project_id: projectId,
    mode: saved ? 'custom' : 'global',
    provider: effective.provider,
    model: effective.model,
    dimensions: effective.dimensions,
    base_url: effective.provider === 'local' ? '' : effective.base_url,
    key_configured: Boolean(effective.key),
    source: saved ? 'project_override' : 'env_default',
    pool_key: effective.pool_key,
  }
}

function allocatePort(pools: Record<string, EmbeddingPool>): number {
  const used = new Set(Object.values(pools).map(pool => pool.port))
  for (let port = INSTANCE_PORT_BASE; port <= INSTANCE_PORT_MAX; port += 1) if (!used.has(port)) return port
  throw new Error('no_free_embedding_instance_port')
}

function registerPool(settings: Omit<ProjectEmbeddingSettings, 'pool_key'>): string {
  const key = poolKeyOf(settings)
  const pools = readPools()
  if (!pools[key]) {
    pools[key] = { ...settings, port: allocatePort(pools) }
    writePools(pools)
  }
  return key
}

export function computedEmbeddingSettings(projectId: string, input: ProjectEmbeddingSettingsRequest, previous: ProjectEmbeddingSettings) {
  const defaults = envDefaults()
  if (input.mode === 'global') return { settings: null as null, pool_key: GLOBAL_POOL_KEY, reset_required: false }
  const provider = input.provider
  const model = input.model.trim() || (provider === 'local' ? DEFAULT_LOCAL_EMBEDDING_MODEL : '')
  const settings = {
    provider,
    model,
    dimensions: input.dimensions,
    base_url: input.base_url.trim(),
    key: input.key.trim() || previous.key,
  }
  if (provider !== 'local' && !settings.base_url) throw new Error('embedding_remote_base_url_required')
  if (provider !== 'local' && !settings.key) throw new Error('embedding_remote_key_required')
  const poolKey = poolKeyOf(settings)
  const poolChanged = previous.pool_key !== poolKey
  const resetRequired = poolChanged && previous.pool_key !== GLOBAL_POOL_KEY && (
    previous.provider !== settings.provider ||
    previous.model !== settings.model ||
    previous.dimensions !== settings.dimensions
  )
  void defaults
  return { settings: { ...settings, pool_key: poolKey }, pool_key: poolKey, reset_required: resetRequired }
}

export function saveProjectEmbeddingSettings(projectId: string, input: ProjectEmbeddingSettingsRequest): { released_pool_keys: string[] } {
  const parsed = projectEmbeddingSettingsRequest.parse(input)
  const overrides = readProjectOverrides()
  const previous = overrides[projectId] ?? { ...envDefaults(), pool_key: GLOBAL_POOL_KEY }
  if (parsed.mode === 'global') {
    delete overrides[projectId]
  } else {
    const computed = computedEmbeddingSettings(projectId, parsed, previous)
    if (!computed.settings) return { released_pool_keys: [] }
    const poolKey = registerPool(computed.settings)
    overrides[projectId] = { ...computed.settings, pool_key: poolKey }
  }
  writeProjectOverrides(overrides)
  const released: string[] = []
  if (previous.pool_key !== GLOBAL_POOL_KEY && projectsUsingPool(previous.pool_key).length === 0) {
    const pools = readPools()
    if (pools[previous.pool_key]) {
      delete pools[previous.pool_key]
      writePools(pools)
      released.push(previous.pool_key)
    }
  }
  return { released_pool_keys: released }
}

export function usedProjectEmbeddingPorts(): number[] {
  return Object.values(readPools()).map(pool => pool.port)
}
