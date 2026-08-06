import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  documentModelSettingsRequest,
  imageGenerationSettingsRequest,
  modelTierSettings,
  projectModelSettingsRequest,
  visionModelSettingsRequest,
  voiceProvider,
  voiceSettingsRequest,
  type ModelTier,
  type VoiceProvider,
} from './contracts.js'
import { privateModelSettings } from './model-settings.js'
import { pathInside, projectsRoot, runtimeRoot } from './paths.js'
import { envDefaults as envVoiceDefaults } from './voice-settings.js'

interface TierSettings {
  model: string
  url: string
  key: string
  reasoning_effort: 'low' | 'medium' | 'high'
  use_proxy: boolean
}

interface DocumentSettings {
  model: string
  url: string
  key: string
  use_proxy: boolean
}

interface VisionSettings {
  model: string
  url: string
  key: string
  use_proxy: boolean
}

interface ImageGenerationSettings {
  model: string
  url: string
  key: string
  resolution: '1k' | '2k' | '4k'
  quality: 'low' | 'medium' | 'high'
  use_proxy: boolean
}

export interface ProjectModelSettings {
  simple: TierSettings
  medium: TierSettings
  complex: TierSettings
  document: DocumentSettings
  vision: VisionSettings
  image_generation: ImageGenerationSettings
}

export interface ProjectVoiceSettings {
  provider: VoiceProvider
  model: string
  url: string
  key: string
  use_proxy: boolean
}

interface ProjectSettings {
  model?: Partial<ProjectModelSettings>
  voice?: Partial<ProjectVoiceSettings>
}

const legacyProjectSettingsPath = resolve(runtimeRoot, 'project-settings.json')

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function projectSettingsPath(projectId: string): string {
  return pathInside(projectsRoot, projectId, '.researchos', 'model-settings.json')
}

function normalizeProjectSettings(value: unknown): ProjectSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Partial<ProjectSettings>
  const result: ProjectSettings = {}
  if (source.model && typeof source.model === 'object') result.model = source.model
  if (source.voice && typeof source.voice === 'object') result.voice = source.voice
  return result
}

function legacyProjectSettings(projectId: string): ProjectSettings {
  if (!existsSync(legacyProjectSettingsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(legacyProjectSettingsPath, 'utf8')) as Record<string, Partial<ProjectSettings>>
    return normalizeProjectSettings(parsed[projectId])
  } catch {
    return {}
  }
}

