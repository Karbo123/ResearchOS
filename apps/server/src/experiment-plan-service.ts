import { database } from './database.js'
import { mastraJson } from './mastra-client.js'
import { projectDetail, requireProject } from './project-service.js'
import { requireConfirmedSpecFields } from './spec-field-status.js'

export async function createExperimentPlan(projectId: string): Promise<{ proposal_id: string; status: 'pending' }> {
  const project = await projectDetail(projectId)
  if (project.status !== 'active') throw new Error('project_not_active')
  requireConfirmedSpecFields(projectId, project.spec, project.idea_versions || [])
  const idea = project.idea_versions[0] as Record<string, unknown> | undefined
  const result = await mastraJson<{ result: Record<string, unknown> }>('/internal/agents/experiment-plan', {
    project_id: projectId,
    idea_version: project.current_idea_version,
    planning_context: { idea: idea?.spec, evidence: project.evidence, policies: project.policies },
  })
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', 'Mastra topic-specific plan', 'Topic-specific experiment plan requiring approval', { experiment_type: 'topic_specific', config: {}, random_seeds: result.result.random_seeds, topic_plan: result.result }])
  return { proposal_id: proposalId, status: 'pending' }
}
