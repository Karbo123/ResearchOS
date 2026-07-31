import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildArtifactPreview, verifyArtifactFile } from '../src/artifact-preview-service.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(name: string, content: string | Uint8Array) {
  const root = mkdtempSync(resolve(tmpdir(), 'research-os-artifact-preview-'))
  roots.push(root)
  const path = resolve(root, name)
  writeFileSync(path, content)
  return path
}

describe('controlled artifact previews', () => {
  it('previews metrics, tables, logs, images, video, and PLY without changing source data', () => {
    const metrics = fixture('metrics.jsonl', [
      JSON.stringify({ step: 0, unit: 'epoch', seed: 13, loss: 1, accuracy: 0.2 }),
      JSON.stringify({ step: 1, unit: 'epoch', seed: 13, loss: 0.5, accuracy: 0.8 }),
    ].join('\n'))
    const table = fixture('results.csv', 'name,score\nmodel-a,0.9\n')
    const log = fixture('run.log', 'started\nfinished\n')
    const image = fixture('plot.png', new Uint8Array([137, 80, 78, 71]))
    const video = fixture('clip.mp4', new Uint8Array([0, 0, 0, 0]))
    const ply = fixture('cloud.ply', 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n')

    expect(buildArtifactPreview(metrics, 'metrics.jsonl', 'application/x-ndjson', '/download')).toMatchObject({ type: 'timeseries', point_count: 2, seeds: [13] })
    expect(buildArtifactPreview(table, 'results.csv', 'text/csv', '/download')).toMatchObject({ type: 'table', rows: [['name', 'score'], ['model-a', '0.9']] })
    expect(buildArtifactPreview(log, 'run.log', 'text/plain', '/download')).toMatchObject({ type: 'text', text: 'started\nfinished\n' })
    expect(buildArtifactPreview(image, 'plot.png', 'image/png', '/download')).toMatchObject({ type: 'image' })
    expect(buildArtifactPreview(video, 'clip.mp4', 'video/mp4', '/download')).toMatchObject({ type: 'video' })
    expect(buildArtifactPreview(ply, 'cloud.ply', 'model/ply', '/download')).toMatchObject({ type: 'point_cloud', source_point_count: 3, faces: [[0, 1, 2]] })
    expect(readFileSync(metrics, 'utf8')).toContain('"loss":1')
  })

  it('rejects unsupported media and non-regular files', () => {
    const image = fixture('plot.png', new Uint8Array([1, 2, 3]))
    const directoryRoot = mkdtempSync(resolve(tmpdir(), 'research-os-artifact-dir-'))
    roots.push(directoryRoot)
    mkdirSync(resolve(directoryRoot, 'nested'))
    expect(() => buildArtifactPreview(image, 'plot.png', 'image/tiff', '/download')).toThrow('artifact_image_type_unsupported')
    expect(() => buildArtifactPreview(resolve(directoryRoot, 'nested'), 'nested', 'text/plain', '/download')).toThrow('artifact_not_regular_file')
  })

  it('detects content changes before download or preview', async () => {
    const path = fixture('data.json', '{"ok":true}\n')
    const expected = createHash('sha256').update(readFileSync(path)).digest('hex')
    await expect(verifyArtifactFile(path, expected)).resolves.toMatchObject({ sha256: expected })
    writeFileSync(path, '{"ok":false}\n')
    await expect(verifyArtifactFile(path, expected)).rejects.toThrow('artifact_hash_mismatch')
  })
})
