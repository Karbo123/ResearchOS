import { testProjectSlug } from './test-project.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { database, migrate } from '../src/database.js'
import { pathInside, projectsRoot } from '../src/paths.js'
import { WorkflowDefinitionLoader } from '../src/project-workflow/definition-loader.js'
import { workflowGraphSnapshot } from '../src/project-workflow/graph-service.js'

const projectId = testProjectSlug()
const templatePath = resolve(import.meta.dirname, '../../../apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')

describe('default semantic workflow template', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,status) VALUES ($1,$2,$3,$4)', [projectId, projectId, 'Semantic workflow template test', 'active'])
    mkdirSync(pathInside(projectsRoot, projectId), { recursive: true })
    writeFileSync(pathInside(projectsRoot, projectId, 'workflow.ts'), readFileSync(templatePath, 'utf8'), 'utf8')
    const loader = new WorkflowDefinitionLoader()
    const loaded = await loader.initializeProject(projectId)
    expect(loaded?.definition.templateVersion).toBe('research-lifecycle@2')
  }, 30_000)

  afterAll(async () => {
    await database.query('DELETE FROM workflow_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_node_runs WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_definitions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM project_workflow_runtime WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(pathInside(projectsRoot, projectId), { recursive: true, force: true })
  })

  it('keeps the default graph semantically organized around the research lifecycle', async () => {
    const snapshot = await workflowGraphSnapshot(projectId)
    expect(snapshot.groups.map(group => group.id)).toEqual([
      'project_context',
      'conversation',
      'literature',
      'method_and_experiment',
      'paper',
      'reporting',
      'governance',
      'workflow_editing',
    ])
    const nodeIds = new Set(snapshot.nodes.map(node => node.id))
    expect([...nodeIds]).toEqual(expect.arrayContaining([
      'context.snapshot',
      'conversation.agent_turn',
      'literature.search',
      'literature.recursive',
      'experiment.plan',
      'experiment.run',
      'experiment.artifact_lineage',
      'paper.introduction',
      'paper.related_work',
      'paper.method',
      'paper.experiments',
      'paper.conclusion',
      'paper.compile',
      'report.generate',
      'workflow.edit',
    ]))
    expect(snapshot.triggers.map(trigger => trigger.event_type)).toEqual(expect.arrayContaining([
      'chat.message.received',
      'literature.recursive.requested',
      'experiment.run.completed',
      'paper.introduction.revise.requested',
      'paper.related_work.revise.requested',
      'paper.method.revise.requested',
      'paper.experiments.revise.requested',
      'paper.conclusion.revise.requested',
      'paper.compile.requested',
    ]))
    expect(snapshot.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'context.snapshot', to: 'conversation.agent_turn' }),
      expect.objectContaining({ from: 'experiment.run', to: 'experiment.artifact_lineage' }),
      expect.objectContaining({ from: 'paper.compile', to: 'context.finalize' }),
    ]))
  })
})
