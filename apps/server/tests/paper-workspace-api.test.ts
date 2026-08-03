import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'
import { pathInside, projectsRoot } from '../src/paths.js'

const projectId = crypto.randomUUID()
const proposalId = crypto.randomUUID()
const experimentId = crypto.randomUUID()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('paper workspace API', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `paper-workspace-${projectId.slice(0, 8)}`, 'Paper workspace test'])
    const paperRoot = pathInside(projectsRoot, projectId, 'paper')
    mkdirSync(paperRoot, { recursive: true })
    writeFileSync(pathInside(paperRoot, 'main.tex'), `\\documentclass{article}
\\title{Test Paper}
\\begin{document}
\\section{Introduction}
Uncertainty-based sampling is promising. We study its value.
\\section{Related Work}
Prior work is summarized in \\cite{smith2020}.
\\section{Method}
\\begin{itemize}
\\item Use active learning.
\\item Compare with random sampling.
\\end{itemize}
\\section{Experiments}
We report accuracy in Figure~\\ref{fig:accuracy}.
\\section{Conclusion}
The method is competitive.
\\end{document}
`, 'utf8')
    writeFileSync(pathInside(paperRoot, 'references.bib'), `@article{smith2020,
  title={Uncertainty sampling for classification},
  author={Smith, Jane and Doe, John},
  year={2020},
  journal={Journal of Machine Learning}
}
`, 'utf8')
    writeFileSync(pathInside(paperRoot, 'translations.json'), JSON.stringify({
      schema_version: 1,
      sections: {
        introduction: [{ en: 'Uncertainty-based sampling is promising.', zh: '基于不确定性的采样很有前景。' }],
      },
    }), 'utf8')
    await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [
      proposalId, projectId, 'experiment_plan', 'compile test paper', 'Compile paper/main.tex',
      { experiment_type: 'compile_latex' },
    ])
    await database.query('INSERT INTO experiments(id,project_id,proposal_id,status,experiment_type,config,metrics) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      experimentId, projectId, proposalId, 'succeeded', 'compile_latex', '{}', '{"compiled":1}',
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM artifacts WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM experiments WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(pathInside(projectsRoot, projectId), { recursive: true, force: true })
  })

  it('returns parsed sections, citations, translations, and compile summary', async () => {
    const { response, body } = await requestJson(`/api/projects/${projectId}/paper-workspace`)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      project_id: projectId,
      has_source: true,
      has_references: true,
      compile_runs: 1,
      compile_succeeded: 1,
      compile_latest_status: 'succeeded',
    })
    const sections = body.sections as Array<Record<string, unknown>>
    expect(sections.map(section => section.id)).toEqual(['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'])
    const introduction = sections.find(section => section.id === 'introduction') as Record<string, unknown>
    expect(introduction.status).toBe('ready')
    expect((introduction.sentences as Array<{ en: string; zh: string | null }>).find(item => item.en.includes('Uncertainty-based'))?.zh).toContain('基于不确定性')
    const related = sections.find(section => section.id === 'paper_related_work') as Record<string, unknown>
    expect(related.citations).toEqual(['smith2020'])
    const experiments = sections.find(section => section.id === 'paper_experiments') as Record<string, unknown>
    expect(experiments.figure_refs).toContain('fig:accuracy')
    expect((body.references as Array<{ key: string; title: string }>)[0]).toMatchObject({ key: 'smith2020', title: 'Uncertainty sampling for classification' })
  })

  it('creates a gated section edit proposal', async () => {
    const { response, body } = await requestJson(`/api/projects/${projectId}/paper-section`, {
      method: 'POST',
      body: JSON.stringify({ section_id: 'introduction', content: 'New introduction sentence for review.' }),
    })
    expect(response.status).toBe(201)
    const proposalId = String(body.proposal_id)
    const rows = await database.query<{ kind: string; payload: Record<string, unknown> }>('SELECT kind,payload FROM proposals WHERE id=$1', [proposalId])
    expect(rows.rows[0]?.kind).toBe('code_patch')
    const payload = rows.rows[0]?.payload as { paper_section: string; operations: Array<{ content: string }> }
    expect(payload.paper_section).toBe('introduction')
    expect(payload.operations[0]?.content).toContain('New introduction sentence for review.')
  })
})
