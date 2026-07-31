import { createScorer } from '@mastra/core/evals'
import type { Mastra } from '@mastra/core'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { z } from 'zod'
import { researchRoot } from './env.js'

const ideaCaseSchema = z.object({
  schema_version: z.literal('1.0'),
  id: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  description: z.string().min(1).max(2_000),
  enabled: z.boolean(),
  clarification_mode: z.enum(['automatic', 'detailed']),
  initial_message: z.string().min(1).max(20_000),
  confirmed_facts: z.record(z.string(), z.string()),
  project_messages: z.object({
    policy_update: z.string().min(1).max(20_000).optional(),
    idea_revision: z.string().min(1).max(20_000).optional(),
  }).strict().default({}),
  expect: z.object({
    model_tier: z.enum(['simple', 'medium', 'complex']).optional(),
    final_feasibility: z.enum(['low', 'medium', 'high']).optional(),
    phase: z.enum(['clarifying', 'ready_for_confirmation']).optional(),
    model: z.string().min(1).max(200).optional(),
    missing_fields_contains: z.array(z.string().min(1).max(200)).max(20).optional(),
    reply_contains_any: z.array(z.string().min(1).max(200)).max(20).optional(),
    reply_excludes: z.array(z.string().min(1).max(200)).max(20).optional(),
  }).strict().refine(value => Object.keys(value).length > 0, '至少需要一个公开验收期望。'),
}).strict()

export const IDEA_DATASET_ID = 'research-os-idea-cases-v1'
export const IDEA_DATASET_VERSION = '1.0'

export class MastraEvalContractError extends Error {
  readonly code = 'mastra_eval_contract_invalid'
  constructor(message: string) {
    super(message)
    this.name = 'MastraEvalContractError'
  }
}

export type IdeaEvalCase = z.infer<typeof ideaCaseSchema>

function caseRoot() {
  return resolve(researchRoot, 'tests', 'idea-cases')
}

export function loadIdeaEvalCases(): Array<IdeaEvalCase & { source: string }> {
  const root = caseRoot()
  const files = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort()
  if (!files.length) throw new MastraEvalContractError('没有可用的 Idea Dataset 源文件。')
  const cases: Array<IdeaEvalCase & { source: string }> = []
  const ids = new Set<string>()
  for (const file of files) {
    const sourcePath = resolve(root, file)
    let value: unknown
    try { value = JSON.parse(readFileSync(sourcePath, 'utf8')) }
    catch { throw new MastraEvalContractError(`Idea Dataset 文件无法解析：${file}`) }
    const parsed = ideaCaseSchema.safeParse(value)
    if (!parsed.success) throw new MastraEvalContractError(`Idea Dataset 文件不符合严格契约：${file}`)
    if (!parsed.data.enabled) continue
    if (ids.has(parsed.data.id)) throw new MastraEvalContractError(`Idea Dataset ID 重复：${parsed.data.id}`)
    ids.add(parsed.data.id)
    cases.push({ ...parsed.data, source: relative(researchRoot, sourcePath).replaceAll('\\', '/') })
  }
  if (!cases.length) throw new MastraEvalContractError('没有启用的 Idea Dataset case。')
  return cases
}

function stable(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort())
}

export function scoreIdeaContract(output: unknown): { score: number; reason: string } {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { score: 0, reason: '输出不是结构化对象。' }
  const value = output as Record<string, unknown>
  const draft = value.draft
  const reply = value.assistant_reply
  const unresolved = value.unresolved_items
  const ready = value.ready_for_confirmation
  const valid = typeof reply === 'string' && reply.length > 0 && typeof ready === 'boolean'
    && Array.isArray(unresolved) && unresolved.every(item => typeof item === 'string')
    && draft !== null && typeof draft === 'object' && !Array.isArray(draft)
  return valid
    ? { score: 1, reason: '输出包含严格 Idea draft、assistant_reply、ready_for_confirmation 和 unresolved_items。' }
    : { score: 0, reason: '输出缺少 Idea 澄清契约要求的字段或字段类型。' }
}

export const ideaClarificationContractScorer = createScorer({
  id: 'idea-clarification-contract',
  name: 'Idea Clarification Contract',
  description: 'Deterministically checks the public structured output contract without calling a language model.',
  type: { input: z.unknown(), output: z.unknown() },
}).generateScore(({ run }) => scoreIdeaContract(run.output).score)
  .generateReason(({ run, score }) => scoreIdeaContract(run.output).reason)

export function runIdeaQuickChecks(cases = loadIdeaEvalCases()) {
  const checks = [
    { id: 'source_schema', passed: cases.every(item => item.schema_version === '1.0'), detail: '所有启用 case 使用 schema 1.0。' },
    { id: 'unique_ids', passed: new Set(cases.map(item => item.id)).size === cases.length, detail: '公开 Dataset ID 唯一。' },
    { id: 'bounded_inputs', passed: cases.every(item => item.initial_message.length <= 20_000 && Object.keys(item.confirmed_facts).length <= 30), detail: '输入大小和事实字段数量受限。' },
    { id: 'topic_specific', passed: cases.every(item => !/allowlisted baseline|confusion matrix|ply reconstruction preview/i.test(`${item.description}\n${item.initial_message}`)), detail: 'Idea case 没有注入无关的默认实验描述。' },
  ]
  return { passed: checks.every(check => check.passed), checks, case_count: cases.length }
}

export async function ensureIdeaDataset(mastra: Mastra) {
  const cases = loadIdeaEvalCases()
  let dataset
  try {
    dataset = await mastra.datasets.get({ id: IDEA_DATASET_ID })
  } catch {
    dataset = await mastra.datasets.create({
      id: IDEA_DATASET_ID,
      name: 'Research OS Idea Cases',
      description: 'Versioned public Idea clarification cases. Inputs are test fixtures, not research evidence.',
      metadata: { schema_version: IDEA_DATASET_VERSION, source: 'tests/idea-cases', evidence_status: 'test_fixture_only' },
      targetType: 'agent',
      targetIds: ['idea-clarification-agent'],
    })
  }
  const listed = await dataset.listItems({ page: 0, perPage: 200 })
  const items = Array.isArray(listed) ? listed : listed.items
  const existing = new Map(items.map(item => [item.externalId || String(item.id), item]))
  for (const item of cases) {
    const payload = {
      externalId: item.id,
      input: { initial_message: item.initial_message, clarification_mode: item.clarification_mode },
      groundTruth: { confirmed_facts: item.confirmed_facts, expect: item.expect },
      metadata: { case_id: item.id, source: item.source, schema_version: item.schema_version, test_fixture: true },
    }
    const previous = existing.get(item.id)
    if (!previous) await dataset.addItem(payload)
    else if (stable(previous.input) !== stable(payload.input) || stable(previous.groundTruth) !== stable(payload.groundTruth) || stable(previous.metadata) !== stable(payload.metadata)) {
      await dataset.updateItem({ itemId: previous.id, input: payload.input, groundTruth: payload.groundTruth, metadata: payload.metadata })
    }
  }
  return {
    dataset_id: IDEA_DATASET_ID,
    version: IDEA_DATASET_VERSION,
    items: cases.map(item => ({ id: item.id, source: item.source, expected_tier: item.expect.model_tier })),
    quick_checks: runIdeaQuickChecks(cases),
    scorer_id: ideaClarificationContractScorer.id,
  }
}
