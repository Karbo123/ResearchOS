import { testProjectSlug } from './test-project.js'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'
import { projectArtifactPath, projectRoot } from '../src/project-storage.js'

const projectId = testProjectSlug()
const sessionId = crypto.randomUUID()
const artifactId = crypto.randomUUID()
const uploadId = crypto.randomUUID()

describe('project deletion isolation', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,pinned,sidebar_order) VALUES ($1,$2,$3,FALSE,0)', [projectId, `delete-test-${projectId.slice(0, 8)}`, 'Delete me'])
    await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft) VALUES ($1,$2,$3,$4)', [sessionId, projectId, 'supervising', {}])
    const artifactPath = projectArtifactPath(projectId, 'test-result.txt')
    const uploadPath = projectArtifactPath(projectId, `uploads/${uploadId}.txt`)
    mkdirSync(projectArtifactPath(projectId, 'uploads'), { recursive: true })
    writeFileSync(artifactPath, 'artifact')
    writeFileSync(uploadPath, 'upload')
    await database.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)', [artifactId, projectId, 'test', 'test-result.txt', 'artifacts/test-result.txt', 'text/plain', createHash('sha256').update('artifact').digest('hex')])
    await database.query('INSERT INTO uploaded_files(id,session_id,project_id,name,relative_path,mime_type,size_bytes,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [uploadId, sessionId, projectId, 'upload.txt', `artifacts/uploads/${uploadId}.txt`, 'text/plain', 6, createHash('sha256').update('upload').digest('hex')])
  })

  afterAll(async () => {
    await database.query('DELETE FROM projects WHERE id=$1', [projectId]).catch(() => undefined)
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('requires both the exact title and DELETE confirmation', async () => {
    const response = await app.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_title: 'Wrong title', confirmation: 'DELETE' }),
    })
    expect(response.status).toBe(422)
    expect(existsSync(projectRoot(projectId))).toBe(true)
  })

  it('removes pinned project records, files, and the project directory', async () => {
    const pinResponse = await app.request(`/api/projects/${projectId}/pin`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    expect(pinResponse.status).toBe(200)
    expect((await pinResponse.json()) as { pinned: boolean }).toMatchObject({ pinned: true })

    const response = await app.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_title: 'Delete me', confirmation: 'DELETE' }),
    })
    expect(response.status).toBe(200)
    expect(existsSync(projectRoot(projectId))).toBe(false)
    await expect(database.query('SELECT id FROM projects WHERE id=$1', [projectId])).resolves.toMatchObject({ rows: [] })
    await expect(database.query('SELECT id FROM artifacts WHERE id=$1', [artifactId])).resolves.toMatchObject({ rows: [] })
    await expect(database.query('SELECT id FROM uploaded_files WHERE id=$1', [uploadId])).resolves.toMatchObject({ rows: [] })
  })
})
