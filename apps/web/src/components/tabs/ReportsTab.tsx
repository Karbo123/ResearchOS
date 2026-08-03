import { useEffect, useMemo, useState } from 'react'
import { Check, FileText, Gavel, MessageSquare, RefreshCw, Send, ShieldCheck, X } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { AuditEvent, HumanFeedback, ProjectDetail, Report } from '../../types'
import { MarkdownPreview } from '../MarkdownPreview'
import { Badge, ButtonRow, EmptyState, SectionHeading, statusLabel } from '../ui'
import { formatDateTime, useTranslation, type TranslationKey } from '../../i18n'

function displayable(report: Report | undefined): boolean {
  return report?.status === 'valid'
}

type ReportStateCategory =
  | 'completedFact'
  | 'structuralFailure'
  | 'waitingDecision'
  | 'modelSuggestion'
  | 'unverifiedCandidate'
  | 'externalBlocker'
  | 'empty'
  | 'recorded'

type ReportStatusFilter = 'all' | 'valid' | 'blocked' | 'legacy_unverified' | 'failed'
type ReportSourceFilter = 'all' | 'recorded' | 'missing'
type ReportRangeFilter = 'all' | '7d' | '30d'

type ParagraphSourceEntry = {
  heading: string
  source_ids: string[]
}

const REPORT_STATE_CATEGORIES: ReportStateCategory[] = [
  'completedFact',
  'structuralFailure',
  'waitingDecision',
  'modelSuggestion',
  'unverifiedCandidate',
  'externalBlocker',
  'empty',
  'recorded',
]

function reportStateLabel(category: ReportStateCategory, t: (key: TranslationKey) => string): string {
  switch (category) {
    case 'completedFact': return t('reports.state.completedFact')
    case 'structuralFailure': return t('reports.state.structuralFailure')
    case 'waitingDecision': return t('reports.state.waitingDecision')
    case 'modelSuggestion': return t('reports.state.modelSuggestion')
    case 'unverifiedCandidate': return t('reports.state.unverifiedCandidate')
    case 'externalBlocker': return t('reports.state.externalBlocker')
    case 'empty': return t('reports.state.empty')
    case 'recorded': return t('reports.state.recorded')
  }
}

function reportStateNext(category: ReportStateCategory, t: (key: TranslationKey) => string): string {
  switch (category) {
    case 'completedFact': return t('reports.next.completedFact')
    case 'structuralFailure': return t('reports.next.structuralFailure')
    case 'waitingDecision': return t('reports.next.waitingDecision')
    case 'modelSuggestion': return t('reports.next.modelSuggestion')
    case 'unverifiedCandidate': return t('reports.next.unverifiedCandidate')
    case 'externalBlocker': return t('reports.next.externalBlocker')
    case 'empty': return t('reports.next.empty')
    case 'recorded': return t('reports.next.recorded')
  }
}

function reportCategory(report: Report | undefined): ReportStateCategory {
  const status = String(report?.status || '').toLowerCase()
  if (status === 'valid') return 'completedFact'
  if (status === 'legacy_unverified') return 'unverifiedCandidate'
  if (['blocked', 'failed', 'invalid_response'].includes(status)) {
    const reason = `${report?.blocking_reason || ''} ${JSON.stringify(report?.source_snapshot || {})}`.toLowerCase()
    if (/(external|provider|region|model|timeout|rate_limit|unavailable|503)/.test(reason)) return 'externalBlocker'
    return 'structuralFailure'
  }
  return 'empty'
}

function categoryForFeedback(row: HumanFeedback): ReportStateCategory {
  const status = String(row.status || '').toLowerCase()
  if (status === 'rejected') return 'recorded'
  if (status === 'acknowledged' || status === 'proposal_created') return 'modelSuggestion'
  if (status === 'open' || status === 'revision_requested') return 'waitingDecision'
  return 'recorded'
}

function auditCategory(action: string): ReportStateCategory {
  if (action.startsWith('proposal.') && !/(approved|rejected|cancelled)/.test(action)) return 'waitingDecision'
  return 'recorded'
}

