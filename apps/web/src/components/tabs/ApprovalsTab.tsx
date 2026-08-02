import { Check, Play, X } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, Proposal, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'
import { useTranslation } from '../../i18n'

export function ApprovalsTab({
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
  const decide = async (proposalId: string, decision: 'approved' | 'rejected') => {
    try {
      await api(`/api/proposals/${proposalId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, actor: 'local-user' }),
      })
      await onRefresh()
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const launch = async (proposal: Proposal) => {
    const payload = proposal.payload || {}
    try {
      const result = await api<{ run_id: string }>('/api/experiments', {
        method: 'POST',
        body: JSON.stringify({
          project_id: project.id,
          proposal_id: proposal.id,
          experiment_type: payload.experiment_type,
          config: payload.config,
          random_seeds: payload.random_seeds,
          topic_plan: payload.topic_plan,
          topic_resume: payload.topic_resume,
        }),
      })
      await onRefresh()
      onNavigate('experiments')
      showToast(t('approvals.launchToast', { id: result.run_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  return (
    <>
      <SectionHeading title={t('approvals.title')} hint={t('approvals.hint')} />
      {project.proposals?.length ? (
        <div className="data-list">
          {project.proposals.map(proposal => {
            const execution = proposal.impact?.automatic_execution || {}
            const rerunStatus = proposal.kind === 'experiment_rerun' && proposal.status === 'approved'
              ? execution.status === 'failed'
              ? t('approvals.rerunFailed')
                : execution.run_id
                  ? t('approvals.rerunSubmitted', { id: String(execution.run_id).slice(0, 8) })
                  : t('approvals.rerunPending')
              : null
            const canLaunch = proposal.status === 'approved' && proposal.kind === 'experiment_plan'
            return (
              <div className="data-row" key={proposal.id}>
                <div>
                  <h3>{proposal.summary}</h3>
                  <p>{proposal.reason} · {t('approvals.estimatedCost')} ${Number(proposal.estimated_cost_usd || 0).toFixed(2)}</p>
                  {proposal.diff ? <pre className="code-block">{proposal.diff}</pre> : null}
                  <p>{t('approvals.impact')} {JSON.stringify(proposal.impact)}</p>
                </div>
                <div className="button-row">
                  <Badge status={proposal.status} />
                  {proposal.status === 'pending' ? (
                    <>
                      <button className="approve" type="button" onClick={() => decide(proposal.id, 'approved')}>
                        <Check size={15} />
                        {t('approvals.approve')}
                      </button>
                      <button className="reject" type="button" onClick={() => decide(proposal.id, 'rejected')}>
                        <X size={15} />
                        {t('approvals.reject')}
                      </button>
                    </>
                  ) : null}
                  {canLaunch ? (
                    <button className="secondary" type="button" onClick={() => launch(proposal)}>
                      <Play size={15} />
                      {proposal.payload?.plan_type === 'topic_specific' ? t('approvals.runTopicPlan') : t('approvals.execute')}
                    </button>
                  ) : null}
                  {rerunStatus ? <span className="muted">{rerunStatus}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState text={t('approvals.empty')} />
      )}
    </>
  )
}
