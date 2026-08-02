import { useEffect, useMemo, useState } from 'react'
import { Check, FileText, Gavel, MessageSquare, Send, X } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { AuditEvent, HumanFeedback, ProjectDetail, Report, TabId } from '../../types'
import { MarkdownPreview } from '../MarkdownPreview'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'

function displayable(report: Report | undefined): boolean {
  return report?.status === 'valid'
}

function formatTime(value?: string) {
  if (!value) return '时间待记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
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
      showToast(`${period === 'daily' ? '日报' : '周报'}已生成；来源快照已记录`)
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
      showToast('导师反馈已记录；后续方向仍需 Proposal 才会执行')
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
          summary: '根据导师反馈生成待审阅下一步提案',
          reason: row.instruction,
          payload: { category: row.category, reference_id: row.reference_id || null },
        }),
      })
      await onRefresh()
      showToast('反馈提案已创建，请在“决策与审计”中审批')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  if (isFeedback) {
    return (
      <>
        <SectionHeading title="导师反馈收件箱" hint="反馈只能产生反馈决策、Proposal 和审计记录；不会直接改代码、装依赖、运行实验或推送 Git。" extra={<Badge status="project-scoped">{project.id.slice(0, 8)}</Badge>} />
        {loading ? <EmptyState text="正在读取当前项目的反馈…" /> : feedbackRows.length ? (
          <div className="data-list">
            {feedbackRows.map(row => (
              <article className="data-row feedback-row" key={row.id}>
                <div>
                  <h3>{row.instruction}</h3>
                  <p>{row.category} · {formatTime(row.created_at)}{row.reference_id ? ` · 关联 ${row.reference_id.slice(0, 8)}` : ''}</p>
                  {row.decision_comment ? <p className="muted">决策说明：{row.decision_comment}</p> : null}
                </div>
                <div className="button-row">
                  <Badge status={row.status} />
                  {row.status === 'open' ? <>
                    <button className="approve" type="button" onClick={() => { void decideFeedback(row.id, 'acknowledged') }}><Check size={14} />确认</button>
                    <button className="secondary" type="button" onClick={() => { void decideFeedback(row.id, 'revision_requested') }}><MessageSquare size={14} />要求修订</button>
                    <button className="reject" type="button" onClick={() => { void decideFeedback(row.id, 'rejected') }}><X size={14} />拒绝</button>
                  </> : null}
                  {row.status !== 'rejected' && row.status !== 'proposal_created' ? <button className="secondary" type="button" onClick={() => { void createFeedbackProposal(row) }}><Gavel size={14} />生成 Proposal</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState text="当前项目没有导师反馈。没有事件时保持 empty，不生成模板化报告。" />}
        <div className="section report-feedback">
          <SectionHeading title="记录新反馈" hint="反馈文本会保存到当前项目；语义记忆写入失败时直接显示结构化错误。" />
          <div className="feedback-form">
            <label>反馈类型<select value={feedbackCategory} onChange={event => setFeedbackCategory(event.target.value as 'report' | 'general')}><option value="report">针对报告</option><option value="general">下一步方向</option></select></label>
            <label>给 AI 学生的反馈<textarea maxLength={8000} value={feedback} placeholder="指出需要修正的结果、下一步方向或需要补充的证据" onChange={event => setFeedback(event.target.value)} /></label>
            <button className="secondary" type="button" disabled={!feedback.trim()} onClick={() => { void submitFeedback() }}><Send size={15} />记录反馈</button>
          </div>
        </div>
      </>
    )
  }

  if (isAudit) {
    const relevant = auditRows.filter(row => row.action.startsWith('human_feedback') || row.action.startsWith('proposal.'))
    return (
      <>
        <SectionHeading title="反馈与 Proposal 审计" hint={`只显示当前 project_id ${project.id} 下的决策、Proposal 和失败事件。`} extra={<Badge status="project-scoped">project_scoped</Badge>} />
        {loading ? <EmptyState text="正在读取项目审计…" /> : relevant.length ? <div className="data-list">{relevant.map(row => <div className="data-row" key={row.id}><div><h3>{row.action}</h3><p>{row.actor} · {formatTime(row.created_at)} · {JSON.stringify(row.details || {})}</p></div><Badge status="recorded" /></div>)}</div> : <EmptyState text="当前项目还没有反馈或 Proposal 审计事件。" />}
      </>
    )
  }

  return (
    <>
      <SectionHeading title={period === 'daily' ? '日报' : '周报'} hint="报告只读取真实事件并保存 source_snapshot；没有事件时显示 empty。" extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void generateReport() }}><FileText size={15} />生成{period === 'daily' ? '日报' : '周报'}</button></ButtonRow>} />
      <div className={`${content ? 'report' : activeReportStatus && activeReportStatus !== 'valid' ? 'empty report-blocked' : 'empty'}`}>
        {content ? <MarkdownPreview content={content} /> : activeReportStatus && activeReportStatus !== 'valid' ? `当前报告未显示：${activeReportReason || '来源谱系无法复核'}。请重新生成当前时间窗口的报告。` : `当前项目还没有${period === 'daily' ? '日报' : '周报'}。`}
      </div>
      {reports.length > 1 ? <div className="section"><h3>历史版本</h3><div className="data-list">{reports.slice(1).map(report => <div className="data-row" key={report.id}><div><h3>{formatTime(report.created_at)}</h3><p>{report.id} · source snapshot {report.source_snapshot ? '已记录' : '缺失'}</p></div><ButtonRow><Badge status={report.status || 'legacy_unverified'} /><button className="secondary" type="button" onClick={() => selectReport(report)}>{report.status === 'valid' ? '查看' : '查看状态'}</button></ButtonRow></div>)}</div></div> : null}
    </>
  )
}