function sourceSnapshotSummary(report: Report, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const snapshot = report.source_snapshot
  if (!snapshot || Object.keys(snapshot).length === 0) return t('reports.noSourceSnapshot')
  const papers = Array.isArray(snapshot.paper_ids) ? snapshot.paper_ids.length : 0
  const evidence = Array.isArray(snapshot.evidence_ids) ? snapshot.evidence_ids.length : 0
  const experiments = Array.isArray(snapshot.experiment_ids) ? snapshot.experiment_ids.length : 0
  const artifacts = Array.isArray(snapshot.artifact_ids) ? snapshot.artifact_ids.length : 0
  const proposals = Array.isArray(snapshot.proposal_ids) ? snapshot.proposal_ids.length : 0
  return t('reports.sourceCounts', { papers, evidence, experiments, artifacts, proposals })
}

function hasSourceSnapshot(report: Report): boolean {
  return Boolean(report.source_snapshot && Object.keys(report.source_snapshot).length > 0)
}

function paragraphSourceEntries(report: Report | undefined): ParagraphSourceEntry[] {
  const raw = report?.source_snapshot?.paragraph_sources
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): ParagraphSourceEntry[] => {
    if (!item || typeof item !== 'object') return []
    const heading = 'heading' in item && typeof item.heading === 'string' ? item.heading : ''
    const sourceIds = 'source_ids' in item && Array.isArray(item.source_ids)
      ? item.source_ids.filter((id): id is string => typeof id === 'string')
      : []
    return heading ? [{ heading, source_ids: Array.from(new Set(sourceIds)) as string[] }] : []
  })
}

function StateBadge({ category }: { category: ReportStateCategory }) {
  const { t } = useTranslation()
  return (
    <span className={`report-state-badge state-${category}`} title={reportStateNext(category, t)}>
      {reportStateLabel(category, t)}
    </span>
  )
}

function NextStep({ category }: { category: ReportStateCategory }) {
  const { t } = useTranslation()
  return <p className="report-next-step">{reportStateNext(category, t)}</p>
}

