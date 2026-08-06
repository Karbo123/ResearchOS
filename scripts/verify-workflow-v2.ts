import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const apiBase = (process.env.RESEARCH_API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')

type ErrorPayload = { code?: string; message?: string }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => ({})) as T & ErrorPayload
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.code || ''} ${payload.message || ''}`)
  return payload
}

const projects = await request<Array<{ id: string; status: string }>>('/api/projects')
const project = projects.find(item => item.status === 'active')
if (!project) throw new Error('Workflow v2 check requires an active project')

const graph = await request<{ groups: Array<{ id: string }>; node_runs: Array<{ node_id: string; status: string; created_at: string }> }>(
  `/api/projects/${project.id}/workflow/graph`,
)
if (!graph.groups.some(group => group.id === 'project_context')) {
  throw new Error('Workflow v2 runtime did not expose the semantic project_context group')
}

const correlationId = `workflow-v2-check:${Date.now()}`
const event = await request<{ id: string; definition_version: number }>(
  `/api/projects/${project.id}/workflow/events`,
  'POST',
  {
    event_type: 'approval.decided',
    payload: { actor: 'acceptance-test', decision: 'rejected', reason: 'Workflow v2 governance check' },
    source: 'acceptance-test',
    correlation_id: correlationId,
    idempotency_key: correlationId,
  },
)
if (!event.id) throw new Error('Workflow v2 event append did not return an event')

const deadline = Date.now() + 20_000
let governanceRun: { node_id: string; status: string } | null = null
while (Date.now() < deadline) {
  const latest = await request<{ node_runs: Array<{ node_id: string; status: string; created_at: string }> }>(
    `/api/projects/${project.id}/workflow/graph`,
  )
  governanceRun = latest.node_runs
    .filter(run => run.node_id === 'governance.approval' && run.status === 'succeeded')
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
  if (governanceRun) break
  await new Promise(resolve => setTimeout(resolve, 200))
}
if (!governanceRun) throw new Error('Workflow v2 governance node did not reach succeeded')

const argsFingerprint = createHash('sha256').update(`workflow-v2-check:${project.id}:${correlationId}`).digest('hex')
const proposal = await request<{ proposal_id: string }>('/api/proposals', 'POST', {
  project_id: project.id,
  kind: 'diagnostic_suggestion',
  reason: 'Verify v2 approval ledger and audit binding.',
  summary: 'Workflow v2 acceptance check',
  impact: { test_only: true, side_effect: 'none' },
  payload: { check: 'workflow-v2', test_only: true },
})
await request(`/api/proposals/${proposal.proposal_id}/decision`, 'POST', {
  decision: 'rejected',
  actor: 'acceptance-test',
  comment: 'Reject the test-only proposal after verifying the v2 approval path.',
})

const detail = await request<{ proposals: Array<{ id: string; status: string }> }>(`/api/projects/${project.id}`)
const stored = detail.proposals.find(item => item.id === proposal.proposal_id)
if (!stored || stored.status !== 'rejected') throw new Error('Workflow v2 decision was not persisted in the project Proposal ledger')
const auditEvents = await request<Array<{ action: string; actor: string; details: Record<string, unknown> }>>(`/api/projects/${project.id}/audit`)
const auditEvent = auditEvents.find(eventItem => eventItem.action === 'proposal.rejected' && eventItem.details.proposal_id === proposal.proposal_id)
if (!auditEvent || auditEvent.actor !== 'acceptance-test') throw new Error('Workflow v2 audit event is missing the decision binding')

console.log(JSON.stringify({
  status: 'passed',
  project_id: project.id,
  event_id: event.id,
  governance_node: 'succeeded',
  proposal_id: proposal.proposal_id,
  decision: 'rejected',
  audit_binding: true,
  args_fingerprint: argsFingerprint,
}, null, 2))
