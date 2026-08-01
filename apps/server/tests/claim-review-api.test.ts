import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { createPaperDraftProposal } from '../src/paper-service.js'
import { applyApprovedPatch } from '../src/patch-service.js'
import { pathInside, projectsRoot } from '../src/paths.js'

const projectId = crypto.randomUUID()
const otherProjectId = crypto.randomUUID()
const evidenceId = crypto.randomUUID()
const otherEvidenceId = crypto.randomUUID()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('claim review API', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      projectId, `claim-review-${projectId.slice(0, 8)}`, 'Claim Review Test',
      otherProjectId, `claim-review-other-${otherProjectId.slice(0, 8)}`, 'Other Claim Review Test',
    ])
    await database.query('INSERT INTO evidence(id,project_id,claim,quote,locator,source_url) VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [
      evidenceId, projectId, 'candidate claim', 'A page-level quote for review.', 'page 4', 'https://example.org/paper.pdf',
      otherEvidenceId, otherProjectId, 'other claim', 'A quote from a different project.', 'page 9', 'https://example.org/other.pdf',
    ])
    await createProjectWorkspace(projectId, `claim-review-${projectId.slice(0, 8)}`, { schema_version: '1.0', idea: { title: 'Claim Review Test' } })
  })

  afterAll(async () => {
    await database.query('DELETE FROM memory_links WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM proposals WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM claim_reviews WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM evidence WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [projectId, otherProjectId])
    rmSync(pathInside(projectsRoot, projectId), { recursive: true, force: true })
  })

  it('creates, lists, decides once, and audits a project-scoped review', async () => {
    const created = await requestJson(`/api/projects/${projectId}/claim-reviews`, {
      method: 'POST',
      body: JSON.stringify({ claim: 'The paper supports this bounded claim.', evidence_ids: [evidenceId] }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body.status).toBe('pending')
    expect(created.body.evidence_status).toBe('page_quote_requires_claim_review')

    const reviewId = String(created.body.id)
    const listed = await requestJson(`/api/projects/${projectId}/claim-reviews`)
    expect(listed.response.status).toBe(200)
    expect((listed.body.reviews as Array<Record<string, unknown>>).some(item => item.id === reviewId)).toBe(true)

    const decided = await requestJson(`/api/projects/${projectId}/claim-reviews/${reviewId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'accepted', actor: 'test-user', comment: 'Quote and locator reviewed.' }),
    })
    expect(decided.response.status).toBe(200)
    expect(decided.body.status).toBe('accepted')

    const paperDraft = await createPaperDraftProposal(projectId)
    const proposal = await rows<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [paperDraft.proposal_id])
    expect(proposal[0]?.payload.claim_review_ids).toEqual([reviewId])
    expect(proposal[0]?.payload.reviewed_evidence_ids).toEqual([evidenceId])
    const appliedCommit = applyApprovedPatch(projectId, proposal[0]!.payload, 'test-user')
    expect(appliedCommit).toMatch(/^[0-9a-f]{40}$/)
    const paper = readFileSync(pathInside(projectsRoot, projectId, 'paper', 'main.tex'), 'utf8')
    expect(paper).toContain('Human-Reviewed Claim Mappings')
    expect(paper).toContain('The paper supports this bounded claim.')

    const repeated = await requestJson(`/api/projects/${projectId}/claim-reviews/${reviewId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'rejected', actor: 'test-user' }),
    })
    expect(repeated.response.status).toBe(409)
    expect(repeated.body.code).toBe('claim_review_already_decided')

    const audit = await rows<{ action: string; actor: string }>('SELECT action,actor FROM audit_events WHERE project_id=$1 AND action LIKE \'claim_review.%\' ORDER BY created_at', [projectId])
    expect(audit.map(item => `${item.action}:${item.actor}`)).toEqual(['claim_review.created:local-user', 'claim_review.accepted:test-user'])
  })

  it('rejects evidence from another project before creating a review', async () => {
    const result = await requestJson(`/api/projects/${projectId}/claim-reviews`, {
      method: 'POST',
      body: JSON.stringify({ claim: 'This must not cross project boundaries.', evidence_ids: [otherEvidenceId] }),
    })
    expect(result.response.status).toBe(403)
    expect(result.body.code).toBe('claim_review_evidence_scope')
    const reviews = await rows<{ id: string }>('SELECT id FROM claim_reviews WHERE project_id=$1', [projectId])
    expect(reviews).toHaveLength(1)
  })
})
