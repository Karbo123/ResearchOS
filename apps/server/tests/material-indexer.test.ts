import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectArtifactPath, projectRoot } from '../src/project-storage.js'
import { MATERIAL_CHUNK_OVERLAP_CHARS, MAX_MATERIAL_CHUNK_CHARS, extractMaterialChunks } from '../src/material-indexer.js'

describe('bounded material indexing', () => {
  it('splits text into bounded deterministic chunks with overlap', async () => {
    const content = 'research '.repeat(2_000)
    const projectId = crypto.randomUUID()
    const relativePath = join('test-materials', `${crypto.randomUUID()}.txt`)
    const absolutePath = projectArtifactPath(projectId, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content)
    const file = {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: 'notes.txt',
      relative_path: relativePath,
      mime_type: 'text/plain',
      size_bytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
      metadata: {},
    }
    try {
      const result = await extractMaterialChunks(file)
      expect(result.parse_status).toBe('text_chunked')
      expect(result.raw_upload).toBe(false)
      expect(result.chunks.length).toBeGreaterThan(1)
      expect(result.chunks.every(chunk => chunk.content.length <= MAX_MATERIAL_CHUNK_CHARS)).toBe(true)
      expect(result.chunks[0]?.content_sha256).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      rmSync(projectRoot(projectId), { recursive: true, force: true })
    }
    expect(MAX_MATERIAL_CHUNK_CHARS).toBeGreaterThan(MATERIAL_CHUNK_OVERLAP_CHARS)
  })
})
