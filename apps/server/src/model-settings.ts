import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { documentModelSettingsRequest, imageGenerationSettingsRequest, modelSettingsRequest, proxySettingsRequest, visionModelSettingsRequest, type ModelTier } from './contracts.js'
import { runtimeRoot } from './paths.js'

interface TierSettings {
  model: string
  url: string
  key: string
  reasoning_effort: 'low' | 'medium' | 'high'
}

interface ProxySettings {
  enabled: boolean
  url: string
}

interface DocumentSettings {
  model: string
  url: string
  key: string
}

interface VisionSettings {
  model: string
  url: string
  key: string
}

interface ImageGenerationSettings {
  model: string
  url: string
  key: string
  resolution: '1k' | '2k' | '4k'
  quality: 'low' | 'medium' | 'high'
}

type ModelSettings = Record<ModelTier, TierSettings> & {
  document: DocumentSettings
  vision: VisionSettings
  image_generation: ImageGenerationSettings
  proxy: ProxySettings
}

const settingsPath = resolve(runtimeRoot, 'model-settings.json')

export function envModelDefaults(): ModelSettings {
  return {
    simple: envTier('SIMPLE', 'gpt-5.6-luna', 'low'),
    medium: envTier('MEDIUM', 'gpt-5.6-terra', 'medium'),
    complex: envTier('COMPLEX', 'gpt-5.6-sol', 'high'),
    document: envDocument(),
    vision: envVision(),
    image_generation: envImageGeneration(),
    proxy: envProxy(),
  }
}

function envTier(suffix: string, model: string, effort: 'low' | 'medium' | 'high') {
  return {
    model: process.env[`RESEARCH_MODEL_${suffix}`]?.trim() || model,
    url: process.env[`RESEARCH_MODEL_URL_${suffix}`]?.trim() || '',
    key: process.env[`RESEARCH_MODEL_KEY_${suffix}`]?.trim() || '',
    reasoning_effort: (process.env[`RESEARCH_REASONING_${suffix}`]?.trim() || effort) as 'low' | 'medium' | 'high',
  }
}

function envProxy(): ProxySettings {
  const url = (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '').trim()
  return { enabled: Boolean(url), url }
}

function envDocument(): DocumentSettings {
  return {
    model: process.env.RESEARCH_DOCUMENT_MODEL?.trim() || 'deepseek-v4-flash',
    url: process.env.RESEARCH_DOCUMENT_MODEL_URL?.trim() || 'http://127.0.0.1:3000/v1',
    key: process.env.RESEARCH_DOCUMENT_MODEL_KEY?.trim() || process.env.RESEARCH_MODEL_KEY_MEDIUM?.trim() || '',
  }
}

function envVision(): VisionSettings {
  return {
    model: process.env.RESEARCH_VISION_MODEL?.trim() || 'mimo-v2.5',
    url: process.env.RESEARCH_VISION_MODEL_URL?.trim() || 'http://10.31.107.77:3000/v1',
    key: process.env.RESEARCH_VISION_MODEL_KEY?.trim() || process.env.RESEARCH_MODEL_KEY_MEDIUM?.trim() || '',
  }
}

function envImageGeneration(): ImageGenerationSettings {
  return {
    model: process.env.RESEARCH_IMAGE_MODEL?.trim() || 'gpt-image-2-official',
    url: process.env.RESEARCH_IMAGE_MODEL_URL?.trim() || 'https://api.apimart.ai/v1',
    key: process.env.RESEARCH_IMAGE_MODEL_KEY?.trim() || '',
    resolution: (process.env.RESEARCH_IMAGE_RESOLUTION?.trim() || '1k') as ImageGenerationSettings['resolution'],
    quality: (process.env.RESEARCH_IMAGE_QUALITY?.trim() || 'low') as ImageGenerationSettings['quality'],
  }
}

