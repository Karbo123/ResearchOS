import { database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { requireProject } from './project-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'

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

export async function createOperationalReport(projectId: string, period: string, excludeTaskId?: string) {
  const project = await requireProject(projectId)
  const generatedAt = new Date()
  const windowStart = new Date(generatedAt)
  if (period === 'daily') windowStart.setHours(windowStart.getHours() - 24)
  else if (period === 'weekly') windowStart.setDate(windowStart.getDate() - 7)
  else windowStart.setTime(0)
  const windowStartIso = windowStart.toISOString()
  const generatedAtIso = generatedAt.toISOString()
  const [counts, papers, evidence, experiments, artifacts, proposals] = await Promise.all([
    one<Record<string, string>>(`SELECT
      (SELECT COUNT(*) FROM papers WHERE project_id=$1)::text AS papers,
      (SELECT COUNT(*) FROM evidence WHERE project_id=$1)::text AS evidence,
      (SELECT COUNT(*) FROM experiments WHERE project_id=$1)::text AS experiments,
      (SELECT COUNT(*) FROM proposals WHERE project_id=$1 AND status='pending')::text AS pending`, [projectId]),
    rows<{ id: string }>('SELECT id FROM papers WHERE project_id=$1 ORDER BY id', [projectId]),
    rows<{ id: string }>('SELECT id FROM evidence WHERE project_id=$1 ORDER BY id', [projectId]),
    rows<{ id: string }>('SELECT id FROM experiments WHERE project_id=$1 ORDER BY id', [projectId]),
    rows<{ id: string }>('SELECT id FROM artifacts WHERE project_id=$1 AND valid=TRUE ORDER BY id', [projectId]),
    rows<{ id: string }>('SELECT id FROM proposals WHERE project_id=$1 ORDER BY id', [projectId]),
  ])
  if (!counts) throw new ApiError(500, 'report_query_failed', '无法生成项目报告。')

  const [auditEvents, messages, tasks, recentExperiments, recentProposals, sourceAttempts, feedbackRows] = await Promise.all([
    rows<{ id: string; actor: string; action: string; details: Record<string, unknown>; created_at: string }>(
      'SELECT id,actor,action,details,created_at FROM audit_events WHERE project_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at,id',
      [projectId, windowStartIso, generatedAtIso],
    ),
    rows<{ id: string; role: string; content: string; created_at: string }>(
      `SELECT m.id,m.role,m.content,m.created_at
       FROM messages m JOIN conversation_sessions s ON s.id=m.session_id
       WHERE s.project_id=$1 AND m.created_at >= $2 AND m.created_at <= $3
       ORDER BY m.created_at,m.id`,
      [projectId, windowStartIso, generatedAtIso],
    ),
    rows<{ id: string; kind: string; status: string; error: string | null; updated_at: string }>(
      `SELECT id,kind,status,error,updated_at FROM tasks
       WHERE project_id=$1 AND updated_at >= $2 AND updated_at <= $3${excludeTaskId ? ' AND id<>$4' : ''}
       ORDER BY updated_at,id`,
      excludeTaskId ? [projectId, windowStartIso, generatedAtIso, excludeTaskId] : [projectId, windowStartIso, generatedAtIso],
    ),
    rows<{ id: string; experiment_type: string; status: string; run_id: string | null; error: string | null; created_at: string }>(
      'SELECT id,experiment_type,status,run_id,error,created_at FROM experiments WHERE project_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at,id',
      [projectId, windowStartIso, generatedAtIso],
    ),
    rows<{ id: string; kind: string; status: string; summary: string; created_at: string }>(
      'SELECT id,kind,status,summary,created_at FROM proposals WHERE project_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at,id',
      [projectId, windowStartIso, generatedAtIso],
    ),
    rows<{ id: string; provider: string; status: string; failure: Record<string, unknown> | null; created_at: string }>(
      'SELECT id,provider,status,failure,created_at FROM related_work_source_attempts WHERE project_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at,id',
      [projectId, windowStartIso, generatedAtIso],
    ),
    rows<{ id: string; category: string; status: string; instruction: string; created_at: string }>(
      'SELECT id,category,status,instruction,created_at FROM human_feedback WHERE project_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at,id',
      [projectId, windowStartIso, generatedAtIso],
    ),
  ])

  const eventCount = auditEvents.length + messages.length + tasks.length + recentExperiments.length + recentProposals.length + sourceAttempts.length + feedbackRows.length
  if (!eventCount) {
    throw new ApiError(409, 'report_no_events', `当前${period === 'weekly' ? '周' : period === 'daily' ? '日' : '时间'}窗口没有真实项目事件，报告保持 empty。`)
  }

  const shorten = (value: string, limit = 180): string => value.replace(/\s+/g, ' ').trim().slice(0, limit)
  const eventLines = [
    ...auditEvents.map(event => `[${event.created_at}] 审计 ${event.action} (${event.actor}) ${JSON.stringify(event.details || {})}`),
    ...messages.map(message => `[${message.created_at}] 对话 ${message.role}: ${shorten(message.content)}`),
    ...tasks.map(task => `[${task.updated_at}] 任务 ${task.kind}: ${task.status}${task.error ? `；失败：${shorten(task.error)}` : ''}`),
    ...recentExperiments.map(experiment => `[${experiment.created_at}] 实验 ${experiment.experiment_type}: ${experiment.status}${experiment.run_id ? `；Run ${experiment.run_id}` : ''}${experiment.error ? `；失败：${shorten(experiment.error)}` : ''}`),
    ...recentProposals.map(proposal => `[${proposal.created_at}] Proposal ${proposal.kind}: ${proposal.status}；${shorten(proposal.summary)}`),
    ...sourceAttempts.map(attempt => `[${attempt.created_at}] 来源 ${attempt.provider}: ${attempt.status}${attempt.failure ? `；失败：${shorten(String(attempt.failure.message || 'provider request failed'))}` : ''}`),
    ...feedbackRows.map(feedback => `[${feedback.created_at}] 反馈 ${feedback.category}: ${feedback.status}；${shorten(feedback.instruction)}`),
  ].sort((left, right) => left.localeCompare(right))
  const failureLines = [
    ...tasks.filter(item => item.error || ['failed', 'cancelled'].includes(item.status)).map(item => `- 任务 ${item.kind}：${item.error || item.status}`),
    ...recentExperiments.filter(item => item.error || ['failed', 'cancelled', 'invalidated'].includes(item.status)).map(item => `- 实验 ${item.experiment_type}：${item.error || item.status}`),
    ...sourceAttempts.filter(item => item.failure || !['succeeded', 'no_match'].includes(item.status)).map(item => `- ${item.provider}：${String(item.failure?.message || item.status)}`),
  ]
  const pendingLines = [
    ...recentProposals.filter(item => item.status === 'pending').map(item => `- Proposal ${item.kind}：${item.summary}`),
    ...feedbackRows.filter(item => ['open', 'revision_requested'].includes(item.status)).map(item => `- 反馈（${item.category}）：${shorten(item.instruction)}`),
  ]
  const sourceSnapshot = {
    project_id: projectId,
    idea_version: project.current_idea_version,
    window_start: windowStartIso,
    data_cutoff: generatedAtIso,
    event_count: eventCount,
    audit_event_ids: auditEvents.map(row => row.id),
    message_ids: messages.map(row => row.id),
    task_ids: tasks.map(row => row.id),
    feedback_ids: feedbackRows.map(row => row.id),
    related_work_attempt_ids: sourceAttempts.map(row => row.id),
    paper_ids: papers.map(row => row.id),
    evidence_ids: evidence.map(row => row.id),
    experiment_ids: experiments.map(row => row.id),
    artifact_ids: artifacts.map(row => row.id),
    proposal_ids: proposals.map(row => row.id),
  }
  const paragraphSources = [
    { heading: 'Observed activity', source_keys: ['audit_event_ids', 'message_ids', 'task_ids', 'feedback_ids', 'related_work_attempt_ids'] as const },
    { heading: 'Current project counts', source_keys: ['paper_ids', 'evidence_ids', 'experiment_ids', 'artifact_ids', 'proposal_ids'] as const },
    { heading: 'Failures and blockers', source_keys: ['task_ids', 'experiment_ids', 'related_work_attempt_ids'] as const },
    { heading: 'Waiting for decision', source_keys: ['proposal_ids', 'feedback_ids'] as const },
    { heading: 'Evidence boundary', source_keys: [] as const },
  ].map(item => ({
    heading: item.heading,
    source_ids: item.source_keys.flatMap(key => Array.isArray(sourceSnapshot[key]) ? sourceSnapshot[key] : []),
  }))
  const sourceSnapshotWithParagraphs = {
    ...sourceSnapshot,
    paragraph_sources: paragraphSources,
  }
  const content = [
    `# ${period === 'weekly' ? 'Weekly' : period === 'daily' ? 'Daily' : 'Manual'} Research Report`,
    '',
    `Project: ${project.title}`,
    `Status: ${project.status}`,
    `Stage: ${project.current_stage}`,
    `Window: ${windowStartIso} -> ${generatedAtIso}`,
    `Data cutoff: ${generatedAtIso}`,
    '',
    '## Observed activity',
    ...eventLines.map(line => `- ${line}`),
    '',
    '## Current project counts',
    `- Literature records: ${counts.papers}`,
    `- Evidence records: ${counts.evidence}`,
    `- Experiments: ${counts.experiments}`,
    `- Pending approvals: ${counts.pending}`,
    '',
    '## Failures and blockers',
    ...(failureLines.length ? failureLines : ['- None recorded in this window.']),
    '',
    '## Waiting for decision',
    ...(pendingLines.length ? pendingLines : ['- None recorded in this window.']),
    '',
    '## Evidence boundary',
    '- This report contains observed project events, not scientific conclusions.',
    '- Metadata candidates are not full-text evidence.',
    '- Experiment outputs require lineage and human review before they can support a paper claim.',
  ].join('\n')
  const id = crypto.randomUUID()
  await database.query('INSERT INTO reports(id,project_id,period,content,status,source_snapshot) VALUES ($1,$2,$3,$4,$5,$6)', [id, projectId, period, content, 'valid', sourceSnapshotWithParagraphs])
  if (supermemoryEnabled()) {
    await ingestProjectMemory(projectId, {
      source_type: 'report', source_id: id, artifact_id: null, uploaded_file_id: null,
      content, source_url: null, quote: null, locator: null, metadata: { report_period: period }, task_type: 'memory', idempotency_key: `report:${id}`,
    })
  }
  return { id, project_id: projectId, period, content }
}