function readProjectOverrides(projectId: string): ProjectSettings {
  const path = projectSettingsPath(projectId)
  if (existsSync(path)) {
    try {
      return normalizeProjectSettings(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return {}
    }
  }
  return legacyProjectSettings(projectId)
}

function writeProjectOverrides(projectId: string, value: ProjectSettings): void {
  atomicWrite(projectSettingsPath(projectId), value)
  try {
    if (!existsSync(legacyProjectSettingsPath)) return
    const parsed = JSON.parse(readFileSync(legacyProjectSettingsPath, 'utf8')) as Record<string, unknown>
    if (!parsed[projectId]) return
    delete parsed[projectId]
    atomicWrite(legacyProjectSettingsPath, parsed)
  } catch {
    // Legacy cleanup is best-effort; the canonical project file is authoritative.
  }
}

function normalizeProvider(value: string | undefined | null): VoiceProvider {
  const candidate = value?.trim().toLowerCase()
  if (candidate === 'groq' || candidate === 'api') return 'api'
  return 'browser'
}

function mergeTier(base: TierSettings, saved: Partial<TierSettings> | undefined): TierSettings {
  if (!saved || typeof saved !== 'object') return base
  return {
    model: String(saved.model || base.model),
    url: String(saved.url || base.url),
    key: typeof saved.key === 'string' && saved.key ? saved.key : base.key,
    reasoning_effort: modelTierSettings.shape.reasoning_effort.safeParse(saved.reasoning_effort).success
      ? saved.reasoning_effort as TierSettings['reasoning_effort']
      : base.reasoning_effort,
    use_proxy: typeof saved.use_proxy === 'boolean' ? saved.use_proxy : base.use_proxy,
  }
}

function mergeDocument(base: DocumentSettings, saved: Partial<DocumentSettings> | undefined): DocumentSettings {
  if (!saved || typeof saved !== 'object') return base
  return {
    model: String(saved.model || base.model),
    url: String(saved.url || base.url),
    key: typeof saved.key === 'string' && saved.key ? saved.key : base.key,
    use_proxy: typeof saved.use_proxy === 'boolean' ? saved.use_proxy : base.use_proxy,
  }
}

function mergeVision(base: VisionSettings, saved: Partial<VisionSettings> | undefined): VisionSettings {
  return mergeDocument(base, saved)
}

function mergeImage(base: ImageGenerationSettings, saved: Partial<ImageGenerationSettings> | undefined): ImageGenerationSettings {
  if (!saved || typeof saved !== 'object') return base
  return {
    model: String(saved.model || base.model),
    url: String(saved.url || base.url),
    key: typeof saved.key === 'string' && saved.key ? saved.key : base.key,
    resolution: imageGenerationSettingsRequest.shape.resolution.safeParse(saved.resolution).success
      ? saved.resolution as ImageGenerationSettings['resolution']
      : base.resolution,
    quality: imageGenerationSettingsRequest.shape.quality.safeParse(saved.quality).success
      ? saved.quality as ImageGenerationSettings['quality']
      : base.quality,
    use_proxy: typeof saved.use_proxy === 'boolean' ? saved.use_proxy : base.use_proxy,
  }
}

function savedModel(projectId: string): Partial<ProjectModelSettings> | undefined {
  return readProjectOverrides(projectId).model
}

function savedVoice(projectId: string): Partial<ProjectVoiceSettings> | undefined {
  return readProjectOverrides(projectId).voice
}

export function privateProjectModelSettings(projectId: string): ProjectModelSettings {
  // Project settings inherit the same global runtime overrides as the Mastra
  // process (env defaults merged with runtime/model-settings.json), then only
  // project-specific overrides are layered on top.
  const base = privateModelSettings()
  const saved = savedModel(projectId)
  return {
    simple: mergeTier(base.simple, saved?.simple),
    medium: mergeTier(base.medium, saved?.medium),
    complex: mergeTier(base.complex, saved?.complex),
    document: mergeDocument(base.document, saved?.document),
    vision: mergeVision(base.vision, saved?.vision),
    image_generation: mergeImage(base.image_generation, saved?.image_generation),
  }
}

export function privateProjectVoiceSettings(projectId: string): ProjectVoiceSettings {
  const base = envVoiceDefaults()
  const saved = savedVoice(projectId)
  return {
    provider: voiceProvider.safeParse(saved?.provider).success ? normalizeProvider(saved?.provider) : base.provider,
    model: String(saved?.model || base.model),
    url: String(saved?.url || base.url),
    key: typeof saved?.key === 'string' && saved.key ? saved.key : base.key,
    use_proxy: typeof saved?.use_proxy === 'boolean' ? saved.use_proxy : base.use_proxy,
  }
}

function sourceOf(projectId: string, category: 'model' | 'voice'): 'project_override' | 'env_default' {
  const overrides = readProjectOverrides(projectId)
  const item = category === 'model' ? overrides.model : overrides.voice
  return item && typeof item === 'object' && Object.keys(item).length > 0 ? 'project_override' : 'env_default'
}

export function publicProjectModelSettings(projectId: string) {
  const settings = privateProjectModelSettings(projectId)
  const source = sourceOf(projectId, 'model')
  return {
    project_id: projectId,
    source,
    tiers: Object.fromEntries((['simple', 'medium', 'complex'] as const).map(tier => [tier, {
      model: settings[tier].model,
      url: settings[tier].url,
      reasoning_effort: settings[tier].reasoning_effort,
      use_proxy: settings[tier].use_proxy,
      key_configured: Boolean(settings[tier].key),
      sources: { url: source, key: source },
    }])),
    document: {
      model: settings.document.model,
      url: settings.document.url,
      use_proxy: settings.document.use_proxy,
      key_configured: Boolean(settings.document.key),
      source,
    },
    vision: {
      model: settings.vision.model,
      url: settings.vision.url,
      use_proxy: settings.vision.use_proxy,
      key_configured: Boolean(settings.vision.key),
      source,
    },
    image_generation: {
      model: settings.image_generation.model,
      url: settings.image_generation.url,
      use_proxy: settings.image_generation.use_proxy,
      key_configured: Boolean(settings.image_generation.key),
      resolution: settings.image_generation.resolution,
      quality: settings.image_generation.quality,
      source,
    },
  }
}

export function publicProjectDocumentSettings(projectId: string) {
  const settings = privateProjectModelSettings(projectId)
  return {
    project_id: projectId,
    model: settings.document.model,
    url: settings.document.url,
    use_proxy: settings.document.use_proxy,
    key_configured: Boolean(settings.document.key),
    source: sourceOf(projectId, 'model'),
  }
}

export function publicProjectVisionSettings(projectId: string) {
  const settings = privateProjectModelSettings(projectId)
  return {
    project_id: projectId,
    model: settings.vision.model,
    url: settings.vision.url,
    use_proxy: settings.vision.use_proxy,
    key_configured: Boolean(settings.vision.key),
    source: sourceOf(projectId, 'model'),
  }
}

export function publicProjectImageGenerationSettings(projectId: string) {
  const settings = privateProjectModelSettings(projectId)
  return {
    project_id: projectId,
    model: settings.image_generation.model,
    url: settings.image_generation.url,
    use_proxy: settings.image_generation.use_proxy,
    key_configured: Boolean(settings.image_generation.key),
    resolution: settings.image_generation.resolution,
    quality: settings.image_generation.quality,
    source: sourceOf(projectId, 'model'),
  }
}

export function publicProjectVoiceSettings(projectId: string) {
  const settings = privateProjectVoiceSettings(projectId)
  return {
    project_id: projectId,
    provider: settings.provider,
    model: settings.model,
    url: settings.url,
    use_proxy: settings.use_proxy,
    key_configured: Boolean(settings.key),
    source: sourceOf(projectId, 'voice'),
  }
}

export function saveProjectModelSettings(projectId: string, input: unknown) {
  const parsed = projectModelSettingsRequest.parse(input)
  const overrides = readProjectOverrides(projectId)
  const previous = savedModel(projectId) || {}
  const current = privateProjectModelSettings(projectId)
  const next: Partial<ProjectModelSettings> = {
    simple: { ...parsed.simple, key: parsed.simple.key.trim() || current.simple.key, use_proxy: parsed.simple.use_proxy },
    medium: { ...parsed.medium, key: parsed.medium.key.trim() || current.medium.key, use_proxy: parsed.medium.use_proxy },
    complex: { ...parsed.complex, key: parsed.complex.key.trim() || current.complex.key, use_proxy: parsed.complex.use_proxy },
  }
  if (previous.document) next.document = previous.document
  if (previous.vision) next.vision = previous.vision
  if (previous.image_generation) next.image_generation = previous.image_generation
  overrides.model = next
  writeProjectOverrides(projectId, overrides)
  return publicProjectModelSettings(projectId)
}

export function saveProjectDocumentSettings(projectId: string, input: unknown) {
  const parsed = documentModelSettingsRequest.parse(input)
  const overrides = readProjectOverrides(projectId)
  const current = privateProjectModelSettings(projectId)
  const previous = savedModel(projectId) || {}
  const model: Partial<ProjectModelSettings> = {
    ...previous,
    document: {
      model: parsed.model.trim(),
      url: parsed.url.trim(),
      key: parsed.key.trim() || current.document.key,
      use_proxy: parsed.use_proxy,
    },
  }
  overrides.model = model
  writeProjectOverrides(projectId, overrides)
  return publicProjectDocumentSettings(projectId)
}

export function saveProjectVisionSettings(projectId: string, input: unknown) {
  const parsed = visionModelSettingsRequest.parse(input)
  const overrides = readProjectOverrides(projectId)
  const current = privateProjectModelSettings(projectId)
  const previous = savedModel(projectId) || {}
  const model: Partial<ProjectModelSettings> = {
    ...previous,
    vision: {
      model: parsed.model.trim(),
      url: parsed.url.trim(),
      key: parsed.key.trim() || current.vision.key,
      use_proxy: parsed.use_proxy,
    },
  }
  overrides.model = model
  writeProjectOverrides(projectId, overrides)
  return publicProjectVisionSettings(projectId)
}

export function saveProjectImageGenerationSettings(projectId: string, input: unknown) {
  const parsed = imageGenerationSettingsRequest.parse(input)
  const overrides = readProjectOverrides(projectId)
  const current = privateProjectModelSettings(projectId)
  const previous = savedModel(projectId) || {}
  const model: Partial<ProjectModelSettings> = {
    ...previous,
    image_generation: {
      model: parsed.model.trim(),
      url: parsed.url.trim(),
      key: parsed.key.trim() || current.image_generation.key,
      resolution: parsed.resolution,
      quality: parsed.quality,
      use_proxy: parsed.use_proxy,
    },
  }
  overrides.model = model
  writeProjectOverrides(projectId, overrides)
  return publicProjectImageGenerationSettings(projectId)
}

export function saveProjectVoiceSettings(projectId: string, input: unknown) {
  const parsed = voiceSettingsRequest.parse(input)
  const overrides = readProjectOverrides(projectId)
  const current = privateProjectVoiceSettings(projectId)
  const next: ProjectVoiceSettings = {
    provider: normalizeProvider(parsed.provider),
    model: parsed.model.trim() || current.model,
    url: parsed.url.trim() || current.url,
    key: parsed.key.trim() || current.key,
    use_proxy: parsed.use_proxy,
  }
  overrides.voice = next
  writeProjectOverrides(projectId, overrides)
  return publicProjectVoiceSettings(projectId)
}

export function removeProjectSettings(projectId: string): void {
  const path = projectSettingsPath(projectId)
  if (existsSync(path)) rmSync(path, { force: true })
  try {
    if (!existsSync(legacyProjectSettingsPath)) return
    const parsed = JSON.parse(readFileSync(legacyProjectSettingsPath, 'utf8')) as Record<string, unknown>
    if (!parsed[projectId]) return
    delete parsed[projectId]
    atomicWrite(legacyProjectSettingsPath, parsed)
  } catch {
    // Removal is best-effort for the legacy runtime file.
  }
}