export function privateModelSettings() {
  const merged = envModelDefaults()
  if (!existsSync(settingsPath)) return merged
  const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<typeof merged>
  for (const tier of ['simple', 'medium', 'complex'] as const) {
    const item = saved[tier]
    if (!item) continue
    for (const field of ['model', 'url', 'key', 'reasoning_effort'] as const) if (item[field]) merged[tier][field] = item[field] as never
  }
  const savedProxy = saved.proxy
  if (savedProxy && typeof savedProxy.enabled === 'boolean' && typeof savedProxy.url === 'string') {
    merged.proxy = { enabled: savedProxy.enabled, url: savedProxy.url }
  }
  const savedDocument = saved.document
  if (savedDocument && typeof savedDocument === 'object') {
    for (const field of ['model', 'url', 'key'] as const) {
      if (typeof savedDocument[field] === 'string' && savedDocument[field]) merged.document[field] = savedDocument[field] as never
    }
  }
  const savedVision = saved.vision
  if (savedVision && typeof savedVision === 'object') {
    for (const field of ['model', 'url', 'key'] as const) {
      if (typeof savedVision[field] === 'string' && savedVision[field]) merged.vision[field] = savedVision[field] as never
    }
  }
  const savedImage = saved.image_generation
  if (savedImage && typeof savedImage === 'object') {
    for (const field of ['model', 'url', 'key', 'resolution', 'quality'] as const) {
      const value = savedImage[field]
      if (typeof value === 'string' && value) merged.image_generation[field] = value as never
    }
  }
  return merged
}

export function publicModelSettings() {
  const settings = privateModelSettings()
  return Object.fromEntries((['simple', 'medium', 'complex'] as const).map(tier => [tier, {
    model: settings[tier].model,
    url: settings[tier].url,
    reasoning_effort: settings[tier].reasoning_effort,
    key_configured: Boolean(settings[tier].key),
    source: existsSync(settingsPath) ? 'runtime_override' : 'env_default',
  }]))
}

export function publicProxySettings() {
  return privateModelSettings().proxy
}

export function publicDocumentSettings() {
  const settings = privateModelSettings()
  return {
    model: settings.document.model,
    url: settings.document.url,
    key_configured: Boolean(settings.document.key),
    source: existsSync(settingsPath) ? 'runtime_override' : 'env_default',
  }
}

export function publicVisionSettings() {
  const settings = privateModelSettings()
  return {
    model: settings.vision.model,
    url: settings.vision.url,
    key_configured: Boolean(settings.vision.key),
    source: existsSync(settingsPath) ? 'runtime_override' : 'env_default',
  }
}

export function publicImageGenerationSettings() {
  const settings = privateModelSettings()
  return {
    model: settings.image_generation.model,
    url: settings.image_generation.url,
    key_configured: Boolean(settings.image_generation.key),
    resolution: settings.image_generation.resolution,
    quality: settings.image_generation.quality,
    source: existsSync(settingsPath) ? 'runtime_override' : 'env_default',
  }
}

export function saveModelSettings(input: unknown) {
  const parsed = modelSettingsRequest.parse(input)
  const current = privateModelSettings()
  for (const tier of ['simple', 'medium', 'complex'] as const) {
    current[tier] = { ...parsed[tier], key: parsed[tier].key.trim() || current[tier].key }
  }
  if (parsed.proxy) {
    current.proxy = { enabled: parsed.proxy.enabled, url: parsed.proxy.url.trim() }
  }
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
  return publicModelSettings()
}

export function saveDocumentSettings(input: unknown) {
  const parsed = documentModelSettingsRequest.parse(input)
  const current = privateModelSettings()
  current.document = {
    model: parsed.model.trim(),
    url: parsed.url.trim(),
    key: parsed.key.trim() || current.document.key,
  }
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
  return publicDocumentSettings()
}

export function saveVisionSettings(input: unknown) {
  const parsed = visionModelSettingsRequest.parse(input)
  const current = privateModelSettings()
  current.vision = {
    model: parsed.model.trim(),
    url: parsed.url.trim(),
    key: parsed.key.trim() || current.vision.key,
  }
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
  return publicVisionSettings()
}

export function saveImageGenerationSettings(input: unknown) {
  const parsed = imageGenerationSettingsRequest.parse(input)
  const current = privateModelSettings()
  current.image_generation = {
    model: parsed.model.trim(),
    url: parsed.url.trim(),
    key: parsed.key.trim() || current.image_generation.key,
    resolution: parsed.resolution,
    quality: parsed.quality,
  }
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
  return publicImageGenerationSettings()
}

export function saveProxySettings(input: unknown) {
  const parsed = proxySettingsRequest.parse(input)
  const current = privateModelSettings()
  current.proxy = { enabled: parsed.enabled, url: parsed.url.trim() }
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
  return current.proxy
}
