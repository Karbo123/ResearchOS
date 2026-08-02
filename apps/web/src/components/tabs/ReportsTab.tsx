import { useEffect, useMemo, useState } from 'react'
import { Check, FileText, Gavel, MessageSquare, Send, X } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { AuditEvent, HumanFeedback, ProjectDetail, Report, TabId } from '../../types'
import { MarkdownPreview } from '../MarkdownPreview'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'
import { formatDateTime, useTranslation } from '../../i18n'

function displayable(report: Report | undefined): boolean {
  return report?.status === 'valid'
}

function periodForTab(tab: TabId): 'daily' | 'weekly' {
  return tab === 'weekly_reports' ? 'weekly' : 'daily'
}

export function ReportsTab({
  project,
  tab,
  onRefresh,
  showToast,
}: {
  project: ProjectDetail
  tab: TabId
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}) {
  const { t, locale } = useTranslation()
  const isFeedback = tab === 'feedback_inbox'
  const isAudit = tab === 'feedback_audit'
  const period = periodForTab(tab)
  const [content, setContent] = useState('')
  const [activeReportId, setActiveReportId] = useState('')
  const [activeReportStatus, setActiveReportStatus] = useState('')
  const [activeReportReason, setActiveReportReason] = useState('')
  const [feedback, setFeedback] = useState('')
  const [feedbackCategory, setFeedbackCategory] = useState<'report' | 'general'>('report')
  const [feedbackRows, setFeedbackRows] = useState<HumanFeedback[]>(project.feedback || [])
  const [auditRows, setAuditRows] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)

  const reports = useMemo(
    () => (project.reports || []).filter(report => report.period === period),
    [period, project.reports],
  )

  useEffect(() => {
    const latest = reports[0]
    setContent(displayable(latest) ? latest?.content || '' : '')
    setActiveReportId(latest?.id || '')
    setActiveReportStatus(latest?.status || '')
    setActiveReportReason(latest?.blocking_reason || '')
  }, [project.id, period, reports])

  useEffect(() => {
    if (!isFeedback && !isAudit) return
    setLoading(true)
    const request = isFeedback
      ? api<{ feedback: HumanFeedback[] }>(`/api/projects/${project.id}/feedback`).then(result => setFeedbackRows(result.feedback || []))
      : api<AuditEvent[]>(`/api/projects/${project.id}/audit`).then(result => setAuditRows(result || []))
    request.catch(error => showToast(errorMessage(error))).finally(() => setLoading(false))
  }, [isAudit, isFeedback, project.id])

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

  if (isFeedback) {
    return (
      <>
        <SectionHeading title={t('reports.feedbackInbox')} hint={t('reports.feedbackHint')} extra={<Badge status="project-scoped">{project.id.slice(0, 8)}</Badge>} />
        {loading ? <EmptyState text={t('reports.loadingFeedback')} /> : feedbackRows.length ? (
          <div className="data-list">
            {feedbackRows.map(row => (
              <article className="data-row feedback-row" key={row.id}>
                <div>
                  <h3>{row.instruction}</h3>
                  <p>{row.category} · {formatDateTime(row.created_at, locale)}{row.reference_id ? ` · ${t('reports.reference')} ${row.reference_id.slice(0, 8)}` : ''}</p>
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
      </>
    )
  }

  if (isAudit) {
    const relevant = auditRows.filter(row => row.action.startsWith('human_feedback') || row.action.startsWith('proposal.'))
    return (
      <>
        <SectionHeading title={t('reports.auditTitle')} hint={t('reports.auditHint', { projectId: project.id })} extra={<Badge status="project-scoped">project_scoped</Badge>} />
        {loading ? <EmptyState text={t('reports.loadingAudit')} /> : relevant.length ? <div className="data-list">{relevant.map(row => <div className="data-row" key={row.id}><div><h3>{row.action}</h3><p>{row.actor} · {formatDateTime(row.created_at, locale)} · {JSON.stringify(row.details || {})}</p></div><Badge status="recorded" /></div>)}</div> : <EmptyState text={t('reports.noAudit')} />}
      </>
    )
  }

  return (
    <>
      <SectionHeading title={period === 'daily' ? t('reports.daily') : t('reports.weekly')} hint={t('reports.periodHint')} extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void generateReport() }}><FileText size={15} />{t('reports.generate', { period: period === 'daily' ? t('reports.daily') : t('reports.weekly') })}</button></ButtonRow>} />
      <div className={`${content ? 'report' : activeReportStatus && activeReportStatus !== 'valid' ? 'empty report-blocked' : 'empty'}`}>
        {content ? <MarkdownPreview content={content} /> : activeReportStatus && activeReportStatus !== 'valid' ? t('reports.blocked', { reason: activeReportReason || t('reports.lineageUnverifiable') }) : t('reports.noneForPeriod', { period: period === 'daily' ? t('reports.daily') : t('reports.weekly') })}
      </div>
      {reports.length > 1 ? <div className="section"><h3>{t('reports.history')}</h3><div className="data-list">{reports.slice(1).map(report => <div className="data-row" key={report.id}><div><h3>{formatDateTime(report.created_at, locale)}</h3><p>{report.id} · source snapshot {report.source_snapshot ? t('common.recorded') : t('common.missing')}</p></div><ButtonRow><Badge status={report.status || 'legacy_unverified'} /><button className="secondary" type="button" onClick={() => selectReport(report)}>{report.status === 'valid' ? t('reports.view') : t('reports.viewStatus')}</button></ButtonRow></div>)}</div></div> : null}
    </>
  )
}
