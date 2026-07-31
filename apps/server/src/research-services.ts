import { database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { requireProject } from './project-service.js'

type Candidate = { title: string; authors: string[]; year: number | null; doi: string | null; source_url: string; source_provider: string; abstract?: string | null; pdf_url?: string | null; verified: false; resource_type: 'paper' }

function userAgent(): string { return process.env.RESEARCH_USER_AGENT || 'ResearchOS/0.3 (local research tool)' }
async function providerJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'user-agent': userAgent(), accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`http_${response.status}`)
  return response.json()
}

async function crossref(query: string, limit: number): Promise<Candidate[]> {
  const data = await providerJson(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}`) as { message?: { items?: Array<Record<string, unknown>> } }
  return (data.message?.items || []).flatMap(item => {
    const title = Array.isArray(item.title) ? String(item.title[0] || '') : ''
    const url = String(item.URL || '')
    if (!title || !url) return []
    const authors = Array.isArray(item.author) ? item.author.map(value => { const author = value as Record<string, unknown>; return [author.given, author.family].filter(Boolean).join(' ') }).filter(Boolean) : []
    const parts = ((item.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts'] || [])[0]
    const links = Array.isArray(item.link) ? item.link as Array<Record<string, unknown>> : []
    const pdf = links.find(link => String(link['content-type'] || '').includes('pdf'))
    return [{ title, authors, year: parts?.[0] || null, doi: item.DOI ? String(item.DOI) : null, source_url: url, source_provider: 'crossref', pdf_url: pdf?.URL ? String(pdf.URL) : null, verified: false as const, resource_type: 'paper' as const }]
  })
}

async function openAlex(query: string, limit: number): Promise<Candidate[]> {
  const data = await providerJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`) as { results?: Array<Record<string, unknown>> }
  return (data.results || []).flatMap(item => {
    const title = String(item.title || '')
    const ids = (item.ids || {}) as Record<string, unknown>
    const url = String(ids.doi || item.id || '')
    if (!title || !url) return []
    const authorships = Array.isArray(item.authorships) ? item.authorships : []
    const authors = authorships.map(value => String(((value as Record<string, unknown>).author as Record<string, unknown> | undefined)?.display_name || '')).filter(Boolean)
    const doi = ids.doi ? String(ids.doi).replace(/^https?:\/\/doi\.org\//, '') : null
    const location = (item.best_oa_location || {}) as Record<string, unknown>
    const openAccess = (item.open_access || {}) as Record<string, unknown>
    const pdfUrl = location.pdf_url || openAccess.oa_url
    return [{ title, authors, year: typeof item.publication_year === 'number' ? item.publication_year : null, doi, source_url: url, source_provider: 'openalex', pdf_url: pdfUrl ? String(pdfUrl) : null, verified: false as const, resource_type: 'paper' as const }]
  })
}

export async function searchLiterature(projectId: string, query: string, limit: number) {
  await requireProject(projectId, true)
  const providers = await Promise.allSettled([crossref(query, limit), openAlex(query, limit)])
  const errors: Array<{ provider: string; error: string }> = []
  const candidates: Candidate[] = []
  providers.forEach((result, index) => {
    if (result.status === 'fulfilled') candidates.push(...result.value)
    else errors.push({ provider: index === 0 ? 'crossref' : 'openalex', error: result.reason instanceof Error ? result.reason.message : 'provider_failed' })
  })
  const unique = [...new Map(candidates.map(item => [(item.doi || item.title).toLowerCase(), item])).values()].slice(0, limit)
  for (const candidate of unique) {
    await database.query('INSERT INTO papers(id,project_id,title,doi,source_url,metadata,verified) VALUES ($1,$2,$3,$4,$5,$6,FALSE)', [crypto.randomUUID(), projectId, candidate.title, candidate.doi, candidate.source_url, { authors: candidate.authors, year: candidate.year, source_provider: candidate.source_provider, pdf_url: candidate.pdf_url || null }])
  }
  return { papers: unique, resource_candidates: unique, provider_errors: errors, evidence_status: 'metadata_candidates_only' }
}

export async function noveltyAnalysis(projectId: string) {
  await requireProject(projectId)
  const paperRows = await rows<{ id: string; title: string; verified: boolean }>('SELECT id,title,verified FROM papers WHERE project_id=$1', [projectId])
  const evidenceCount = Number((await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM evidence WHERE project_id=$1', [projectId]))?.count || 0)
  return {
    conclusion: evidenceCount > 0 ? 'candidate_review_required' : 'insufficient_fulltext_evidence',
    metadata_candidates: paperRows.length,
    verified_evidence_count: evidenceCount,
    warning: 'Metadata and title matches cannot establish novelty or duplicate research claims.',
  }
}

export async function diagnostics(projectId: string) {
  await requireProject(projectId)
  const experiments = await rows<{ id: string; status: string; metrics: Record<string, unknown>; error: string | null }>('SELECT id,status,metrics,error FROM experiments WHERE project_id=$1', [projectId])
  const metricValues = new Map<string, number[]>()
  for (const experiment of experiments) for (const [name, value] of Object.entries(experiment.metrics || {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    metricValues.set(name, [...(metricValues.get(name) || []), value])
  }
  const metrics = Object.fromEntries([...metricValues].map(([name, values]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    return [name, { count: values.length, mean, population_std: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) }]
  }))
  return { project_id: projectId, metrics, failed_runs: experiments.filter(item => item.status === 'failed').map(item => ({ run_id: item.id, error: item.error })), calculation: 'deterministic_typescript' }
}

export async function createOperationalReport(projectId: string, period: string) {
  const project = await requireProject(projectId)
  const counts = await one<Record<string, string>>(`SELECT
    (SELECT COUNT(*) FROM papers WHERE project_id=$1)::text AS papers,
    (SELECT COUNT(*) FROM evidence WHERE project_id=$1)::text AS evidence,
    (SELECT COUNT(*) FROM experiments WHERE project_id=$1)::text AS experiments,
    (SELECT COUNT(*) FROM proposals WHERE project_id=$1 AND status='pending')::text AS pending`, [projectId])
  if (!counts) throw new ApiError(500, 'report_query_failed', '无法生成项目报告。')
  const content = [`# ${period === 'weekly' ? 'Weekly' : period === 'daily' ? 'Daily' : 'Manual'} Research Report`, '', `Project: ${project.title}`, `Status: ${project.status}`, `Stage: ${project.current_stage}`, '', `- Literature candidates: ${counts.papers}`, `- Verified evidence records: ${counts.evidence}`, `- Experiments: ${counts.experiments}`, `- Pending approvals: ${counts.pending}`, '', 'Metadata candidates are not full-text evidence. Experiment outputs do not establish scientific conclusions.'].join('\n')
  const id = crypto.randomUUID()
  await database.query('INSERT INTO reports(id,project_id,period,content) VALUES ($1,$2,$3,$4)', [id, projectId, period, content])
  return { id, project_id: projectId, period, content }
}
