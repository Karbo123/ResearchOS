import { AlertTriangle, Clock3, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { ProjectDetail } from '../types'
import { Badge } from './ui'

type ContextFailure = {
  code: string
  message: string
  source: string
  created_at?: string
}

function latestFailure(project: ProjectDetail): ContextFailure | null {
  const failures: ContextFailure[] = []
  for (const task of project.tasks || []) {
    if (task.status === 'failed' || task.error) failures.push({ code: task.kind, message: task.error || '任务失败', source: 'task', created_at: task.updated_at || task.created_at })
  }
  for (const attempt of project.related_work_attempts || []) {
    if (attempt.failure || ['failed', 'timed_out', 'rate_limited', 'invalid_response', 'cancelled'].includes(attempt.status)) {
      failures.push({ code: attempt.failure?.code || attempt.status, message: attempt.failure?.message || '来源请求失败', source: attempt.provider, created_at: attempt.finished_at || attempt.started_at })
    }
  }
  for (const experiment of project.experiments || []) {
    if (experiment.status === 'failed' || experiment.error) failures.push({ code: 'experiment_run', message: experiment.error || '实验运行失败', source: experiment.experiment_type, created_at: experiment.finished_at || experiment.created_at })
  }
  for (const reproduction of project.reproductions || []) {
    if (reproduction.error || reproduction.status.endsWith('_failed')) failures.push({ code: reproduction.status, message: reproduction.error || '复现流程失败', source: 'reproduction', created_at: reproduction.updated_at || reproduction.created_at })
  }
  for (const report of project.reports || []) {
    if (report.status === 'blocked' || report.status === 'failed') failures.push({ code: report.blocking_reason || report.status, message: report.blocking_reason || '报告来源谱系无法验证', source: 'report', created_at: report.created_at })
  }
  return failures.sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))[0] || null
}

function formatTime(value?: string) {
  if (!value) return '时间待记录'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

export function WorkspaceContextBar({ project }: { project: ProjectDetail }) {
  const pending = (project.proposals || []).filter(proposal => proposal.status === 'pending').length
  const failure = latestFailure(project)
  const scopeLabel = project.id
  return (
    <section className="workspace-context" aria-label="当前项目上下文">
      <div className="workspace-context-main">
        <div className="workspace-context-title">
          <Fingerprint size={15} aria-hidden="true" />
          <span>当前项目范围</span>
          <code title={scopeLabel}>{scopeLabel}</code>
        </div>
        <div className="workspace-context-meta">
          <span><Clock3 size={13} aria-hidden="true" />更新于 {formatTime(project.updated_at)}</span>
          <span><LockKeyhole size={13} aria-hidden="true" />project_scoped</span>
          <span><ShieldCheck size={13} aria-hidden="true" />Idea v{project.current_idea_version || 1}</span>
        </div>
      </div>
      <div className="workspace-context-actions">
        <Badge status={project.status}>{project.status}</Badge>
        <Badge status={pending ? 'pending' : 'ready'}>{pending ? `${pending} 个待审批` : '无待审批'}</Badge>
        {failure ? (
          <span className="workspace-context-failure" title={`${failure.code}: ${failure.message}`}>
            <AlertTriangle size={13} aria-hidden="true" />
            最近失败：{failure.code}
          </span>
        ) : <span className="workspace-context-ok">最近失败：无</span>}
      </div>
    </section>
  )
}
