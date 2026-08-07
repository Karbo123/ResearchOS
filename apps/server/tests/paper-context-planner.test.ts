import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { database, migrate, one } from '../src/database.js'
import { reconcileKnowledgeDocuments } from '../src/knowledge-document-service.js'
import { pathInside } from '../src/paths.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { testProjectSlug } from './test-project.js'

const mocks = vi.hoisted(() => ({ mastraJson: vi.fn() }))
vi.mock('../src/mastra-client.js', () => ({ mastraJson: mocks.mastraJson }))

const { revisePaperSection } = await import('../src/paper-service.js')

const projectId = testProjectSlug('paper-context')

function writeProjectFile(relativePath: string, content: string): void {
  const path = pathInside(projectRoot(projectId), ...relativePath.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

describe('paper writing Context Planner integration', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Paper context test'])
    await createProjectWorkspace(projectId, projectId, {})
    writeProjectFile('paper/main.tex', `\\documentclass{article}
\\begin{document}
\\section{Introduction}
Original introduction.
\\section{Related Work}
Original related work.
\\section{Method}
Original method.
\\section{Experiments}
Original experiments.
\\section{Conclusion}
Original conclusion.
\\bibliographystyle{plain}
\\bibliography{references}
\\end{document}
`)
    writeProjectFile('research/writing/section-briefs/introduction.md', `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: writing:introduction
kind: writing_brief
title: Introduction brief
status: confirmed
depends_on: []
workspace_scopes:
  - paper:introduction
artifact_ids: []
evidence_ids: []
---

# Introduction brief

## Goal

Explain only the confirmed research motivation and preserve the evidence boundary.
`)
    await reconcileKnowledgeDocuments(projectId, 'test')
    mocks.mastraJson.mockImplementation(async (path: string) => {
      if (path === '/internal/agents/paper-revise') return { result: { revised_source: 'Revised introduction from confirmed context.', summary: 'Used the confirmed writing brief.' } }
      throw new Error(`unexpected_mastra_path_${path}`)
    })
  })

  afterAll(async () => {
    await database.query('DELETE FROM context_manifests WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('requires the section writing brief and records the exact context manifest in the LaTeX proposal', async () => {
    const result = await revisePaperSection(projectId, 'introduction')
    expect(result).toMatchObject({ status: 'pending', revised_source: 'Revised introduction from confirmed context.', context_manifest_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    const call = mocks.mastraJson.mock.calls.find(item => item[0] === '/internal/agents/paper-revise')
    expect(call?.[1]).toMatchObject({ project_id: projectId, section_id: 'introduction', project_context: expect.stringContaining('writing:introduction') })
    const proposal = await one<{ kind: string; payload: Record<string, unknown> }>('SELECT kind,payload FROM proposals WHERE id=$1', [result.proposal_id])
    expect(proposal).toMatchObject({ kind: 'code_patch', payload: { patch_kind: 'latex', paper_section: 'introduction', context_manifest_id: result.context_manifest_id } })
    const operation = (proposal?.payload.operations as Array<{ content: string }>)[0]
    expect(operation.content).toContain('Revised introduction from confirmed context.')
    expect(operation.content).toContain('\\bibliographystyle{plain}')
    expect(operation.content).toContain('\\end{document}')
  })
})
