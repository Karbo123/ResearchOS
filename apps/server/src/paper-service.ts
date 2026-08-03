import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit, database } from './database.js'
import { ApiError } from './http.js'
import { mastraJson } from './mastra-client.js'
import { gitCommit } from './patch-service.js'
import { pathInside, projectsRoot } from './paths.js'
import { projectDetail, requireProject } from './project-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/paper-template')
const CVPR_STYLE = readFileSync(resolve(TEMPLATE_ROOT, 'cvpr.sty'), 'utf8')
const EMPTY_REFERENCES = '% Research OS references will be managed through evidence-grounded proposals.\n'

const PAPER_SECTION_HEADINGS: Record<string, string> = {
  introduction: 'Introduction',
  paper_related_work: 'Related Work',
  paper_method: 'Method',
  paper_experiments: 'Experiments',
  conclusion: 'Conclusion',
}

function latex(value: unknown): string {
  return String(value ?? '').replace(/([#$%&_{}])/g, '\\$1').replaceAll('~', '\\textasciitilde{}').replaceAll('^', '\\textasciicircum{}')
}

function paperText(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim()
  if (!raw || /[^\x00-\x7F]/.test(raw)) return fallback
  return latex(raw)
}

function sectionIdForHeading(heading: string): string | null {
  const value = heading.toLowerCase()
  if (value.includes('introduction') || value.includes('引言')) return 'introduction'
  if (value.includes('related') || value.includes('相关工作')) return 'paper_related_work'
  if (value.includes('method') || value.includes('方法')) return 'paper_method'
  if (value.includes('experiment') || value.includes('实验')) return 'paper_experiments'
  if (value.includes('conclusion') || value.includes('结论')) return 'conclusion'
  return null
}

function replacePaperSection(source: string, sectionId: string, content: string): string {
  const matches = [...source.matchAll(/\\section\*?\{([^}]+)\}/g)]
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!
    if (sectionIdForHeading(match[1]!) !== sectionId) continue
    const start = match.index! + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    return `${source.slice(0, start)}\n${content}\n${source.slice(end)}`
  }
  const heading = PAPER_SECTION_HEADINGS[sectionId] || sectionId
  const endMarker = source.lastIndexOf('\\end{document}')
  if (endMarker >= 0) {
    return `${source.slice(0, endMarker)}\\section{${heading}}\n${content}\n${source.slice(endMarker)}`
  }
  return `${source}\n\\section{${heading}}\n${content}\n`
}

function extractPaperSection(source: string, sectionId: string): { heading: string; body: string } | null {
  const matches = [...source.matchAll(/\\section\*?\{([^}]+)\}/g)]
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!
    if (sectionIdForHeading(match[1]!) !== sectionId) continue
    const start = match.index! + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    return { heading: match[1]!.trim(), body: source.slice(start, end).trim() }
  }
  return null
}

function paperProjectContext(project: Record<string, unknown>): string {
  const ideaVersions = project.idea_versions as Array<Record<string, unknown>> | undefined
  const idea = (ideaVersions?.[0] as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | undefined
  const experiments = (project.experiments as Array<Record<string, unknown>> | undefined) || []
  const papers = (project.papers as Array<Record<string, unknown>> | undefined) || []
  return JSON.stringify({
    idea,
    experiment_statuses: experiments.map(item => ({ type: item.experiment_type, status: item.status })),
    confirmed_papers: papers.filter(item => item.confirmed).map(item => ({ title: item.title, year: item.year })),
  }).slice(0, 12_000)
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
  const content = `\\documentclass[10pt,twocolumn,letterpaper]{article}
\\usepackage{cvpr}
\\title{${latex(ideaBody.title || project.title)}}
\\author{Research OS Project}
\\begin{document}
\\maketitle
\\begin{abstract}
${paperText(ideaBody.abstract || ideaBody.research_question, 'An English abstract will be generated after evidence-grounded revision.')}
\\end{abstract}
\\section{Introduction}
${paperText(ideaBody.research_question, 'The research question is pending English revision.')}
\\section{Related Work}
The following mappings record human review of selected page-level quotes. They do not establish a scientific conclusion.
\\begin{description}
${reviewedText}
\\end{description}
\\section{Method}
The following page-level passages remain candidates and require claim-level human review before use as factual support.
\\begin{description}
${evidenceText}
\\end{description}
\\section{Experiments}
\\begin{itemize}
${resultText}
\\end{itemize}
\\section{Conclusion}
Metadata candidates are not full-text evidence. System integration results do not establish the research hypothesis.
\\bibliographystyle{plain}
\\bibliography{references}
\\end{document}
`
  const target = pathInside(projectsRoot, projectId, 'paper', 'main.tex')
  const existing = existsSync(target) ? readFileSync(target) : null
  const proposalId = crypto.randomUUID()
  const operations: Array<Record<string, unknown>> = []
  const stylePath = pathInside(projectsRoot, projectId, 'paper', 'cvpr.sty')
  if (!existsSync(stylePath)) operations.push({ action: 'create', path: 'paper/cvpr.sty', content: CVPR_STYLE })
  const referencesPath = pathInside(projectsRoot, projectId, 'paper', 'references.bib')
  if (!existsSync(referencesPath)) operations.push({ action: 'create', path: 'paper/references.bib', content: EMPTY_REFERENCES })
  operations.push(existing
    ? { action: 'replace', path: 'paper/main.tex', content, expected_sha256: createHash('sha256').update(existing).digest('hex') }
    : { action: 'create', path: 'paper/main.tex', content })
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'code_patch', 'Generate an evidence-grounded CVPR LaTeX draft', 'Create evidence-grounded CVPR paper/main.tex', `--- paper/main.tex\n+++ paper/main.tex\n+ Evidence-grounded deterministic CVPR draft`, { patch_kind: 'latex', base_git_commit: gitCommit(projectId), operations, evidence_ids: evidence.map(item => item.id), claim_review_ids: acceptedReviews.map(item => item.id), reviewed_evidence_ids: [...reviewedEvidenceIds] }])
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

