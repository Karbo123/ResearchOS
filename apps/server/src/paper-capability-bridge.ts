import { revisePaperSection, translatePaperSection } from './paper-service.js'
import type { WorkflowCapability } from './project-workflow/contracts.js'

export async function paperServiceCapability(capability: Extract<WorkflowCapability, 'paper.translate' | 'paper.revise'>, projectId: string, payload: Record<string, unknown>): Promise<unknown> {
  const sectionId = typeof payload.section_id === 'string' ? payload.section_id : ''
  if (!sectionId) throw new Error('paper_section_id_missing')
  if (capability === 'paper.translate') return translatePaperSection(projectId, sectionId)
  return revisePaperSection(projectId, sectionId)
}
