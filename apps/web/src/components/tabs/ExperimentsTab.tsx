import { useState } from 'react'
import { Activity, ListChecks, RefreshCw, RotateCcw, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { Checkpoint, DiagnosticsReport, Experiment, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'

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
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)

  const createExperimentPlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/experiment-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(`主题专属计划 ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const runDiagnostics = async () => {
    setDiagnosticsLoading(true)
    try {
      const report = await api<DiagnosticsReport>(`/api/projects/${project.id}/diagnostics`, { method: 'POST' })
      setDiagnostics(report)
      showToast('诊断完成，建议需审批后才能执行')
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
      showToast('运行已取消')
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
    const reason = window.prompt('请说明局部重跑原因', '复核该实验在当前项目快照下的结果')
    if (!reason || reason.trim().length < 5) return
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/checkpoints/${checkpointId}/rerun`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(`局部重跑 Proposal ${result.proposal_id.slice(0, 8)} 已创建，等待审批`)
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
          <Badge status="已计算" />
        </div>
      ))
    : []

  return (
    <>
      <SectionHeading
        title="实验规划与运行"
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={createExperimentPlan}>
              <ListChecks size={15} />
              生成主题专属计划
            </button>
            <button className="secondary" type="button" disabled={diagnosticsLoading} onClick={runDiagnostics}>
              <Activity size={15} />
              数值诊断
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
                  <p>{JSON.stringify(experiment.metrics)}{experiment.run_id ? ` · Run ${experiment.run_id}` : ''}</p>
                </div>
                <div className="button-row">
                  <Badge status={experiment.status} />
                  <button className="secondary" type="button" onClick={() => syncRun(experiment.id)}>
                    <RefreshCw size={15} />
                    同步
                  </button>
                  {['queued', 'running'].includes(experiment.status) ? (
                    <button className="reject" type="button" onClick={() => cancelRun(experiment.id)}>
                      <Square size={15} />
                      取消
                    </button>
                  ) : null}
                  {checkpoint ? (
                    <button className="secondary" type="button" onClick={() => proposeCheckpointRerun(checkpoint.id)}>
                      <RotateCcw size={15} />
                      提出局部重跑
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState text="生成计划后会先进入审批；系统不会自动创建无关实验。" />
      )}
      <div className="section">
        <SectionHeading title="数值诊断" />
        {diagnosticsLoading ? (
          <EmptyState text="正在计算数值摘要与失败诊断…" />
        ) : diagnostics ? (
          <>
            <div className="section-head">
              <h3>数值摘要</h3>
              <span className="muted">{diagnostics.run_count ?? 0} 次运行 · TypeScript 确定性计算</span>
            </div>
            <div className="data-list">
              {metricRows.length ? metricRows : <EmptyState text="没有可比较的数值指标。" />}
            </div>
            {diagnostics.failures?.length ? (
              <>
                <div className="section-head"><h3>失败诊断</h3></div>
                <div className="data-list">
                  {diagnostics.failures.map((failure, index) => (
                    <div className="data-row" key={index}>
                      <div>
                        <h3>{failure.experiment_id.slice(0, 8)}</h3>
                        <p>{failure.status} · {failure.error_code}</p>
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
                  <h3>后续建议</h3>
                  <span className="badge pending">Proposal {String(diagnostics.proposal_id || '').slice(0, 8)}</span>
                </div>
                <div className="data-list">
                  {diagnostics.suggestions.map((suggestion, index) => (
                    <div className="data-row" key={index}>
                      <div>
                        <h3>{suggestion.title}</h3>
                        <p>{suggestion.reason}</p>
                        <p className="muted">证据运行: {(suggestion.evidence_experiment_ids || []).map(id => id.slice(0, 8)).join(', ')}</p>
                      </div>
                      <span className="badge pending">待审批</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <EmptyState text="运行数值诊断以计算指标并检查失败日志。" />
        )}
      </div>
    </>
  )
}
