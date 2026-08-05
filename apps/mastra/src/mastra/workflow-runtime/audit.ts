import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { researchRoot } from '../env.js'

const runtimeRoot = process.env.RESEARCH_RUNTIME_DIR
  ? resolve(researchRoot, process.env.RESEARCH_RUNTIME_DIR)
  : resolve(researchRoot, 'runtime')
const auditPath = resolve(runtimeRoot, 'workflow-audit.jsonl')

export function auditWorkflow(projectId: string, event: string, details: Record<string, unknown>): void {
  mkdirSync(runtimeRoot, { recursive: true })
  appendFileSync(auditPath, `${JSON.stringify({
    project_id: projectId,
    event,
    details,
    created_at: new Date().toISOString(),
  })}\n`, 'utf8')
}
