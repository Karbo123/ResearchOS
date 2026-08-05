import { testProjectSlug } from './test-project.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'

const projectId = testProjectSlug()
const otherProjectId = testProjectSlug()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('mentor feedback API', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      projectId, `feedback-${projectId.slice(0, 8)}`, 'Feedback Test',
      otherProjectId, `feedback-other-${otherProjectId.slice(0, 8)}`, 'Other Feedback Test',
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM human_feedback WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM proposals WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [projectId, otherProjectId])
  })

  it('keeps feedback project-scoped and creates only a pending proposal', async () => {
    const created = await requestJson(`/api/projects/${projectId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ category: 'report', instruction: '补充本周实验失败的原因和下一步验证计划。' }),
    })
    expect(created.response.status).toBe(201)
    const feedbackId = String(created.body.id)

    const otherProjectList = await requestJson(`/api/projects/${otherProjectId}/feedback`)
    expect(otherProjectList.response.status).toBe(200)
    expect(otherProjectList.body.feedback).toEqual([])

    const acknowledged = await requestJson(`/api/projects/${projectId}/feedback/${feedbackId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'acknowledged', actor: 'mentor', comment: '已阅读。' }),
    })
    expect(acknowledged.response.status).toBe(200)
    expect(acknowledged.body.status).toBe('acknowledged')

    const proposal = await requestJson(`/api/projects/${projectId}/feedback/${feedbackId}/proposal`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'diagnostic_suggestion',
        summary: '补充失败实验诊断',
        reason: '导师要求先分析失败原因再决定是否重跑。',
        payload: { requested_by: 'mentor' },
      }),
    })
    expect(proposal.response.status).toBe(201)
    expect(proposal.body.status).toBe('pending')
    const storedProposal = await rows<{ status: string; payload: Record<string, unknown> }>('SELECT status,payload FROM proposals WHERE id=$1 AND project_id=$2', [proposal.body.proposal_id, projectId])
    expect(storedProposal).toHaveLength(1)
    expect(storedProposal[0]).toMatchObject({ status: 'pending' })
    expect(storedProposal[0]?.payload).toMatchObject({ feedback_id: feedbackId, feedback_instruction: '补充本周实验失败的原因和下一步验证计划。' })

    const repeated = await requestJson(`/api/projects/${projectId}/feedback/${feedbackId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'rejected', actor: 'mentor' }),
    })
    expect(repeated.response.status).toBe(409)
    expect(repeated.body.code).toBe('feedback_already_decided')

    const audit = await rows<{ action: string; actor: string }>('SELECT action,actor FROM audit_events WHERE project_id=$1 AND action LIKE \'human_feedback.%\' ORDER BY created_at', [projectId])
    expect(audit.map(item => `${item.action}:${item.actor}`)).toEqual([
      'human_feedback.created:local-user',
      'human_feedback.acknowledged:mentor',
      'human_feedback.proposal_created:local-user',
    ])
  })

  it('rejects proposal creation for rejected feedback and cross-project decisions', async () => {
    const created = await requestJson(`/api/projects/${projectId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ category: 'general', instruction: '这个方向不接受，请停止该提议。' }),
    })
    expect(created.response.status).toBe(201)
    const feedbackId = String(created.body.id)

    const rejected = await requestJson(`/api/projects/${projectId}/feedback/${feedbackId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'rejected', actor: 'mentor' }),
    })
    expect(rejected.response.status).toBe(200)

    const proposal = await requestJson(`/api/projects/${projectId}/feedback/${feedbackId}/proposal`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'diagnostic_suggestion', summary: '不应创建动作', reason: '被拒绝的反馈不能产生动作。' }),
    })
    expect(proposal.response.status).toBe(409)
    expect(proposal.body.code).toBe('feedback_rejected')

    const crossProject = await requestJson(`/api/projects/${otherProjectId}/feedback/${feedbackId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'acknowledged', actor: 'mentor' }),
    })
    expect(crossProject.response.status).toBe(404)
    expect(crossProject.body.code).toBe('feedback_not_found')
  })
})
