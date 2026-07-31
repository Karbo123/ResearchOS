import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { z } from 'zod'

export const metricPointSchema = z.object({
  step: z.number().int().min(0).max(10_000_000),
  unit: z.enum(['epoch', 'batch']),
  seed: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
  loss: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  accuracy: z.number().finite().min(0).max(1).nullable().optional(),
  validation_loss: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  validation_accuracy: z.number().finite().min(0).max(1).nullable().optional(),
  learning_rate: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export type MetricPoint = z.infer<typeof metricPointSchema>
export const MAX_METRICS_JSONL_BYTES = 20 * 1024 * 1024
export const MAX_METRICS_JSONL_LINES = 100_000

export class MetricsValidationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MetricsValidationError'
    this.code = code
  }
}

export type MetricsSeries = {
  points: MetricPoint[]
  bytes: number
  sha256: string
  seeds: number[]
  units: string[]
}

export function parseMetricsJsonl(path: string): MetricsSeries {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new MetricsValidationError('metrics_jsonl_not_regular_file', 'metrics.jsonl 必须是普通文件。')
  if (stat.size > MAX_METRICS_JSONL_BYTES) throw new MetricsValidationError('metrics_jsonl_too_large', 'metrics.jsonl 超过大小限制。')
  const content = readFileSync(path, 'utf8')
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length > MAX_METRICS_JSONL_LINES) throw new MetricsValidationError('metrics_jsonl_too_many_lines', 'metrics.jsonl 超过行数限制。')
  const points: MetricPoint[] = []
  for (const [index, line] of lines.entries()) {
    let value: unknown
    try { value = JSON.parse(line) } catch { throw new MetricsValidationError('metrics_jsonl_invalid_json', `metrics.jsonl 第 ${index + 1} 行不是有效 JSON。`) }
    const parsed = metricPointSchema.safeParse(value)
    if (!parsed.success) throw new MetricsValidationError('metrics_jsonl_schema_invalid', `metrics.jsonl 第 ${index + 1} 行不符合指标契约。`)
    points.push(parsed.data)
  }
  if (!points.length) throw new MetricsValidationError('metrics_jsonl_empty', 'metrics.jsonl 不能是空文件。')
  const seeds = [...new Set(points.map(point => point.seed).filter((seed): seed is number => typeof seed === 'number'))].sort((a, b) => a - b)
  const units = [...new Set(points.map(point => point.unit))]
  return { points, bytes: stat.size, sha256: createHash('sha256').update(content).digest('hex'), seeds, units }
}

export function artifactMimeType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'application/x-ndjson'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.tsv')) return 'text/tab-separated-values'
  if (lower.endsWith('.log') || lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.ply')) return 'model/ply'
  if (lower.endsWith('.pcd')) return 'text/plain'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}
