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
  instance_port: number | null
}

export const INSTANCE_PORT_BASE = 6770
export const INSTANCE_PORT_MAX = 6869
const settingsPath = resolve(runtimeRoot, 'project-embedding-settings.json')

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/bge-m3'

function envDefaults(): Omit<ProjectEmbeddingSettings, 'instance_port'> {
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

function readAll(): Record<string, ProjectEmbeddingSettings> {
  if (!existsSync(settingsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, Partial<ProjectEmbeddingSettings>>
    const defaults = envDefaults()
    const result: Record<string, ProjectEmbeddingSettings> = {}
    for (const [projectId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const provider: EmbeddingProvider = embeddingProvider.safeParse(value.provider).success ? (value.provider as EmbeddingProvider) : defaults.provider
      const dimensions = Number(value.dimensions)
      result[projectId] = {
        provider,
        model: String(value.model || defaults.model),
        dimensions: Number.isInteger(dimensions) && dimensions > 0 ? dimensions : defaults.dimensions,
        base_url: String(value.base_url || ''),
        key: String(value.key || ''),
        instance_port: Number.isInteger(Number(value.instance_port)) && Number(value.instance_port) >= INSTANCE_PORT_BASE ? Number(value.instance_port) : null,
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, ProjectEmbeddingSettings>): void {
  mkdirSync(dirname(settingsPath), { recursive: true })
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
}

export function projectEmbeddingSettings(projectId: string): ProjectEmbeddingSettings {
  const saved = readAll()[projectId]
  if (!saved) return { ...envDefaults(), instance_port: null }
  return saved
}

export function hasProjectEmbeddingOverride(projectId: string): boolean {
  return Boolean(readAll()[projectId])
}

export function publicProjectEmbeddingSettings(projectId: string) {
  const saved = readAll()[projectId]
  const effective = saved ?? { ...envDefaults(), instance_port: null }
  return {
    project_id: projectId,
    mode: saved ? 'custom' : 'global',
    provider: effective.provider,
    model: effective.model,
    dimensions: effective.dimensions,
    base_url: effective.base_url,
    key_configured: Boolean(effective.key),
    source: saved ? 'project_override' : 'env_default',
  }
}

function allocatePort(all: Record<string, ProjectEmbeddingSettings>): number {
  const used = new Set(Object.values(all).map(item => item.instance_port).filter((port): port is number => port !== null))
  for (let port = INSTANCE_PORT_BASE; port <= INSTANCE_PORT_MAX; port += 1) if (!used.has(port)) return port
  throw new Error('no_free_embedding_instance_port')
}

export function computedEmbeddingSettings(projectId: string, input: ProjectEmbeddingSettingsRequest, previous: ProjectEmbeddingSettings) {
  const defaults = envDefaults()
  if (input.mode === 'global') return { settings: null, reset_required: false, restart_needed: false }
  const provider = input.provider
  const model = input.model.trim() || (provider === 'local' ? DEFAULT_LOCAL_EMBEDDING_MODEL : '')
  const settings: ProjectEmbeddingSettings = {
    provider,
    model,
    dimensions: input.dimensions,
    base_url: input.base_url.trim(),
    key: input.key.trim() || previous.key,
    instance_port: previous.instance_port ?? allocatePort(readAll()),
  }
  if (provider !== 'local' && !settings.base_url) throw new Error('embedding_remote_base_url_required')
  if (provider !== 'local' && !settings.key) throw new Error('embedding_remote_key_required')
  const previousCustom = previous.instance_port !== null
  const resetRequired = previousCustom && (
    previous.provider !== settings.provider ||
    previous.model !== settings.model ||
    previous.dimensions !== settings.dimensions
  )
  const restartNeeded = previousCustom && (
    resetRequired ||
    (settings.provider !== 'local' && (previous.base_url !== settings.base_url || previous.key !== settings.key))
  )
  return { settings, reset_required: resetRequired, restart_needed: restartNeeded }
}

export function saveProjectEmbeddingSettings(projectId: string, input: ProjectEmbeddingSettingsRequest): void {
  const parsed = projectEmbeddingSettingsRequest.parse(input)
  const all = readAll()
  if (parsed.mode === 'global') {
    delete all[projectId]
  } else {
    const previous = all[projectId] ?? { ...envDefaults(), instance_port: null }
    const computed = computedEmbeddingSettings(projectId, parsed, previous)
    if (!computed.settings) return
    all[projectId] = computed.settings
  }
  writeAll(all)
}

export function usedProjectEmbeddingPorts(): number[] {
  return Object.values(readAll()).map(item => item.instance_port).filter((port): port is number => port !== null)
}
