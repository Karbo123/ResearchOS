import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const unconfirmedMarkers = [
  '尚未', '未确认', '未知', '待确认', '未提供',
  'unknown', 'not confirmed', 'not provided', 'to be confirmed',
]
function isMissing(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  const text = String(value).toLowerCase()
  return unconfirmedMarkers.some(marker => text.includes(marker))
}

export function inspectIdeaDraft(draft: Record<string, unknown>): { gaps: string[] } {
  const gaps: string[] = []
  if (String(draft.research_question || '').trim().length < 10) gaps.push('research_question')
  for (const field of [
    'domain', 'hypotheses', 'expected_contributions', 'available_data',
    'success_criteria', 'ethics_and_compliance',
  ]) if (isMissing(draft[field])) gaps.push(field)
  const constraints = draft.constraints && typeof draft.constraints === 'object'
    ? draft.constraints as Record<string, unknown> : {}
  for (const field of ['compute', 'data_access']) {
    if (isMissing(constraints[field])) gaps.push(`constraints.${field}`)
  }
  return { gaps }
}

export const inspectIdeaDraftTool = createTool({
  id: 'inspect-idea-draft',
  description: 'Identify schema-level gaps in the current research Idea draft without choosing a scripted question.',
  inputSchema: z.object({ draft: z.record(z.string(), z.unknown()) }).strict(),
  outputSchema: z.object({ gaps: z.array(z.string()).max(20) }).strict(),
  execute: async ({ draft }) => inspectIdeaDraft(draft),
})
