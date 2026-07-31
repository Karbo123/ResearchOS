import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Supermemory } from 'supermemory'
import { database, migrate, one } from '../src/database.js'
import { ingestConversationMemory, ingestProjectMemory, memoryStatus, projectContainerTag, searchProjectMemory } from '../src/supermemory-service.js'

const projectId = crypto.randomUUID()

describe('project-scoped Supermemory contract', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `supermemory-test-${projectId.slice(0, 8)}`, 'Supermemory test project'])
  })

  afterAll(async () => {
    await database.query('DELETE FROM memory_links WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  })

  it('does not expose the API key and reports configuration state', () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
    delete process.env.SUPERMEMORY_API_KEY
    process.env.SUPERMEMORY_ENABLED = 'false'
    try {
      expect(memoryStatus()).toEqual({
        enabled: false,
        key_configured: false,
        base_url: 'https://api.supermemory.ai',
        scope: 'project_container_tag',
      })
    } finally {
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
      if (previousEnabled === undefined) delete process.env.SUPERMEMORY_ENABLED
      else process.env.SUPERMEMORY_ENABLED = previousEnabled
    }
  })

  it('fails directly when project memory is requested without a key', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    delete process.env.SUPERMEMORY_API_KEY
    try {
      await expect(searchProjectMemory(crypto.randomUUID(), 'test query', 5)).rejects.toMatchObject({ code: 'supermemory_not_configured', status: 503 })
    } finally {
      if (previousKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = previousKey
    }
  })

  it('keeps project scope deterministic and records failed ingestion without semantic fallback', async () => {
    const previousKey = process.env.SUPERMEMORY_API_KEY
    const previousEnabled = process.env.SUPERMEMORY_ENABLED
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
    }
  })

  it('uses separate remote containers when replaying project conversations', async () => {
    const secondProjectId = crypto.randomUUID()
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
})
