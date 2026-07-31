import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ModelConfig, ModelTier } from './contracts.js'
import { modelConfigSchema } from './contracts.js'
import { researchRoot } from './env.js'

const DEFAULTS: Record<ModelTier, { model: string; reasoningEffort: 'low' | 'medium' | 'high' }> = {
  simple: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
  medium: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
  complex: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
}
export class ModelConfigurationError extends Error {}

function isAllowedModelUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  const match = /^172\.(\d+)\./.exec(host)
  return match !== null && Number(match[1]) >= 16 && Number(match[1]) <= 31
}

function environmentSettings(tier: ModelTier): ModelConfig {
  const suffix = tier.toUpperCase()
  return {
    model: (process.env[`RESEARCH_MODEL_${suffix}`] || DEFAULTS[tier].model).trim(),
    url: (process.env[`RESEARCH_MODEL_URL_${suffix}`] || '').trim(),
    key: (process.env[`RESEARCH_MODEL_KEY_${suffix}`] || '').trim(),
    reasoningEffort: (
      process.env[`RESEARCH_REASONING_${suffix}`] || DEFAULTS[tier].reasoningEffort
    ).trim() as ModelConfig['reasoningEffort'],
  }
}

export function loadModelConfig(tier: ModelTier): ModelConfig {
  const merged = environmentSettings(tier)
  const path = process.env.MODEL_SETTINGS_PATH || resolve(researchRoot, 'runtime', 'model-settings.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>
    const item = parsed[tier]
    if (!item || typeof item !== 'object') throw new ModelConfigurationError('invalid settings tier')
    for (const field of ['model', 'url', 'key'] as const) {
      const value = typeof item[field] === 'string' ? item[field].trim() : ''
      if (value) merged[field] = value
    }
    const effort = typeof item.reasoning_effort === 'string' ? item.reasoning_effort.trim() : ''
    if (effort) merged.reasoningEffort = effort as ModelConfig['reasoningEffort']
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof ModelConfigurationError) throw error
      if (error instanceof SyntaxError) throw new ModelConfigurationError('model settings file is invalid')
      throw error
    }
  }
  const result = modelConfigSchema.safeParse(merged)
  if (!result.success || !result.data.key || !isAllowedModelUrl(result.data.url)) {
    throw new ModelConfigurationError(`${tier} model configuration is incomplete`)
  }
  return result.data
}

export function modelId(model: string): `${string}/${string}` {
  return (model.includes('/') ? model : `openai/${model}`) as `${string}/${string}`
}
