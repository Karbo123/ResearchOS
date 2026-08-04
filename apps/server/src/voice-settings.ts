import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { voiceProvider, voiceSettingsRequest, type VoiceProvider, type VoiceSettingsRequest } from './contracts.js'
import { runtimeRoot } from './paths.js'

export interface VoiceSettings {
  provider: VoiceProvider
  model: string
  url: string
  key: string
}

const settingsPath = resolve(runtimeRoot, 'voice-settings.json')

function normalizeProvider(value: string | undefined | null): VoiceProvider {
  const candidate = value?.trim().toLowerCase()
  if (candidate === 'groq' || candidate === 'api') return 'api'
  return 'browser'
}

export function envDefaults(): VoiceSettings {
  const configuredProvider = process.env.RESEARCH_VOICE_PROVIDER?.trim().toLowerCase()
  return {
    provider: normalizeProvider(configuredProvider),
    model: process.env.RESEARCH_VOICE_API_MODEL?.trim()
      || process.env.RESEARCH_VOICE_GROQ_MODEL?.trim()
      || 'whisper-large-v3-turbo',
    url: process.env.RESEARCH_VOICE_API_URL?.trim()
      || process.env.RESEARCH_VOICE_GROQ_URL?.trim()
      || 'https://api.groq.com/openai/v1',
    key: process.env.RESEARCH_VOICE_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim() || '',
  }
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function readSavedSettings(): Partial<VoiceSettings> {
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<VoiceSettings>
  } catch {
    return {}
  }
}

export function privateVoiceSettings(): VoiceSettings {
  const defaults = envDefaults()
  const saved = readSavedSettings()
  return {
    provider: voiceProvider.safeParse(saved.provider).success ? normalizeProvider(saved.provider) : defaults.provider,
    model: String(saved.model || defaults.model),
    url: String(saved.url || defaults.url),
    key: typeof saved.key === 'string' && saved.key ? saved.key : defaults.key,
  }
}

export function publicVoiceSettings() {
  const settings = privateVoiceSettings()
  return {
    provider: settings.provider,
    model: settings.model,
    url: settings.url,
    key_configured: Boolean(settings.key),
    source: existsSync(settingsPath) ? 'runtime_override' : 'env_default',
  }
}

export function saveVoiceSettings(input: unknown) {
  const parsed: VoiceSettingsRequest = voiceSettingsRequest.parse(input)
  const current = privateVoiceSettings()
  const next: VoiceSettings = {
    provider: normalizeProvider(parsed.provider),
    model: parsed.model.trim() || current.model,
    url: parsed.url.trim() || current.url,
    key: parsed.key.trim() || current.key,
  }
  atomicWrite(settingsPath, next)
  return publicVoiceSettings()
}
