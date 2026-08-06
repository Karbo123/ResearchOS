import { privateModelSettings } from './model-settings.js'
import { privateProjectModelSettings, privateProjectVoiceSettings } from './project-settings.js'
import { projectEmbeddingSettings } from './project-embedding-settings.js'
import { createProxyFetch } from './proxy-fetch.js'
import { privateVoiceSettings } from './voice-settings.js'

export type ModelProxyKind = 'simple' | 'medium' | 'complex' | 'document' | 'vision' | 'image' | 'voice' | 'embedding'

export function modelUsesProxy(kind: ModelProxyKind, projectId?: string, override?: boolean): boolean {
  if (typeof override === 'boolean') return override
  if (kind === 'voice') {
    const settings = projectId ? privateProjectVoiceSettings(projectId) : privateVoiceSettings()
    return settings.use_proxy
  }
  if (kind === 'embedding') {
    return projectId ? projectEmbeddingSettings(projectId).use_proxy : false
  }
  const source = projectId ? privateProjectModelSettings(projectId) : privateModelSettings()
  if (kind === 'image') return source.image_generation.use_proxy
  if (kind === 'document') return source.document.use_proxy
  if (kind === 'vision') return source.vision.use_proxy
  return source[kind].use_proxy
}

export function modelProxyFetch(kind: ModelProxyKind, projectId?: string, override?: boolean) {
  return createProxyFetch({ useProxy: modelUsesProxy(kind, projectId, override) })
}
