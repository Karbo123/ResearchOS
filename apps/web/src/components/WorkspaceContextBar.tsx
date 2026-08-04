import { AlertTriangle, Clock3, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { ProjectDetail } from '../types'
import { Badge, StateNotice, type StateNoticeKind } from './ui'
import { formatDateTime, useTranslation, type TranslationKey } from '../i18n'
import { localizeFailure } from '../api'

type ContextFailure = {
  code: string
  message: string
  source: string
  created_at?: string
}

const STATE_LEGEND: Array<{ kind: StateNoticeKind; labelKey: TranslationKey; nextKey: TranslationKey; retryable: boolean }> = [
  { kind: 'empty', labelKey: 'stateNotice.empty', nextKey: 'stateNotice.next.empty', retryable: false },
  { kind: 'loading', labelKey: 'stateNotice.loading', nextKey: 'stateNotice.next.loading', retryable: false },
  { kind: 'ready', labelKey: 'stateNotice.success', nextKey: 'stateNotice.next.success', retryable: false },
  { kind: 'error', labelKey: 'stateNotice.failed', nextKey: 'stateNotice.next.failed', retryable: true },
  { kind: 'waiting', labelKey: 'stateNotice.waitingApproval', nextKey: 'stateNotice.next.waitingApproval', retryable: false },
  { kind: 'cancelled', labelKey: 'stateNotice.cancelled', nextKey: 'stateNotice.next.cancelled', retryable: false },
  { kind: 'partial', labelKey: 'stateNotice.partial', nextKey: 'stateNotice.next.partial', retryable: false },
  { kind: 'no_evidence', labelKey: 'stateNotice.noEvidence', nextKey: 'stateNotice.next.noEvidence', retryable: false },
  { kind: 'no_permission', labelKey: 'stateNotice.noPermission', nextKey: 'stateNotice.next.noPermission', retryable: false },
]

function latestFailure(project: ProjectDetail, t: (key: TranslationKey) => string): ContextFailure | null {
  const failures: ContextFailure[] = []
  for (const task of project.tasks || []) {
    if (task.status === 'failed' || task.error) failures.push({ code: task.kind, message: localizeFailure(task.kind, task.error || t('context.taskFailed')), source: 'task', created_at: task.updated_at || task.created_at })
  }
  for (const attempt of project.related_work_attempts || []) {
    if (attempt.failure || ['failed', 'timed_out', 'rate_limited', 'invalid_response', 'cancelled'].includes(attempt.status)) {
      failures.push({ code: attempt.failure?.code || attempt.status, message: localizeFailure(attempt.failure?.code || attempt.status, attempt.failure?.message || t('context.sourceRequestFailed')), source: attempt.provider, created_at: attempt.finished_at || attempt.started_at })
    }
  }
  for (const experiment of project.experiments || []) {
    if (experiment.status === 'failed' || experiment.error) failures.push({ code: 'experiment_run', message: localizeFailure('experiment_run', experiment.error || t('context.experimentFailed')), source: experiment.experiment_type, created_at: experiment.finished_at || experiment.created_at })
  }
  for (const reproduction of project.reproductions || []) {
    if (reproduction.error || reproduction.status.endsWith('_failed')) failures.push({ code: reproduction.status, message: localizeFailure(reproduction.status, reproduction.error || t('context.reproductionFailed')), source: 'reproduction', created_at: reproduction.updated_at || reproduction.created_at })
  }
  for (const report of project.reports || []) {
    if (report.status === 'blocked' || report.status === 'failed') failures.push({ code: report.blocking_reason || report.status, message: localizeFailure(report.blocking_reason || report.status, report.blocking_reason || t('context.reportLineageFailed')), source: 'report', created_at: report.created_at })
  }
  return failures.sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))[0] || null
}

export function WorkspaceContextBar({
  project,
  refreshing = false,
  onRefresh,
}: {
  project: ProjectDetail
  refreshing?: boolean
  onRefresh?: () => void
}) {
  const { t, locale } = useTranslation()
  const pending = (project.proposals || []).filter(proposal => proposal.status === 'pending').length
  const failure = latestFailure(project, t)
  const scopeLabel = project.id
  return (
    <section className="workspace-context" aria-label={t('context.ariaLabel')}>
      <div className="workspace-context-main">
        <div className="workspace-context-title">
          <Fingerprint size={15} aria-hidden="true" />
          <span>{t('context.currentScope')}</span>
          <code title={scopeLabel}>{scopeLabel}</code>
        </div>
        <div className="workspace-context-meta">
          <span><Clock3 size={13} aria-hidden="true" />{t('context.updatedAt')} {formatDateTime(project.updated_at, locale)}</span>
          <span><LockKeyhole size={13} aria-hidden="true" />{t('context.projectScoped')}</span>
          <span><ShieldCheck size={13} aria-hidden="true" />{t('overview.checkpointVersion', { version: project.current_idea_version || 1 })}</span>
        </div>
      </div>
      <div className="workspace-context-actions">
        <Badge status={project.status} />
        <Badge status={pending ? 'pending' : 'ready'}>{pending ? t('context.pendingCount', { count: pending }) : t('context.noPending')}</Badge>
        {failure ? (
          <span className="workspace-context-failure" title={`${failure.code}: ${failure.message}`}>
            <AlertTriangle size={13} aria-hidden="true" />
            {t('context.recentFailure', { code: failure.code })}
          </span>
        ) : <span className="workspace-context-ok">{t('context.noRecentFailure')}</span>}
      </div>
      <details className="workspace-state-details">
        <summary><ShieldCheck size={13} aria-hidden="true" />{t('context.stateDetails')}</summary>
        <div className="workspace-state-panel">
          <div className="workspace-state-current">
            <div className="workspace-state-current-meta">
              <span>{refreshing ? t('context.refreshing') : t('context.dataReady')}</span>
              <span>{t('context.updatedAt')} {formatDateTime(project.updated_at, locale)}</span>
              <span>{pending ? t('context.pendingCount', { count: pending }) : t('context.noPending')}</span>
              <span>{failure ? `${t('context.failureCode')} ${failure.code}` : t('context.noRecentFailure')}</span>
            </div>
            {failure ? (
              <StateNotice
                kind="error"
                title={t('context.failureTitle')}
                message={failure.message}
                code={failure.code}
                source={failure.source}
                scope={scopeLabel}
                retry={onRefresh}
                nextStep={t('stateNotice.next.failed')}
              />
            ) : (
              <StateNotice kind="ready" title={t('context.dataReady')} scope={scopeLabel} nextStep={t('stateNotice.next.success')} />
            )}
          </div>
          <div className="workspace-state-legend">
            <h4>{t('context.stateLegend')}</h4>
            <div className="workspace-state-legend-grid">
              {STATE_LEGEND.map(item => (
                <span className={`workspace-state-chip state-legend-${item.kind}`} key={item.kind} title={t(item.nextKey)}>
                  {t(item.labelKey)}
                </span>
              ))}
            </div>
            {pending ? <p className="workspace-state-next">{t('context.pendingNext')}</p> : null}
            {STATE_LEGEND.map(item => (
              <div className="workspace-state-legend-row" key={item.kind}>
                <code>{item.kind}</code>
                <div className="workspace-state-legend-copy">
                  <strong>{t(item.labelKey)}</strong>
                  <span>{t(item.nextKey)}</span>
                  <small>{t('context.failureSource')}: workspace · {t('context.failureScope')}: {scopeLabel}</small>
                </div>
                <em>{item.retryable ? t('stateNotice.retryable.yes') : t('stateNotice.retryable.no')}</em>
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
}