export async function createPaperSectionProposal(projectId: string, sectionId: string, content: string) {
  await requireProject(projectId)
  const target = pathInside(projectsRoot, projectId, 'paper', 'main.tex')
  if (!existsSync(target)) throw new ApiError(422, 'paper_source_missing', '项目尚无 paper/main.tex。')
  const existing = readFileSync(target)
  const next = replacePaperSection(existing.toString('utf8'), sectionId, content)
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    proposalId, projectId, 'code_patch', 'Edit a paper section through the approval gate', `Edit paper section ${sectionId}`,
    `--- paper/main.tex\n+++ paper/main.tex\n+ Section ${sectionId} revision`,
    {
      patch_kind: 'latex',
      base_git_commit: gitCommit(projectId),
      operations: [{ action: 'replace', path: 'paper/main.tex', content: next, expected_sha256: createHash('sha256').update(existing).digest('hex') }],
      paper_section: sectionId,
    },
  ])
  return { proposal_id: proposalId, status: 'pending' }
}

export async function translatePaperSection(projectId: string, sectionId: string) {
  await requireProject(projectId)
  const target = pathInside(projectsRoot, projectId, 'paper', 'main.tex')
  if (!existsSync(target)) throw new ApiError(422, 'paper_source_missing', '项目尚无 paper/main.tex。')
  const source = readFileSync(target, 'utf8')
  const section = extractPaperSection(source, sectionId)
  if (!section) throw new ApiError(422, 'paper_section_missing', '论文中尚未包含该章节。')
  const result = await mastraJson<{ result: { sentences: Array<{ en: string; zh: string }> } }>('/internal/agents/paper-translate', {
    section_id: sectionId,
    heading: section.heading,
    source: section.body,
  })
  await savePaperTranslations(projectId, sectionId, result.result.sentences)
  return { section_id: sectionId, sentences: result.result.sentences }
}

export async function revisePaperSection(projectId: string, sectionId: string) {
  const project = await projectDetail(projectId)
  const target = pathInside(projectsRoot, projectId, 'paper', 'main.tex')
  if (!existsSync(target)) throw new ApiError(422, 'paper_source_missing', '项目尚无 paper/main.tex。')
  const source = readFileSync(target)
  const section = extractPaperSection(source.toString('utf8'), sectionId)
  if (!section) throw new ApiError(422, 'paper_section_missing', '论文中尚未包含该章节。')
  const result = await mastraJson<{ result: { revised_source: string; summary: string } }>('/internal/agents/paper-revise', {
    section_id: sectionId,
    heading: section.heading,
    source: section.body,
    project_context: paperProjectContext(project),
  })
  const revised = replacePaperSection(source.toString('utf8'), sectionId, result.result.revised_source)
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    proposalId, projectId, 'code_patch', 'AI-assisted paper section revision requires approval', `Revise paper section ${sectionId}`,
    `--- paper/main.tex\n+++ paper/main.tex\n+ AI-assisted section revision`,
    {
      patch_kind: 'latex',
      base_git_commit: gitCommit(projectId),
      operations: [{ action: 'replace', path: 'paper/main.tex', content: revised, expected_sha256: createHash('sha256').update(source).digest('hex') }],
      paper_section: sectionId,
      revision_summary: result.result.summary,
    },
  ])
  return { proposal_id: proposalId, status: 'pending', revised_source: result.result.revised_source, summary: result.result.summary }
}

function readTranslationSections(paperRoot: string): Record<string, Array<{ en: string; zh: string | null }>> {
  const translationsPath = pathInside(paperRoot, 'translations.json')
  if (!existsSync(translationsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(translationsPath, 'utf8')) as { sections?: Record<string, Array<{ en?: unknown; zh?: unknown }>> }
    const sections: Record<string, Array<{ en: string; zh: string | null }>> = {}
    for (const [key, values] of Object.entries(parsed.sections || {})) {
      if (!Array.isArray(values)) continue
      sections[key] = values
        .map(item => ({ en: String(item.en ?? ''), zh: typeof item.zh === 'string' ? item.zh : null }))
        .filter(item => item.en)
    }
    return sections
  } catch {
    return {}
  }
}

export async function savePaperTranslations(projectId: string, sectionId: string, sentences: Array<{ en: string; zh: string }>): Promise<void> {
  const paperRoot = pathInside(projectsRoot, projectId, 'paper')
  const sections = readTranslationSections(paperRoot)
  sections[sectionId] = sentences
  const content = `${JSON.stringify({ schema_version: 1, sections }, null, 2)}\n`
  const target = pathInside(paperRoot, 'translations.json')
  const temporary = `${target}.tmp`
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, target)
  await audit('paper.translations_updated', projectId, { section_id: sectionId, sentence_count: sentences.length })
}
