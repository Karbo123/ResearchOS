import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { modelSettingsRequest, type ModelTier } from './contracts.js'
import { runtimeRoot } from './paths.js'

const settingsPath = resolve(runtimeRoot, 'model-settings.json')
const defaults: Record<ModelTier, { model: string; url: string; key: string; reasoning_effort: 'low' | 'medium' | 'high' }> = {
  simple: envTier('SIMPLE', 'gpt-5.6-luna', 'low'),
  medium: envTier('MEDIUM', 'gpt-5.6-terra', 'medium'),
  complex: envTier('COMPLEX', 'gpt-5.6-sol', 'high'),
}

function envTier(suffix: string, model: string, effort: 'low' | 'medium' | 'high') {
  return {
    model: process.env[`RESEARCH_MODEL_${suffix}`]?.trim() || model,
    url: process.env[`RESEARCH_MODEL_URL_${suffix}`]?.trim() || '',
    key: process.env[`RESEARCH_MODEL_KEY_${suffix}`]?.trim() || '',
    reasoning_effort: (process.env[`RESEARCH_REASONING_${suffix}`]?.trim() || effort) as 'low' | 'medium' | 'high',
  }
}

export function privateModelSettings() {
  const merged = structuredClone(defaults)
  if (!existsSync(settingsPath)) return merged
  const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<typeof merged>
  for (const tier of ['simple', 'medium', 'complex'] as const) {
    const item = saved[tier]
    if (!item) continue
    for (const field of ['model', 'url', 'key', 'reasoning_effort'] as const) if (item[field]) merged[tier][field] = item[field] as never
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

export function saveModelSettings(input: unknown) {
  const parsed = modelSettingsRequest.parse(input)
  const current = privateModelSettings()
  for (const tier of ['simple', 'medium', 'complex'] as const) {
    current[tier] = { ...parsed[tier], key: parsed[tier].key.trim() || current[tier].key }
  }
  const temporary = `${settingsPath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, settingsPath)
  return publicModelSettings()
}
