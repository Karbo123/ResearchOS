import { testProjectSlug } from './test-project.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Supermemory } from 'supermemory'
import { database, migrate, one } from '../src/database.js'
import { applyMemoryRevocation, ingestConversationMemory, ingestProjectMemory, memoryStatus, projectContainerTag, searchProjectMemory } from '../src/supermemory-service.js'

const projectId = testProjectSlug()
const embeddingEnvKeys = [
  'SUPERMEMORY_EMBEDDING_PROVIDER',
  'SUPERMEMORY_EMBEDDING_MODEL',
  'SUPERMEMORY_EMBEDDING_DIMENSIONS',
  'SUPERMEMORY_EMBEDDING_BASE_URL',
  'SUPERMEMORY_EMBEDDING_API_KEY',
] as const
const savedEmbeddingEnv = new Map<string, string | undefined>()

describe('project-scoped Supermemory contract', () => {
  beforeAll(async () => {
    for (const key of embeddingEnvKeys) savedEmbeddingEnv.set(key, process.env[key])
    for (const key of embeddingEnvKeys) delete process.env[key]
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `supermemory-test-${projectId.slice(0, 8)}`, 'Supermemory test project'])
  }, 60_000)

  afterAll(async () => {
    await database.query('DELETE FROM memory_links WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    for (const key of embeddingEnvKeys) {
      const value = savedEmbeddingEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }, 60_000)

  it('does not expose the API key and reports configuration state', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    const previousBaseUrl = process.env.SUPERMEMORY_BASE_URL
    delete process.env.SUPERMEMORY_API_KEY
    process.env.SUPERMEMORY_ENABLED = 'false'
    process.env.SUPERMEMORY_BASE_URL = 'https://api.supermemory.ai'
    try {
      expect(await memoryStatus(projectId)).toEqual({
        enabled: false,
        key_configured: false,
        auth_mode: 'required',
        base_url: 'https://api.supermemory.ai',
        scope: 'project_container_tag',
        instance: { mode: 'global', port: null, running: false, shared_projects: 0 },
        embedding: {
          provider: 'local',
          model: 'Xenova/bge-m3',
          dimensions: 1024,
          base_url: null,
          key_configured: false,
          remote_embedding_supported: true,
          current_build_behavior: 'local_onnx',
        },
      })
    } finally {
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
      if (previousBaseUrl === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = previousBaseUrl
    }
  })

  it('accepts remote embedding configuration when the installed build implements it', async () => {
    const searchProjectId = testProjectSlug('embedding-search')
    const previousApiKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    const previousBaseUrl = process.env.SUPERMEMORY_BASE_URL
    const previousEmbedding = embeddingEnvKeys.map(key => [key, process.env[key]] as const)
    process.env.SUPERMEMORY_API_KEY = 'test-only-key'
    process.env.SUPERMEMORY_ENABLED = 'true'
    process.env.SUPERMEMORY_BASE_URL = 'http://127.0.0.1:6767'
    process.env.SUPERMEMORY_EMBEDDING_PROVIDER = 'openai'
    process.env.SUPERMEMORY_EMBEDDING_MODEL = 'Qwen3-Embedding-8B'
    process.env.SUPERMEMORY_EMBEDDING_DIMENSIONS = '1024'
    process.env.SUPERMEMORY_EMBEDDING_BASE_URL = 'https://ai.gitee.com/v1'
    process.env.SUPERMEMORY_EMBEDDING_API_KEY = 'test-embedding-key'
    const post = vi.spyOn(Supermemory.prototype, 'post').mockResolvedValue({ results: [], total: 0 } as never)
    try {
      await expect(searchProjectMemory(searchProjectId, 'test query', 5)).resolves.toMatchObject({ total: 0 })
      expect(post).toHaveBeenCalledWith('/v4/search', expect.objectContaining({ body: expect.objectContaining({ q: 'test query' }) }))
      expect((await memoryStatus(searchProjectId)).embedding).toMatchObject({
        provider: 'openai',
        model: 'Qwen3-Embedding-8B',
        dimensions: 1024,
        base_url: 'https://ai.gitee.com/v1',
        key_configured: true,
        remote_embedding_supported: true,
        current_build_behavior: 'remote_openai_compatible',
      })
    } finally {
      post.mockRestore()
      for (const [key, value] of previousEmbedding) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      if (previousApiKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousApiKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
      if (previousBaseUrl === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = previousBaseUrl
    }
  })

  it('fails directly when project memory is requested without a key', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousBaseUrl = process.env.SUPERMEMORY_BASE_URL
    delete process.env.SUPERMEMORY_API_KEY
    process.env.SUPERMEMORY_BASE_URL = 'https://api.supermemory.ai'
    try {
      await expect(searchProjectMemory(testProjectSlug('embedding-blocked'), 'test query', 5)).rejects.toMatchObject({ code: 'supermemory_not_configured', status: 503 })
    } finally {
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousBaseUrl === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = previousBaseUrl
    }
  })

  it('keeps project scope deterministic and records failed ingestion without semantic fallback', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    const previousBaseUrl = process.env.SUPERMEMORY_BASE_URL
    delete process.env.SUPERMEMORY_API_KEY
    process.env.SUPERMEMORY_ENABLED = 'false'
    try {
      expect(projectContainerTag(projectId)).toBe(`research-os-project-${projectId}`)
      await expect(ingestProjectMemory(projectId, { source_type: 'manual', content: 'strict failure test', source_id: null, artifact_id: null, source_url: null, quote: null, locator: null, metadata: {}, task_type: 'memory', idempotency_key: null })).rejects.toMatchObject({ code: 'supermemory_not_configured', status: 503 })
      const failed = await one<{ status: string; supermemory_id: string }>('SELECT status,supermemory_id FROM memory_links WHERE project_id=$1', [projectId])
      expect(failed).toMatchObject({ status: 'failed' })
      expect(failed?.supermemory_id).toMatch(/^pending-/)
    } finally {
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
      if (previousBaseUrl === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = previousBaseUrl
    }
  })

  it('uses separate remote containers when replaying project conversations', async () => {
    const secondProjectId = testProjectSlug('supermemory-isolated')
    const sessionId = crypto.randomUUID()
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    process.env.SUPERMEMORY_API_KEY = 'test-only-key'
    process.env.SUPERMEMORY_ENABLED = 'true'
    const add = vi.spyOn(Supermemory.prototype, 'add').mockResolvedValue({ id: 'remote-memory', status: 'done' } as never)
    try {
      await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [secondProjectId, `supermemory-test-${secondProjectId.slice(0, 8)}`, 'Second project'])
      await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft) VALUES ($1,$2,$3,$4)', [sessionId, secondProjectId, 'supervising', {}])
      await database.query('INSERT INTO messages(id,session_id,role,content) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), sessionId, 'user', 'isolated project message'])
      await ingestConversationMemory(secondProjectId, sessionId)
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ containerTag: projectContainerTag(secondProjectId) }))
      expect(projectContainerTag(secondProjectId)).not.toBe(projectContainerTag(projectId))
    } finally {
      add.mockRestore()
      await database.query('DELETE FROM memory_links WHERE project_id=$1', [secondProjectId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [secondProjectId])
      await database.query('DELETE FROM messages WHERE session_id=$1', [sessionId])
      await database.query('DELETE FROM conversation_sessions WHERE id=$1', [sessionId])
      await database.query('DELETE FROM projects WHERE id=$1', [secondProjectId])
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
    }
  })

  it('forgets extracted memory entities resolved from the project container', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    const previousBaseUrl = process.env.SUPERMEMORY_BASE_URL
    process.env.SUPERMEMORY_API_KEY = 'test-only-key'
    process.env.SUPERMEMORY_ENABLED = 'true'
    process.env.SUPERMEMORY_BASE_URL = 'http://127.0.0.1:6767'
    const linkId = crypto.randomUUID()
    const list = vi.spyOn(Supermemory.prototype, 'post').mockResolvedValue({
      memoryEntries: [
        { id: 'memory-entity-1', isForgotten: false, documentIds: ['remote-document-id'] },
        { id: 'memory-entity-2', isForgotten: false, documentIds: ['remote-document-id'] },
        { id: 'memory-entity-3', isForgotten: true, documentIds: ['remote-document-id'] },
        { id: 'memory-entity-other', isForgotten: false, documentIds: ['other-document-id'] },
      ],
      pagination: { currentPage: 1, totalPages: 1 },
    } as never)
    const remove = vi.spyOn(Supermemory.prototype, 'delete').mockResolvedValue({ id: 'memory-entity-1', forgotten: true } as never)
    try {
      await database.query(
        `INSERT INTO memory_links(id,project_id,source_type,source_id,artifact_id,uploaded_file_id,content_sha256,custom_id,supermemory_id,container_tag,task_type,status,metadata) VALUES ($1,$2,'manual',NULL,NULL,NULL,$3,$4,$5,$6,'memory','active',$7)`,
        [linkId, projectId, `sha-${linkId}`, `custom-${linkId}`, 'remote-document-id', projectContainerTag(projectId), JSON.stringify({ test: true })],
      )
      const result = await applyMemoryRevocation(projectId, linkId, 'forget', 'unit-test')
      expect(result.link?.status).toBe('revoked')
      expect(list).toHaveBeenCalledWith('/v4/memories/list', expect.objectContaining({ body: expect.objectContaining({ containerTags: [projectContainerTag(projectId)] }) }))
      expect(remove).toHaveBeenCalledTimes(2)
      expect(remove).toHaveBeenNthCalledWith(1, '/v4/memories', expect.objectContaining({ body: expect.objectContaining({ containerTag: projectContainerTag(projectId), id: 'memory-entity-1' }) }))
      expect(remove).toHaveBeenNthCalledWith(2, '/v4/memories', expect.objectContaining({ body: expect.objectContaining({ containerTag: projectContainerTag(projectId), id: 'memory-entity-2' }) }))
    } finally {
      list.mockRestore()
      remove.mockRestore()
      await database.query('DELETE FROM memory_links WHERE id=$1', [linkId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
      if (previousBaseUrl === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = previousBaseUrl
    }
  })

  it('fails closed with a structured 404 when forget finds no extracted memory entity', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    const previousBaseUrl = process.env.SUPERMEMORY_BASE_URL
    process.env.SUPERMEMORY_API_KEY = 'test-only-key'
    process.env.SUPERMEMORY_ENABLED = 'true'
    process.env.SUPERMEMORY_BASE_URL = 'http://127.0.0.1:6767'
    const linkId = crypto.randomUUID()
    const list = vi.spyOn(Supermemory.prototype, 'post').mockResolvedValue({
      memoryEntries: [],
      pagination: { currentPage: 1, totalPages: 1 },
    } as never)
    try {
      await database.query(
        `INSERT INTO memory_links(id,project_id,source_type,source_id,artifact_id,uploaded_file_id,content_sha256,custom_id,supermemory_id,container_tag,task_type,status,metadata) VALUES ($1,$2,'manual',NULL,NULL,NULL,$3,$4,$5,$6,'memory','active',$7)`,
        [linkId, projectId, `sha-${linkId}`, `custom-${linkId}`, 'remote-document-id', projectContainerTag(projectId), JSON.stringify({ test: true })],
      )
      await expect(applyMemoryRevocation(projectId, linkId, 'forget', 'unit-test')).rejects.toMatchObject({
        code: 'supermemory_memory_entity_not_found',
        status: 404,
      })
    } finally {
      list.mockRestore()
      await database.query('DELETE FROM memory_links WHERE id=$1', [linkId])
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
      if (previousBaseUrl === undefined) delete process.env.SUPERMEMORY_BASE_URL
      else process.env.SUPERMEMORY_BASE_URL = previousBaseUrl
    }
  })
})
