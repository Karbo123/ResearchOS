import { testProjectSlug } from './test-project.js'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runtimeRoot } from '../src/paths.js'
import {
  computedEmbeddingSettings,
  GLOBAL_POOL_KEY,
  hasProjectEmbeddingOverride,
  poolForKey,
  poolKeyOf,
  projectEmbeddingSettings,
  projectsUsingPool,
  publicProjectEmbeddingSettings,
  saveProjectEmbeddingSettings,
  usedProjectEmbeddingPorts,
} from '../src/project-embedding-settings.js'

const embeddingEnvKeys = [
  'SUPERMEMORY_EMBEDDING_PROVIDER',
  'SUPERMEMORY_EMBEDDING_MODEL',
  'SUPERMEMORY_EMBEDDING_DIMENSIONS',
  'SUPERMEMORY_EMBEDDING_BASE_URL',
  'SUPERMEMORY_EMBEDDING_API_KEY',
] as const

const localCustom = {
  mode: 'custom' as const,
  provider: 'local' as const,
  model: 'Xenova/bge-m3',
  dimensions: 1024,
  base_url: '',
  key: '',
  reset_data: false,
}

describe('project-level embedding settings', () => {
  beforeEach(() => {
    for (const name of ['project-embedding-settings.json', 'embedding-pools.json']) {
      const path = resolve(runtimeRoot, name)
      if (existsSync(path)) rmSync(path, { force: true })
    }
  })

  afterEach(() => {
    for (const key of embeddingEnvKeys) delete process.env[key]
  })

  it('falls back to the global .env defaults when a project has no override', () => {
    const projectId = testProjectSlug()
    expect(hasProjectEmbeddingOverride(projectId)).toBe(false)
    expect(projectEmbeddingSettings(projectId)).toMatchObject({
      provider: 'local',
      model: 'Xenova/bge-m3',
      dimensions: 1024,
      pool_key: GLOBAL_POOL_KEY,
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

  it('stores a custom configuration in a registered pool and never exposes the key', () => {
    const projectId = testProjectSlug()
    const { released_pool_keys } = saveProjectEmbeddingSettings(projectId, localCustom)
    expect(released_pool_keys).toEqual([])
    const saved = projectEmbeddingSettings(projectId)
    expect(saved).toMatchObject({ provider: 'local', model: 'Xenova/bge-m3', dimensions: 1024 })
    expect(saved.pool_key).not.toBe(GLOBAL_POOL_KEY)
    const pool = poolForKey(saved.pool_key)
    expect(pool).toBeDefined()
    expect(pool!.port).toBeGreaterThanOrEqual(6770)
    expect(pool!.port).toBeLessThanOrEqual(6869)
    expect(publicProjectEmbeddingSettings(projectId)).toMatchObject({ mode: 'custom', source: 'project_override' })
    expect('key' in publicProjectEmbeddingSettings(projectId)).toBe(false)
  })

  it('reuses one pool for projects with identical configuration', () => {
    const first = testProjectSlug('pool-alpha')
    const second = testProjectSlug('pool-beta')
    saveProjectEmbeddingSettings(first, localCustom)
    saveProjectEmbeddingSettings(second, localCustom)
    const firstKey = projectEmbeddingSettings(first).pool_key
    const secondKey = projectEmbeddingSettings(second).pool_key
    expect(firstKey).toBe(secondKey)
    expect(projectsUsingPool(firstKey)).toEqual(expect.arrayContaining([first, second]))
    expect(projectsUsingPool(firstKey)).toHaveLength(2)
    const ports = usedProjectEmbeddingPorts()
    expect(ports.filter(port => port === poolForKey(firstKey)!.port)).toHaveLength(1)
  })

  it('releases a pool when the last project leaves it', () => {
    const first = testProjectSlug('release-alpha')
    const second = testProjectSlug('release-beta')
    saveProjectEmbeddingSettings(first, localCustom)
    saveProjectEmbeddingSettings(second, localCustom)
    const poolKey = projectEmbeddingSettings(first).pool_key
    const secondSave = saveProjectEmbeddingSettings(second, { ...localCustom, provider: 'openai', model: 'Qwen3-Embedding-8B', base_url: 'https://ai.gitee.com/v1', key: 'k' })
    // first still uses the local pool
    expect(projectsUsingPool(poolKey)).toEqual([first])
    expect(secondSave.released_pool_keys).not.toContain(poolKey)
    const firstSave = saveProjectEmbeddingSettings(first, { mode: 'global', provider: 'local', model: '', dimensions: 1024, base_url: '', key: '', reset_data: false })
    expect(firstSave.released_pool_keys).toContain(poolKey)
    expect(poolForKey(poolKey)).toBeUndefined()
  })

  it('persists an existing key when an update leaves the key blank', () => {
    const projectId = testProjectSlug()
    const remote = {
      mode: 'custom' as const,
      provider: 'openai' as const,
      model: 'Qwen3-Embedding-8B',
      dimensions: 1024,
      base_url: 'https://ai.gitee.com/v1',
      key: 'project-secret-key',
      reset_data: false,
    }
    saveProjectEmbeddingSettings(projectId, remote)
    expect(projectEmbeddingSettings(projectId).key).toBe('project-secret-key')
    saveProjectEmbeddingSettings(projectId, { ...remote, key: '' })
    expect(projectEmbeddingSettings(projectId).key).toBe('project-secret-key')
  })

  it('requires a base URL and key for remote providers', () => {
    const projectId = testProjectSlug()
    expect(() => saveProjectEmbeddingSettings(projectId, {
      ...localCustom,
      provider: 'openai',
      model: 'Qwen3-Embedding-8B',
      base_url: '',
      key: '',
    })).toThrow('embedding_remote_base_url_required')
    expect(() => saveProjectEmbeddingSettings(projectId, {
      ...localCustom,
      provider: 'openai',
      model: 'Qwen3-Embedding-8B',
      base_url: 'https://ai.gitee.com/v1',
      key: '',
    })).toThrow('embedding_remote_key_required')
  })

  it('marks a model or dimension change as requiring re-ingestion but not base-url-only changes', () => {
    const projectId = testProjectSlug()
    const remote = {
      mode: 'custom' as const,
      provider: 'openai' as const,
      model: 'Qwen3-Embedding-8B',
      dimensions: 1024,
      base_url: 'https://ai.gitee.com/v1',
      key: 'k',
      reset_data: false,
    }
    saveProjectEmbeddingSettings(projectId, remote)
    const previous = projectEmbeddingSettings(projectId)
    const same = computedEmbeddingSettings(projectId, remote, previous)
    expect(same.reset_required).toBe(false)
    expect(same.pool_key).toBe(previous.pool_key)
    const changed = computedEmbeddingSettings(projectId, { ...remote, model: 'Qwen3-Embedding-4B' }, previous)
    expect(changed.reset_required).toBe(true)
    expect(changed.pool_key).not.toBe(previous.pool_key)
    const dimensionChanged = computedEmbeddingSettings(projectId, { ...remote, dimensions: 768 }, previous)
    expect(dimensionChanged.reset_required).toBe(true)
    const baseUrlOnly = computedEmbeddingSettings(projectId, { ...remote, base_url: 'https://ai.gitee.com/v2' }, previous)
    expect(baseUrlOnly.reset_required).toBe(false)
    expect(baseUrlOnly.pool_key).not.toBe(previous.pool_key)
  })

  it('removes the override when switching back to the global mode', () => {
    const projectId = testProjectSlug()
    saveProjectEmbeddingSettings(projectId, localCustom)
    expect(hasProjectEmbeddingOverride(projectId)).toBe(true)
    saveProjectEmbeddingSettings(projectId, { mode: 'global', provider: 'local', model: '', dimensions: 1024, base_url: '', key: '', reset_data: false })
    expect(hasProjectEmbeddingOverride(projectId)).toBe(false)
    expect(publicProjectEmbeddingSettings(projectId).mode).toBe('global')
  })

  it('derives the same pool key only for byte-identical configuration', () => {
    const a = poolKeyOf({ provider: 'local', model: 'Xenova/bge-m3', dimensions: 1024, base_url: '', key: '' })
    const b = poolKeyOf({ provider: 'local', model: 'Xenova/bge-m3', dimensions: 1024, base_url: '', key: '' })
    const c = poolKeyOf({ provider: 'local', model: 'Xenova/bge-m3', dimensions: 768, base_url: '', key: '' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
