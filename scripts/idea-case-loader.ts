import { readdirSync, readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { z } from 'zod'

export const repositoryRoot = resolve(import.meta.dirname, '..')
export const ideaCasesRoot = resolve(repositoryRoot, 'tests', 'idea-cases')
const caseId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const stringMap = z.record(z.string().min(1), z.string().min(1))
const expectation = z.object({
  phase: z.string().min(1).optional(),
  missing_fields_contains: z.array(z.string().min(1)).optional(),
  model_tier: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reply_contains_any: z.array(z.string().min(1)).optional(),
  reply_excludes: z.array(z.string().min(1)).optional(),
  final_feasibility: z.string().min(1).optional(),
}).strict()
const ideaCaseSchema = z.object({
  schema_version: z.literal('1.0'),
  id: caseId,
  description: z.string().min(1),
  enabled: z.boolean(),
  clarification_mode: z.enum(['automatic', 'detailed']),
  initial_message: z.string().min(1),
  confirmed_facts: stringMap,
  project_messages: stringMap,
  expect: expectation,
}).strict()
export type IdeaCase = z.infer<typeof ideaCaseSchema> & { sourcePath: string }

export function ideaCaseIds(): string[] {
  return readdirSync(ideaCasesRoot).filter(name => name.endsWith('.json')).map(name => basename(name, '.json')).sort()
}

export function loadIdeaCase(id: string): IdeaCase {
  caseId.parse(id)
  const sourcePath = resolve(ideaCasesRoot, `${id}.json`)
  const relativePath = relative(ideaCasesRoot, sourcePath)
  if (relativePath.startsWith('..') || resolve(ideaCasesRoot, relativePath) !== sourcePath) throw new Error('idea_case_path_escape')
  const parsed = ideaCaseSchema.parse(JSON.parse(readFileSync(sourcePath, 'utf8')))
  if (parsed.id !== id) throw new Error(`${id}: filename and case id differ`)
  return { ...parsed, sourcePath }
}

export function loadEnabledIdeaCases(): IdeaCase[] {
  const cases = ideaCaseIds().map(loadIdeaCase)
  if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('duplicate_idea_case_ids')
  return cases.filter(item => item.enabled)
}
