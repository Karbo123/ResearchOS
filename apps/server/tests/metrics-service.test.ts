import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildArtifactPreview } from '../src/artifact-preview-service.js'
import { parseMetricsJsonl } from '../src/metrics-service.js'
import { runtimeRoot } from '../src/paths.js'

const created: string[] = []
afterEach(() => { for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture(name: string, content: string): string {
  const directory = mkdtempSync(join(runtimeRoot, 'metrics-preview-test-'))
  created.push(directory)
  const path = join(directory, name)
  writeFileSync(path, content, 'utf8')
  return path
}

describe('metrics.jsonl and controlled artifact previews', () => {
  it('validates bounded time-series points and records stable hashes', () => {
    const path = fixture('metrics.jsonl', [
      JSON.stringify({ step: 1, unit: 'epoch', seed: 13, loss: 0.8, accuracy: 0.4 }),
      JSON.stringify({ step: 2, unit: 'epoch', seed: 13, loss: 0.5, accuracy: 0.7, validation_accuracy: 0.6 }),
      '',
    ].join('\n'))
    const result = parseMetricsJsonl(path)
    expect(result.points).toHaveLength(2)
    expect(result.seeds).toEqual([13])
    expect(result.units).toEqual(['epoch'])
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects unknown fields and invalid numeric ranges', () => {
    const path = fixture('metrics.jsonl', `${JSON.stringify({ step: 1, unit: 'epoch', loss: -1 })}\n`)
    try { parseMetricsJsonl(path); throw new Error('expected_metrics_validation_failure') }
    catch (error) { expect(error).toMatchObject({ code: 'metrics_jsonl_schema_invalid' }) }
  })

  it('returns a safe PLY point-cloud preview and a time-series preview', () => {
    const ply = fixture('preview.ply', 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n')
    const preview = buildArtifactPreview(ply, 'preview.ply', 'model/ply', '/download')
    expect(preview).toMatchObject({ type: 'point_cloud', format: 'ply', source_point_count: 3, sampled: false })
    expect(preview.faces).toEqual([[0, 1, 2]])

    const series = fixture('metrics.jsonl', `${JSON.stringify({ step: 1, unit: 'epoch', seed: 13, loss: 0.5 })}\n`)
    expect(buildArtifactPreview(series, 'metrics.jsonl', 'application/x-ndjson', '/series')).toMatchObject({ type: 'timeseries', point_count: 1, seeds: [13] })
  })
})
