import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const apiBase = (process.env.RESEARCH_API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
const mastraBase = (process.env.RESEARCH_MASTRA_URL || 'http://127.0.0.1:4111').replace(/\/$/, '')

type ErrorPayload = { code?: string; message?: string }

async function request<T>(base: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => ({})) as T & ErrorPayload
  if (!response.ok) throw new Error(`${base}${path}: ${response.status} ${payload.code || ''} ${payload.message || ''}`)
  return payload
}

const projects = await request<Array<{ id: string; status: string }>>(apiBase, '/api/projects')
const project = projects.find(item => item.status === 'active')
if (!project) throw new Error('Mastra HITL check requires an active project')

const argsFingerprint = createHash('sha256').update(`mastra-hitl-check:${project.id}`).digest('hex')
const proposal = await request<{ proposal_id: string }>(apiBase, '/api/proposals', {
  project_id: project.id,
  kind: 'diagnostic_suggestion',
  reason: 'Verify Mastra suspend and resume workflow handling.',
  summary: 'Mastra HITL integration check',
  impact: { test_only: true, side_effect: 'none' },
  payload: { check: 'mastra-hitl', test_only: true },
})

const started = await request<{ status: string; run_id: string; suspended: string[][]; suspend_payload: Record<string, unknown> }>(mastraBase, `/internal/workflows/project/${project.id}/run`, {
  action: 'approval_gate',
  project_id: project.id,
  proposal_id: proposal.proposal_id,
  tool_name: 'acceptance.mastra_hitl_check',
  args_fingerprint: argsFingerprint,
  policy_version: 'acceptance-v1',
  actor: 'acceptance-test',
  reason: 'Verify the approval workflow suspends with its auditable context.',
})
if (started.status !== 'suspended' || !started.run_id || started.suspended.length !== 1) throw new Error('Mastra approval workflow did not suspend exactly once')
const payload = started.suspend_payload
for (const [key, value] of Object.entries({ project_id: project.id, proposal_id: proposal.proposal_id, tool_name: 'acceptance.mastra_hitl_check', args_fingerprint: argsFingerprint, policy_version: 'acceptance-v1' })) {
  if (payload[key] !== value) throw new Error(`Mastra suspend payload lost ${key}`)
}

const resumed = await request<{ status: string; run_id: string; result: {
  status: string
  project_id: string
  action: string
  result: { decision: string; proposal_id: string; tool_name: string; args_fingerprint: string; policy_version: string }
} }>(mastraBase, `/internal/workflows/project/${project.id}/resume`, {
  run_id: started.run_id,
  resume: {
    approved: false,
    actor: 'acceptance-test',
    comment: 'Reject the test-only proposal after verifying the resume path.',
  },
})
if (resumed.status !== 'success' || resumed.run_id !== started.run_id || resumed.result.status !== 'success') throw new Error('Mastra approval workflow did not resume as a success wrapper')
if (resumed.result.result.decision !== 'rejected' || resumed.result.result.proposal_id !== proposal.proposal_id || resumed.result.result.tool_name !== 'acceptance.mastra_hitl_check' || resumed.result.result.args_fingerprint !== argsFingerprint || resumed.result.result.policy_version !== 'acceptance-v1') throw new Error('Mastra approval result lost its audit binding')

const detail = await request<{ proposals: Array<{ id: string; status: string }> }>(apiBase, `/api/projects/${project.id}`)
const stored = detail.proposals.find(item => item.id === proposal.proposal_id)
if (!stored || stored.status !== 'rejected') throw new Error('Mastra HITL decision was not persisted in the project Proposal ledger')
const auditEvents = await request<Array<{ action: string; actor: string; details: Record<string, unknown> }>>(apiBase, `/api/projects/${project.id}/audit`)
const auditEvent = auditEvents.find(event => event.action === 'proposal.rejected' && event.details.proposal_id === proposal.proposal_id)
if (!auditEvent || auditEvent.actor !== 'acceptance-test' || !JSON.stringify(auditEvent.details.mastra_approval || {}).includes(argsFingerprint)) throw new Error('Mastra HITL audit event is missing the approval binding')

console.log(JSON.stringify({ status: 'passed', project_id: project.id, proposal_id: proposal.proposal_id, run_id: started.run_id, suspended: true, resumed: 'rejected', audit_binding: true }, null, 2))
