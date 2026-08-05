import { testProjectSlug } from './test-project.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { projectRoot } from '../src/project-storage.js'
import {
  applyWorkflowDiff,
  assertWorkflowPatchValid,
  createWorkflowEditProposal,
} from '../src/workflow-edit-service.js'
import { mastraJson } from '../src/mastra-client.js'
import { audit, database } from '../src/database.js'
import { requireProject } from '../src/project-service.js'
import { gitCommit } from '../src/patch-service.js'

vi.mock('../src/mastra-client.js', () => ({ mastraJson: vi.fn() }))
vi.mock('../src/database.js', () => ({ audit: vi.fn(), database: { query: vi.fn() } }))
vi.mock('../src/project-service.js', () => ({ requireProject: vi.fn() }))
vi.mock('../src/patch-service.js', () => ({ gitCommit: vi.fn() }))

const projectId = testProjectSlug()
const projectDirectory = projectRoot(projectId)
const templatePath = resolve(import.meta.dirname, '../../../apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')

function addLeadingCommentDiff(): string {
  return [
    '--- workflow.ts',
    '+++ workflow.ts',
    '@@ -1,2 +1,3 @@',
    '+// workflow edit test',
    ' import {',
    '   createFinalizeStep,',
    '',
  ].join('\n')
}

describe('project workflow edit safety', () => {
  let template: string

  beforeAll(() => {
    template = readFileSync(templatePath, 'utf8')
    mkdirSync(projectDirectory, { recursive: true })
    writeFileSync(resolve(projectDirectory, 'workflow.ts'), template, 'utf8')
  })

  afterAll(() => {
    rmSync(projectDirectory, { recursive: true, force: true })
  })

  it('rejects diffs that touch files outside workflow.ts', () => {
    for (const diff of [
      '--- a/workflow.ts\n+++ b/secret.txt\n@@ -1,0 +1,1 @@\n+secret',
      '--- a/../../etc/passwd\n+++ b/../workflow.ts\n@@ -1,0 +1,1 @@\n+secret',
    ]) {
      let thrown: unknown
      try { applyWorkflowDiff(projectId, diff) } catch (error) { thrown = error }
      expect(thrown).toMatchObject({ code: 'workflow_diff_path_invalid' })
    }
  })

  it('applies only workflow.ts diffs and leaves the project untouched', () => {
    const next = `// workflow edit test\n${template}`
    const applied = applyWorkflowDiff(projectId, addLeadingCommentDiff())
    expect(applied).toBe(next)
    expect(readFileSync(resolve(projectDirectory, 'workflow.ts'), 'utf8')).toBe(template)
  })

  it('rejects a proposal whose approved content fails preview validation', async () => {
    vi.mocked(mastraJson).mockResolvedValue({ valid: false, errors: ['workflow graph invalid'], graph: [], step_ids: [] })
    const thrown = await assertWorkflowPatchValid(projectId, {
      patch_kind: 'workflow',
      operations: [{ action: 'replace', path: 'workflow.ts', content: template }],
    }).then(() => null, error => error)
    expect(thrown).toMatchObject({ code: 'workflow_validation_failed' })
  })

  it('rejects workflow patches that do not target workflow.ts', async () => {
    const thrown = await assertWorkflowPatchValid(projectId, {
      patch_kind: 'workflow',
      operations: [{ action: 'replace', path: 'other.ts', content: template }],
    }).then(() => null, error => error)
    expect(thrown).toMatchObject({ code: 'workflow_patch_invalid' })
  })

  it('never creates a proposal when the generated next version fails validation', async () => {
    const next = `// workflow edit test\n${template}`
    const diff = addLeadingCommentDiff()
    vi.mocked(requireProject).mockResolvedValue({} as never)
    vi.mocked(gitCommit).mockReturnValue('base-commit')
    vi.mocked(mastraJson)
      .mockResolvedValueOnce({
        result: {
          summary: 'Move the entry step',
          diff,
          affected_step_ids: ['workflow-entry'],
          planned_validation: ['graph validation'],
        },
      })
      .mockResolvedValueOnce({ valid: false, errors: ['generated graph invalid'], graph: [], step_ids: [] })

    const thrown = await createWorkflowEditProposal(projectId, '调整一下步骤顺序', {}).then(() => null, error => error)
    expect(thrown).toMatchObject({ code: 'workflow_validation_failed' })
    expect(database.query).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalledWith('workflow.edit_proposal_created', projectId, expect.anything())
  })
})
