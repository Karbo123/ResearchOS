import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { database } from './database.js'
import { ApiError } from './http.js'
import { gitCommit } from './patch-service.js'
import { pathInside, projectsRoot } from './paths.js'
import { projectDetail } from './project-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'

function latex(value: unknown): string {
  return String(value ?? '').replace(/([#$%&_{}])/g, '\\$1').replaceAll('~', '\\textasciitilde{}').replaceAll('^', '\\textasciicircum{}')
}

export async function createPaperDraftProposal(projectId: string) {
  const project = await projectDetail(projectId)
  const evidence = project.evidence as Array<Record<string, unknown>>
  if (!evidence.length) throw new ApiError(422, 'verified_evidence_required', '生成论文草稿前至少需要一条页码级全文证据。')
  const claimReviews = (project.claim_reviews as Array<Record<string, unknown>> | undefined) || []
  const acceptedReviews = claimReviews.filter(item => item.status === 'accepted')
  const reviewedEvidenceIds = new Set(acceptedReviews.flatMap(item => Array.isArray(item.evidence_ids) ? item.evidence_ids.map(String) : []))
  const idea = (project.idea_versions[0] as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | undefined
  const ideaBody = (idea?.idea || {}) as Record<string, unknown>
  const experiments = (project.experiments as Array<Record<string, unknown>>).filter(item => item.status === 'succeeded')
  const evidenceText = evidence.map((item, index) => reviewedEvidenceIds.has(String(item.id)) ? null : `\\item [E${index + 1}] ${latex(item.quote)} (${latex(item.locator)}, ${latex(item.source_url)})`).filter(Boolean).join('\n') || '\\item No unreviewed evidence candidates remain.'
  const reviewedText = acceptedReviews.map((review, index) => {
    const references = Array.isArray(review.evidence_ids) ? review.evidence_ids.map(id => `E${Math.max(1, evidence.findIndex(item => String(item.id) === String(id)) + 1)}`).join(', ') : 'none'
    return `\\item [C${index + 1}] ${latex(review.claim)} (reviewed evidence: ${latex(references)})`
  }).join('\n') || '\\item No claim has completed human review; no quote is treated as factual support.'
  const resultText = experiments.length
    ? experiments.map(item => `\\item Run ${latex(item.id)}: \\texttt{${latex(JSON.stringify(item.metrics || {}))}}`).join('\n')
    : '\\item No approved experiment has completed; no scientific result is claimed.'
  const content = `\\documentclass{article}
\\usepackage[margin=1in]{geometry}
\\title{${latex(ideaBody.title || project.title)}}
\\begin{document}
\\maketitle
\\section{Research Question}
${latex(ideaBody.research_question || 'Not yet confirmed.')}
\\section{Human-Reviewed Claim Mappings}
The following mappings record human review of selected page-level quotes. They do not establish a scientific conclusion.
\\begin{description}
${reviewedText}
\\end{description}
\\section{Evidence Candidates}
The following page-level passages remain candidates and require claim-level human review before use as factual support.
\\begin{description}
${evidenceText}
\\end{description}
\\section{Method and Experiment Status}
\\begin{itemize}
${resultText}
\\end{itemize}
\\section{Limitations}
Metadata candidates are not full-text evidence. System integration results do not establish the research hypothesis.
\\end{document}
`
  const target = pathInside(projectsRoot, projectId, 'paper', 'main.tex')
  const existing = existsSync(target) ? readFileSync(target) : null
  const proposalId = crypto.randomUUID()
  const operation = existing
    ? { action: 'replace', path: 'paper/main.tex', content, expected_sha256: createHash('sha256').update(existing).digest('hex') }
    : { action: 'create', path: 'paper/main.tex', content }
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'code_patch', 'Generate an evidence-grounded LaTeX draft', 'Create evidence-grounded paper/main.tex', `--- paper/main.tex\n+++ paper/main.tex\n+ Evidence-grounded deterministic draft`, { patch_kind: 'latex', base_git_commit: gitCommit(projectId), operations: [operation], evidence_ids: evidence.map(item => item.id), claim_review_ids: acceptedReviews.map(item => item.id), reviewed_evidence_ids: [...reviewedEvidenceIds] }])
  if (supermemoryEnabled()) {
    await ingestProjectMemory(projectId, {
      source_type: 'related_work',
      source_id: proposalId,
      artifact_id: null,
      uploaded_file_id: null,
      content: evidence.map(item => `${String(item.claim || '')}\n${String(item.quote || '')}\n${String(item.locator || '')}\n${String(item.source_url || '')}`).join('\n\n'),
      source_url: null,
      quote: null,
      locator: null,
      metadata: { proposal_id: proposalId, evidence_ids: evidence.map(item => String(item.id)), evidence_status: 'page_quote_requires_claim_review' },
      task_type: 'memory',
      idempotency_key: `related-work-proposal:${proposalId}`,
    })
  }
  return { proposal_id: proposalId, status: 'pending' }
}

export async function createCompileProposal(projectId: string) {
  const path = pathInside(projectsRoot, projectId, 'paper', 'main.tex')
  if (!existsSync(path)) throw new ApiError(422, 'paper_source_missing', '项目尚无 paper/main.tex。')
  const proposalId = crypto.randomUUID()
  const sourceSha = createHash('sha256').update(readFileSync(path)).digest('hex')
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', 'Compile the reviewed LaTeX source', 'Compile paper/main.tex', { experiment_type: 'compile_latex', execution_backend: 'linux', config: {}, random_seeds: [0], source_sha256: sourceSha, base_git_commit: gitCommit(projectId) }])
  return { proposal_id: proposalId, status: 'pending' }
}
