import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { parseMetricsJsonl } from './metrics-service.js'

export const MAX_ARTIFACT_PREVIEW_BYTES = 20 * 1024 * 1024
const MAX_TEXT_PREVIEW_BYTES = 1_000_000
const MAX_TABLE_ROWS = 200
const MAX_POINT_PREVIEW = 5_000

export async function verifyArtifactFile(path: string, expectedSha256?: string) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('artifact_not_regular_file')
  if (!expectedSha256) return { stat, sha256: null }
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  const sha256 = hash.digest('hex')
  if (sha256 !== expectedSha256.toLowerCase()) throw new Error('artifact_hash_mismatch')
  return { stat, sha256 }
}

function sampled<T>(items: T[], limit: number): { items: T[]; sampled: boolean } {
  if (items.length <= limit) return { items, sampled: false }
  const stride = (items.length - 1) / (limit - 1)
  return { items: Array.from({ length: limit }, (_, index) => items[Math.round(index * stride)]!), sampled: true }
}

function previewHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function parseAsciiPly(content: string) {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== 'ply') throw new Error('ply_header_invalid')
  if (!lines.some(line => line.trim() === 'format ascii 1.0')) throw new Error('ply_binary_not_previewable')
  const vertexIndex = lines.findIndex(line => /^element\s+vertex\s+\d+\s*$/.test(line.trim()))
  if (vertexIndex < 0) throw new Error('ply_vertex_element_missing')
  const sourcePointCount = Number(lines[vertexIndex]!.trim().split(/\s+/)[2])
  const headerEnd = lines.findIndex(line => line.trim() === 'end_header')
  if (headerEnd < 0) throw new Error('ply_header_end_missing')
  const points: number[][] = []
  const faces: number[][] = []
  let cursor = headerEnd + 1
  for (let index = 0; index < sourcePointCount && cursor < lines.length; index += 1, cursor += 1) {
    const values = lines[cursor]!.trim().split(/\s+/).slice(0, 3).map(Number)
    if (values.length !== 3 || values.some(value => !Number.isFinite(value))) throw new Error('ply_vertex_invalid')
    points.push(values)
  }
  for (; cursor < lines.length && faces.length < 2_000; cursor += 1) {
    const values = lines[cursor]!.trim().split(/\s+/).map(Number)
    if (values.length < 4 || values.some(value => !Number.isInteger(value))) continue
    const count = values[0]!
    if (count >= 3 && count <= 32 && values.length >= count + 1) faces.push(values.slice(1, count + 1))
  }
  const result = sampled(points, MAX_POINT_PREVIEW)
  return { type: 'point_cloud', format: 'ply', points: result.items, faces, source_point_count: sourcePointCount, sampled: result.sampled }
}

function parseTable(content: string, delimiter: string) {
  const rows = content.split(/\r?\n/).filter(line => line.length > 0).slice(0, MAX_TABLE_ROWS)
    .map(line => line.split(delimiter).slice(0, 100).map(cell => cell.slice(0, 2_000)))
  return { type: 'table', format: delimiter === '\t' ? 'tsv' : 'csv', rows, truncated: content.split(/\r?\n/).length > MAX_TABLE_ROWS }
}

export function buildArtifactPreview(path: string, name: string, mimeType: string, downloadUrl: string): Record<string, unknown> {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('artifact_not_regular_file')
  if (stat.size > MAX_ARTIFACT_PREVIEW_BYTES) throw new Error('artifact_preview_too_large')
  const content = readFileSync(path)
  const base = { name, mime_type: mimeType, size_bytes: stat.size, sha256: previewHash(content), download_url: downloadUrl }
  const lower = name.toLowerCase()
  if (mimeType.startsWith('image/')) {
    if (!new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).has(mimeType)) throw new Error('artifact_image_type_unsupported')
    return { ...base, type: 'image' }
  }
  if (mimeType.startsWith('video/')) {
    if (!new Set(['video/mp4', 'video/webm', 'video/quicktime']).has(mimeType)) throw new Error('artifact_video_type_unsupported')
    return { ...base, type: 'video' }
  }
  if (lower.endsWith('.ply')) return { ...base, ...parseAsciiPly(content.toString('utf8')) }
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    const series = parseMetricsJsonl(path)
    const result = sampled(series.points, 5_000)
    return { ...base, type: 'timeseries', points: result.items, point_count: series.points.length, sampled: result.sampled, seeds: series.seeds, units: series.units }
  }
  if (lower.endsWith('.json')) {
    const value = JSON.parse(content.toString('utf8'))
    return { ...base, type: 'json', value }
  }
  if (lower.endsWith('.csv')) return { ...base, ...parseTable(content.toString('utf8').slice(0, MAX_TEXT_PREVIEW_BYTES), ',') }
  if (lower.endsWith('.tsv')) return { ...base, ...parseTable(content.toString('utf8').slice(0, MAX_TEXT_PREVIEW_BYTES), '\t') }
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return { ...base, type: 'pdf', text: '', page_count: null, truncated: false }
  const text = content.subarray(0, MAX_TEXT_PREVIEW_BYTES).toString('utf8')
  return { ...base, type: mimeType === 'text/html' ? 'html_text' : 'text', text, truncated: content.length > MAX_TEXT_PREVIEW_BYTES }
}