export function ReportsTab({
  project,
  onRefresh,
  showToast,
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}) {
  const { t, locale } = useTranslation()
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily')
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<ReportSourceFilter>('all')
  const [rangeFilter, setRangeFilter] = useState<ReportRangeFilter>('all')
  const [content, setContent] = useState('')
  const [activeReportId, setActiveReportId] = useState('')
  const [activeReportStatus, setActiveReportStatus] = useState('')
  const [activeReportReason, setActiveReportReason] = useState('')
  const [feedback, setFeedback] = useState('')
  const [feedbackCategory, setFeedbackCategory] = useState<'report' | 'general'>('report')
  const [feedbackRows, setFeedbackRows] = useState<HumanFeedback[]>(project.feedback || [])
  const [auditRows, setAuditRows] = useState<AuditEvent[]>([])
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [loadingAudit, setLoadingAudit] = useState(false)

  const reports = useMemo(() => {
    const rangeMs = rangeFilter === '7d' ? 7 * 24 * 60 * 60 * 1000 : rangeFilter === '30d' ? 30 * 24 * 60 * 60 * 1000 : 0
    const cutoff = rangeMs ? Date.now() - rangeMs : 0
    return (project.reports || [])
      .filter(report => report.period === period)
      .filter(report => statusFilter === 'all' || report.status === statusFilter)
      .filter(report => sourceFilter === 'all'
        ? true
        : sourceFilter === 'recorded'
          ? hasSourceSnapshot(report)
          : !hasSourceSnapshot(report))
      .filter(report => !cutoff || new Date(report.created_at || 0).getTime() >= cutoff)
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())
  }, [period, project.reports, statusFilter, sourceFilter, rangeFilter])

  useEffect(() => {
    const latest = reports[0]
    setContent(displayable(latest) ? latest?.content || '' : '')
    setActiveReportId(latest?.id || '')
    setActiveReportStatus(latest?.status || '')
    setActiveReportReason(latest?.blocking_reason || '')
  }, [project.id, period, reports])

  useEffect(() => {
    setLoadingFeedback(true)
    setLoadingAudit(true)
    const feedbackRequest = api<{ feedback: HumanFeedback[] }>(`/api/projects/${project.id}/feedback`)
      .then(result => setFeedbackRows(result.feedback || []))
      .catch(error => showToast(errorMessage(error)))
      .finally(() => setLoadingFeedback(false))
    const auditRequest = api<AuditEvent[]>(`/api/projects/${project.id}/audit`)
      .then(result => setAuditRows(result || []))
      .catch(error => showToast(errorMessage(error)))
      .finally(() => setLoadingAudit(false))
    return () => {
      void feedbackRequest
      void auditRequest
    }
  }, [project.id])

  const generateReport = async () => {
    try {
      const result = await api<{ content: string }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ project_id: project.id, period }),
      })
      setContent(result.content)
      setActiveReportStatus('valid')
      setActiveReportReason('')
      await onRefresh()
      showToast(t('reports.generated', { period: period === 'daily' ? t('reports.daily') : t('reports.weekly') }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const selectReport = (report: Report) => {
    setActiveReportId(report.id)
    setContent(displayable(report) ? report.content : '')
    setActiveReportStatus(report.status || '')
    setActiveReportReason(report.blocking_reason || '')
  }

  const submitFeedback = async () => {
    const instruction = feedback.trim()
    if (!instruction) return
    try {
      await api(`/api/projects/${project.id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ category: feedbackCategory, instruction, reference_id: activeReportId || null }),
      })
      setFeedback('')
      await onRefresh()
      showToast(t('reports.feedbackRecorded'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const decideFeedback = async (feedbackId: string, decision: 'acknowledged' | 'rejected' | 'revision_requested') => {
    try {
      await api(`/api/projects/${project.id}/feedback/${feedbackId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, actor: 'local-user' }),
      })
      const result = await api<{ feedback: HumanFeedback[] }>(`/api/projects/${project.id}/feedback`)
      setFeedbackRows(result.feedback || [])
      await onRefresh()
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const createFeedbackProposal = async (row: HumanFeedback) => {
    try {
      await api(`/api/projects/${project.id}/feedback/${row.id}/proposal`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'diagnostic_suggestion',
          summary: t('reports.feedbackProposalSummary'),
          reason: row.instruction,
          payload: { category: row.category, reference_id: row.reference_id || null },
        }),
      })
      await onRefresh()
      showToast(t('reports.proposalCreated'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const relevantAudit = auditRows.filter(row => row.action.startsWith('human_feedback') || row.action.startsWith('proposal.'))
  const selectedReport = reports.find(report => report.id === activeReportId) || reports[0]
  const activeCategory: ReportStateCategory = content ? 'completedFact' : reportCategory(selectedReport)
  const activeSourceReport = content ? reports.find(report => report.id === activeReportId) : selectedReport
  const scopeLabel = project.slug || project.id.slice(0, 8)

  return (
    <>
      <SectionHeading title={t('reports.title')} hint={t('reports.hint')} />
      <div className="report-state-legend" aria-label={t('reports.stateLegend')}>
        <div className="report-state-legend-head">
          <span className="report-scope-chip"><ShieldCheck size={14} aria-hidden="true" />{t('reports.scopeLabel', { slug: scopeLabel })}</span>
          <span className="muted">{t('reports.scopeHint')}</span>
        </div>
        <div className="report-state-legend-grid">
          {REPORT_STATE_CATEGORIES.map(category => (
            <span className={`report-state-chip state-${category}`} key={category} title={reportStateNext(category, t)}>
              {reportStateLabel(category, t)}
            </span>
          ))}
        </div>
      </div>
      <div className="settings-segmented reports-period-switch" role="radiogroup" aria-label={t('reports.periodLabel')}>
        <button type="button" role="radio" aria-checked={period === 'daily'} className={period === 'daily' ? 'active' : ''} onClick={() => setPeriod('daily')}>
          {t('reports.daily')}
        </button>
        <button type="button" role="radio" aria-checked={period === 'weekly'} className={period === 'weekly' ? 'active' : ''} onClick={() => setPeriod('weekly')}>
          {t('reports.weekly')}
        </button>
      </div>

      <div className="report-filter-bar" aria-label={t('reports.filtersLabel')}>
        <label>{t('reports.statusFilter')}
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as ReportStatusFilter)}>
            <option value="all">{t('reports.filterAll')}</option>
            <option value="valid">{t('status.valid')}</option>
            <option value="blocked">{t('status.blocked')}</option>
            <option value="legacy_unverified">{t('status.legacyUnverified')}</option>
            <option value="failed">{t('status.failed')}</option>
          </select>
        </label>
        <label>{t('reports.sourceFilter')}
          <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value as ReportSourceFilter)}>
            <option value="all">{t('reports.filterAll')}</option>
            <option value="recorded">{t('reports.sourceRecorded')}</option>
            <option value="missing">{t('reports.sourceMissing')}</option>
          </select>
        </label>
        <label>{t('reports.rangeFilter')}
          <select value={rangeFilter} onChange={event => setRangeFilter(event.target.value as ReportRangeFilter)}>
            <option value="all">{t('reports.rangeAll')}</option>
            <option value="7d">{t('reports.range7d')}</option>
            <option value="30d">{t('reports.range30d')}</option>
          </select>
        </label>
        <label className="report-version-select">{t('reports.version')}
          <select
            value={reports.some(report => report.id === activeReportId) ? activeReportId : ''}
            onChange={event => {
              const report = reports.find(candidate => candidate.id === event.target.value)
              if (report) selectReport(report)
            }}
          >
            <option value="" disabled>{t('reports.chooseVersion')}</option>
            {reports.map(report => (
              <option value={report.id} key={report.id}>
                {formatDateTime(report.created_at, locale)} · {statusLabel(report.status, t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="section">
        <SectionHeading
          title={t('reports.currentReport')}
          hint={t('reports.periodHint')}
          extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void generateReport() }}><FileText size={15} />{t('reports.generate', { period: period === 'daily' ? t('reports.daily') : t('reports.weekly') })}</button></ButtonRow>}
        />
        <div className={`${content ? 'report' : activeReportStatus && activeReportStatus !== 'valid' ? 'empty report-blocked' : 'empty'}`}>
          {content ? <MarkdownPreview content={content} /> : activeReportStatus && activeReportStatus !== 'valid' ? t('reports.blocked', { reason: activeReportReason || t('reports.lineageUnverifiable') }) : t('reports.noneForPeriod', { period: period === 'daily' ? t('reports.daily') : t('reports.weekly') })}
          <div className="report-state-meta">
            <StateBadge category={activeCategory} />
            <NextStep category={activeCategory} />
            {activeSourceReport ? (
              <>
                <p className="report-source-line">{sourceSnapshotSummary(activeSourceReport, t)}</p>
                {activeSourceReport.missing_source_ids?.length ? <p className="report-source-line report-source-missing">{t('reports.missingSources', { ids: activeSourceReport.missing_source_ids.join(', ') })}</p> : null}
                <details className="report-paragraph-sources">
                  <summary>{t('reports.paragraphSources')}</summary>
                  {paragraphSourceEntries(activeSourceReport).length ? (
                    <div className="report-paragraph-source-list">
                      {paragraphSourceEntries(activeSourceReport).map(entry => (
                        <div className="report-paragraph-source-row" key={entry.heading}>
                          <strong>{entry.heading}</strong>
                          <span>{entry.source_ids.length
                            ? `${t('reports.paragraphSourceCount', { count: entry.source_ids.length })} · ${entry.source_ids.slice(0, 6).join(', ')}${entry.source_ids.length > 6 ? '…' : ''}`
                            : t('reports.noDirectSources')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{t('reports.paragraphSourcesUnavailable')}</p>
                  )}
                </details>
              </>
            ) : null}
          </div>
        </div>
        {reports.length > 1 ? <div className="section"><h3>{t('reports.history')}</h3><div className="data-list">{reports.slice(1).map(report => <div className="data-row report-history-row" key={report.id}><div><div className="report-row-title-line"><h3>{formatDateTime(report.created_at, locale)}</h3><StateBadge category={reportCategory(report)} /></div><p>{report.id} · {t('reports.sourceSnapshot')} {report.source_snapshot ? t('common.recorded') : t('common.missing')}</p><p className="report-source-line">{sourceSnapshotSummary(report, t)}</p>{report.missing_source_ids?.length ? <p className="report-source-line report-source-missing">{t('reports.missingSources', { ids: report.missing_source_ids.join(', ') })}</p> : null}<NextStep category={reportCategory(report)} /></div><ButtonRow><Badge status={report.status || 'legacy_unverified'} /><button className="secondary" type="button" onClick={() => selectReport(report)}>{report.status === 'valid' ? t('reports.view') : t('reports.viewStatus')}</button></ButtonRow></div>)}</div></div> : null}
      </div>

      <div className="section">
        <SectionHeading title={t('reports.feedbackInbox')} hint={t('reports.feedbackHint')} />
        {loadingFeedback ? <EmptyState text={t('reports.loadingFeedback')} /> : feedbackRows.length ? (
          <div className="data-list">
            {feedbackRows.map(row => (
              <article className="data-row feedback-row" key={row.id}>
                <div>
                  <h3>{row.instruction}</h3>
                  <p>{row.category} · {formatDateTime(row.created_at, locale)}{row.reference_id ? ` · ${t('reports.reference')} ${row.reference_id.slice(0, 8)}` : ''}</p>
                  <StateBadge category={categoryForFeedback(row)} />
                  <NextStep category={categoryForFeedback(row)} />
                  {row.decision_comment ? <p className="muted">{t('reports.decisionComment')}{row.decision_comment}</p> : null}
                </div>
                <div className="button-row">
                  <Badge status={row.status} />
                  {row.status === 'open' ? <>
                    <button className="approve" type="button" onClick={() => { void decideFeedback(row.id, 'acknowledged') }}><Check size={14} />{t('reports.acknowledge')}</button>
                    <button className="secondary" type="button" onClick={() => { void decideFeedback(row.id, 'revision_requested') }}><MessageSquare size={14} />{t('reports.requestRevision')}</button>
                    <button className="reject" type="button" onClick={() => { void decideFeedback(row.id, 'rejected') }}><X size={14} />{t('common.reject')}</button>
                  </> : null}
                  {row.status !== 'rejected' && row.status !== 'proposal_created' ? <button className="secondary" type="button" onClick={() => { void createFeedbackProposal(row) }}><Gavel size={14} />{t('reports.createProposal')}</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState text={t('reports.noFeedback')} />}
        <div className="section report-feedback">
          <SectionHeading title={t('reports.recordFeedback')} hint={t('reports.recordFeedbackHint')} />
          <div className="feedback-form">
            <label>{t('reports.feedbackType')}<select value={feedbackCategory} onChange={event => setFeedbackCategory(event.target.value as 'report' | 'general')}><option value="report">{t('reports.forReport')}</option><option value="general">{t('reports.nextDirection')}</option></select></label>
            <label>{t('reports.feedbackToAi')}<textarea maxLength={8000} value={feedback} placeholder={t('reports.feedbackPlaceholder')} onChange={event => setFeedback(event.target.value)} /></label>
            <button className="secondary" type="button" disabled={!feedback.trim()} onClick={() => { void submitFeedback() }}><Send size={15} />{t('reports.recordFeedbackAction')}</button>
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHeading title={t('reports.auditTitle')} hint={t('reports.auditHint', { projectId: project.id })} extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void onRefresh() }}><RefreshCw size={15} />{t('topbar.refresh')}</button></ButtonRow>} />
        {loadingAudit ? <EmptyState text={t('reports.loadingAudit')} /> : relevantAudit.length ? <div className="data-list">{relevantAudit.map(row => <div className="data-row" key={row.id}><div><h3>{row.action}</h3><p>{row.actor} · {formatDateTime(row.created_at, locale)} · {JSON.stringify(row.details || {})}</p><StateBadge category={auditCategory(row.action)} /><NextStep category={auditCategory(row.action)} /></div><Badge status="recorded" /></div>)}</div> : <EmptyState text={t('reports.noAudit')} />}
      </div>
    </>
  )
}
