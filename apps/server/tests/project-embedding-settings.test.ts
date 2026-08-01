import { afterEach, describe, expect, it } from 'vitest'
import {
  computedEmbeddingSettings,
  hasProjectEmbeddingOverride,
  projectEmbeddingSettings,
  publicProjectEmbeddingSettings,
  saveProjectEmbeddingSettings,
} from '../src/project-embedding-settings.js'

const embeddingEnvKeys = [
  'SUPERMEMORY_EMBEDDING_PROVIDER',
  'SUPERMEMORY_EMBEDDING_MODEL',
  'SUPERMEMORY_EMBEDDING_DIMENSIONS',
  'SUPERMEMORY_EMBEDDING_BASE_URL',
  'SUPERMEMORY_EMBEDDING_API_KEY',
] as const

describe('project-level embedding settings', () => {
  afterEach(() => {
    for (const key of embeddingEnvKeys) delete process.env[key]
  })

  it('falls back to the global .env defaults when a project has no override', () => {
    const projectId = crypto.randomUUID()
    expect(hasProjectEmbeddingOverride(projectId)).toBe(false)
    expect(projectEmbeddingSettings(projectId)).toMatchObject({
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimensions: 1024,
      instance_port: null,
    })
    expect(publicProjectEmbeddingSettings(projectId)).toMatchObject({
      project_id: projectId,
      mode: 'global',
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimensions: 1024,
      key_configured: false,
      source: 'env_default',
    })
  })

  it('stores a custom per-project configuration and never exposes the key', () => {
    const projectId = crypto.randomUUID()
    saveProjectEmbeddingSettings(projectId, {
      mode: 'custom',
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimensions: 1024,
      base_url: '',
      key: '',
      reset_data: false,
    })
    const saved = projectEmbeddingSettings(projectId)
    expect(saved).toMatchObject({ provider: 'local', model: 'Xenova/bge-m3', dimensions: 1024 })
    expect(saved.instance_port).toBeGreaterThanOrEqual(6770)
    expect(saved.instance_port).toBeLessThanOrEqual(6869)
    expect(publicProjectEmbeddingSettings(projectId)).toMatchObject({ mode: 'custom', source: 'project_override' })
    expect('key' in publicProjectEmbeddingSettings(projectId)).toBe(false)
  })

  it('persists an existing key when an update leaves the key blank', () => {
    const projectId = crypto.randomUUID()
    saveProjectEmbeddingSettings(projectId, {
      mode: 'custom',
      provider: 'openai',
      model: 'Qwen3-Embedding-8B',
      dimensions: 1024,
      base_url: 'https://ai.gitee.com/v1',
      key: 'project-secret-key',
      reset_data: false,
    })
    expect(projectEmbeddingSettings(projectId).key).toBe('project-secret-key')
    saveProjectEmbeddingSettings(projectId, {
      mode: 'custom',
      provider: 'openai',
      model: 'Qwen3-Embedding-8B',
      dimensions: 1024,
      base_url: 'https://ai.gitee.com/v1',
      key: '',
      reset_data: false,
    })
    expect(projectEmbeddingSettings(projectId).key).toBe('project-secret-key')
  })

  it('requires a base URL and key for remote providers', () => {
    const projectId = crypto.randomUUID()
    expect(() => saveProjectEmbeddingSettings(projectId, {
      mode: 'custom',
      provider: 'openai',
      model: 'Qwen3-Embedding-8B',
      dimensions: 1024,
      base_url: '',
      key: '',
      reset_data: false,
    })).toThrow('embedding_remote_base_url_required')
    expect(() => saveProjectEmbeddingSettings(projectId, {
      mode: 'custom',
      provider: 'openai',
      model: 'Qwen3-Embedding-8B',
      dimensions: 1024,
      base_url: 'https://ai.gitee.com/v1',
      key: '',
      reset_data: false,
    })).toThrow('embedding_remote_key_required')
  })

  it('marks a model or dimension change as requiring a fresh data directory', () => {
    const projectId = crypto.randomUUID()
    const base = {
      mode: 'custom' as const,
      provider: 'local' as const,
      model: 'Xenova/bge-m3',
      dimensions: 1024,
      base_url: '',
      key: '',
      reset_data: false,
    }
    saveProjectEmbeddingSettings(projectId, base)
    const previous = projectEmbeddingSettings(projectId)
    const same = computedEmbeddingSettings(projectId, { ...base, reset_data: true }, previous)
    expect(same.reset_required).toBe(false)
    const changed = computedEmbeddingSettings(projectId, { ...base, model: 'Xenova/bge-base-en-v1.5' }, previous)
    expect(changed.reset_required).toBe(true)
    const dimensionChanged = computedEmbeddingSettings(projectId, { ...base, dimensions: 768 }, previous)
    expect(dimensionChanged.reset_required).toBe(true)
  })

  it('removes the override when switching back to the global mode', () => {
    const projectId = crypto.randomUUID()
    saveProjectEmbeddingSettings(projectId, {
      mode: 'custom',
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimensions: 1024,
      base_url: '',
      key: '',
      reset_data: false,
    })
    expect(hasProjectEmbeddingOverride(projectId)).toBe(true)
    saveProjectEmbeddingSettings(projectId, {
      mode: 'global',
      provider: 'local',
      model: '',
      dimensions: 1024,
      base_url: '',
      key: '',
      reset_data: false,
    })
    expect(hasProjectEmbeddingOverride(projectId)).toBe(false)
    expect(publicProjectEmbeddingSettings(projectId).mode).toBe('global')
  })
})
