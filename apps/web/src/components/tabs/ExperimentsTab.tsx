import { useState } from 'react'
import { Activity, ListChecks, RefreshCw, RotateCcw, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { Checkpoint, DiagnosticsReport, Experiment, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading, statusLabel } from '../ui'
import { useTranslation } from '../../i18n'

export function ExperimentsTab({
  project,
  onRefresh,
  showToast,
  onNavigate,
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onNavigate: (tab: TabId) => void
}) {
  const { t } = useTranslation()
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)

  const createExperimentPlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/experiment-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('experiment.toastPlan', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const runDiagnostics = async () => {
    setDiagnosticsLoading(true)
    try {
      const report = await api<DiagnosticsReport>(`/api/projects/${project.id}/diagnostics`, { method: 'POST' })
      setDiagnostics(report)
      showToast(t('experiment.diagDone'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setDiagnosticsLoading(false)
    }
  }

  const syncRun = async (runId: string) => {
    try {
      await api(`/api/experiments/${runId}/sync`, { method: 'POST' })
      await onRefresh()
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const cancelRun = async (runId: string) => {
    try {
      await api(`/api/experiments/${runId}/cancel`, { method: 'POST' })
      await onRefresh()
      showToast(t('experiment.cancelled'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const checkpointForExperiment = (experiment: Experiment): Checkpoint | undefined => {
    const stage = experiment.status === 'succeeded'
      ? 'experiment_succeeded'
      : experiment.status === 'failed'
        ? 'experiment_failed'
        : null
    if (!stage) return undefined
    return (project.checkpoints || []).find(item => item.stage === stage && item.state?.run_id === experiment.id)
  }

  const proposeCheckpointRerun = async (checkpointId: string) => {
    const reason = window.prompt(t('experiment.rerunPrompt'), t('experiment.rerunDefault'))
    if (!reason || reason.trim().length < 5) return
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/checkpoints/${checkpointId}/rerun`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('experiment.rerunToast', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const metricRows = diagnostics
    ? Object.entries(diagnostics.metrics || {}).map(([name, value]) => (
        <div className="data-row" key={name}>
          <div>
            <h3>{name}</h3>
            <p>
              n={value.count} · mean={Number(value.mean).toPrecision(6)} · std={Number(value.population_std ?? value.std).toPrecision(6)} ·
              range {Number(value.min).toPrecision(6)}–{Number(value.max).toPrecision(6)}
            </p>
          </div>
          <Badge status="calculated" />
        </div>
      ))
    : []

  return (
    <>
      <SectionHeading
        title={t('experiment.title')}
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={createExperimentPlan}>
              <ListChecks size={15} />
              {t('experiment.plan')}
            </button>
            <button className="secondary" type="button" disabled={diagnosticsLoading} onClick={runDiagnostics}>
              <Activity size={15} />
              {t('experiment.diagnostics')}
            </button>
          </ButtonRow>
        }
      />
      {project.experiments?.length ? (
        <div className="data-list">
          {project.experiments.map(experiment => {
            const checkpoint = checkpointForExperiment(experiment)
            return (
              <div className="data-row" key={experiment.id}>
                <div>
                  <h3>{experiment.experiment_type}</h3>
                  <p>{JSON.stringify(experiment.metrics)}{experiment.run_id ? ` · ${t('overview.runDetail', { run: experiment.run_id })}` : ''}</p>
                </div>
                <div className="button-row">
                  <Badge status={experiment.status} />
                  <button className="secondary" type="button" onClick={() => syncRun(experiment.id)}>
                    <RefreshCw size={15} />
                    {t('experiment.sync')}
                  </button>
                  {['queued', 'running'].includes(experiment.status) ? (
                    <button className="reject" type="button" onClick={() => cancelRun(experiment.id)}>
                      <Square size={15} />
                      {t('common.cancel')}
                    </button>
                  ) : null}
                  {checkpoint ? (
                    <button className="secondary" type="button" onClick={() => proposeCheckpointRerun(checkpoint.id)}>
                      <RotateCcw size={15} />
                      {t('experiment.rerun')}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState text={t('experiment.empty')} />
      )}
      <div className="section">
        <SectionHeading title={t('experiment.diagnosticsTitle')} />
        {diagnosticsLoading ? (
          <EmptyState text={t('experiment.loadingDiagnostics')} />
        ) : diagnostics ? (
          <>
            <div className="section-head">
              <h3>{t('experiment.numericSummary')}</h3>
              <span className="muted">{t('experiment.runCount', { count: diagnostics.run_count ?? 0 })}</span>
            </div>
            <div className="data-list">
              {metricRows.length ? metricRows : <EmptyState text={t('experiment.noMetrics')} />}
            </div>
            {diagnostics.failures?.length ? (
              <>
                <div className="section-head"><h3>{t('experiment.failureDiagnostics')}</h3></div>
                <div className="data-list">
                  {diagnostics.failures.map((failure, index) => (
                    <div className="data-row" key={index}>
                      <div>
                        <h3>{failure.experiment_id.slice(0, 8)}</h3>
                        <p>{statusLabel(failure.status, t)} · {failure.error_code}</p>
                      </div>
                      <Badge status="failed" />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {diagnostics.suggestions?.length ? (
              <>
                <div className="section-head">
                  <h3>{t('experiment.suggestions')}</h3>
                  <span className="badge pending">Proposal {String(diagnostics.proposal_id || '').slice(0, 8)}</span>
                </div>
                <div className="data-list">
                  {diagnostics.suggestions.map((suggestion, index) => (
                    <div className="data-row" key={index}>
                      <div>
                        <h3>{suggestion.title}</h3>
                        <p>{suggestion.reason}</p>
                        <p className="muted">{t('experiment.evidenceRuns')} {(suggestion.evidence_experiment_ids || []).map(id => id.slice(0, 8)).join(', ')}</p>
                      </div>
                      <span className="badge pending">{t('common.pendingApproval')}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <EmptyState text={t('experiment.diagnosticsEmpty')} />
        )}
      </div>
    </>
  )
}
