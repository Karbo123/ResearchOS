import { FileCheck, FilePenLine, Pause, Play, Search, ShieldAlert, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ConfirmRequest, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, SectionHeading } from '../ui'
import { formatDateTime, useTranslation } from '../../i18n'

function SpecificationField({ label, value, emptyLabel }: { label: string; value?: string | string[]; emptyLabel: string }) {
  const values = Array.isArray(value) ? value.filter(item => item.trim()) : value?.trim() ? [value.trim()] : []
  return (
    <div className="spec-group">
      <label>{label}</label>
      {values.length > 1 ? <ul>{values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <div>{values[0] || emptyLabel}</div>}
    </div>
  )
}

function ProjectSpecificationTab({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  const spec = project.spec
  const idea = spec?.idea
  const emptyLabel = t('common.notConfirmed')
  return (
    <>
      <div className="pane-heading">
        <div>
          <h2>{t('tab.overviewSpec')}</h2>
          <p className="muted">{t('overview.descriptionHint')}</p>
        </div>
        {spec?.feasibility ? <Badge status={spec.feasibility} /> : null}
      </div>
      {spec && idea ? (
        <div className="project-spec-details">
          <SpecificationField label={t('spec.titleField')} value={idea.title} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.researchQuestion')} value={idea.research_question} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.domain')} value={idea.domain} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.hypotheses')} value={idea.hypotheses} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.contributions')} value={idea.expected_contributions} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.successCriteria')} value={idea.success_criteria} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.targetVenues')} value={idea.target_venues} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.risks')} value={idea.risks} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.openQuestions')} value={idea.open_questions} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.feasibility')} value={spec.feasibility} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.feasibilityNotes')} value={spec.feasibility_notes} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.candidateModifications')} value={spec.candidate_modifications} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.approvals')} value={spec.required_approvals} emptyLabel={emptyLabel} />
        </div>
      ) : <div className="empty">{t('spec.empty')}</div>}
    </>
  )
}

export function OverviewTab({
  project,
  onRefresh,
  showToast,
  onNavigate,
  onRequestConfirm,
  tab = 'overview',
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onNavigate: (tab: TabId) => void
  onRequestConfirm: (request: ConfirmRequest) => void
  tab?: 'overview' | 'idea'
}) {
  const { t, locale } = useTranslation()
  if (tab === 'idea') return <ProjectSpecificationTab project={project} />
  const counts = project.counts || {
    papers: project.papers?.length || 0,
    experiments: project.experiments?.length || 0,
    artifacts: project.artifacts?.length || 0,
  }
  const pendingCount = project.proposals?.filter(proposal => proposal.status === 'pending').length || 0
  const spec = project.spec?.idea
  const checkpoints = project.checkpoints || []
  const proposals = project.proposals || []
  const experiments = project.experiments || []
  const timeline = [
    ...checkpoints.map(item => ({ id: `checkpoint-${item.id}`, label: item.stage, detail: t('overview.checkpointVersion', { version: item.idea_version ?? project.current_idea_version ?? 1 }), status: item.valid === false ? 'invalidated' : 'recorded', created_at: item.created_at })),
    ...proposals.map(item => ({ id: `proposal-${item.id}`, label: item.summary, detail: item.reason || item.kind, status: item.status, created_at: item.created_at })),
    ...experiments.map(item => ({ id: `experiment-${item.id}`, label: item.experiment_type, detail: item.run_id ? t('overview.runDetail', { run: item.run_id }) : t('overview.runPending'), status: item.status, created_at: item.created_at })),
  ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 8)

  const runSearch = async () => {
    try {
      showToast(t('overview.toastSearching'))
      await api('/api/search', { method: 'POST', body: JSON.stringify({ project_id: project.id, limit: 8 }) })
      await onRefresh()
      showToast(t('overview.toastSearchDone'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const createPaperDraft = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/paper-draft`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('overview.toastDraftProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const createCompilePlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/compile-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('overview.toastCompileProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const changeState = async (action: 'pause' | 'resume' | 'cancel') => {
    const reason = action === 'pause'
      ? 'User paused the project from the Web UI'
      : action === 'resume'
        ? 'User resumed the project from the Web UI'
        : 'User cancelled the project from the Web UI'
    try {
      await api(`/api/projects/${project.id}/state`, { method: 'POST', body: JSON.stringify({ action, reason }) })
      await onRefresh()
      showToast(action === 'pause' ? t('overview.toastPaused') : action === 'resume' ? t('overview.toastResumed') : t('overview.toastCancelled'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const isActive = project.status === 'active'
  const executionDisabled = !isActive

  return (
    <>
      <div className="metric-grid">
        <div className="metric"><span>{t('overview.papers')}</span><strong>{counts.papers ?? 0}</strong></div>
        <div className="metric"><span>{t('overview.experiments')}</span><strong>{counts.experiments ?? 0}</strong></div>
        <div className="metric"><span>{t('overview.artifacts')}</span><strong>{counts.artifacts ?? 0}</strong></div>
        <div className="metric"><span>{t('common.pendingApproval')}</span><strong>{pendingCount}</strong></div>
      </div>

      <div className="section">
        <SectionHeading
          title={t('overview.spec')}
          extra={
            <ButtonRow>
              <button className="secondary" type="button" disabled={executionDisabled} onClick={runSearch}>
                <Search size={15} />
                {t('overview.searchLiterature')}
              </button>
              <button className="secondary" type="button" disabled={executionDisabled} onClick={createPaperDraft}>
                <FilePenLine size={15} />
                {t('overview.paperDraft')}
              </button>
              <button className="secondary" type="button" disabled={executionDisabled} onClick={createCompilePlan}>
                <FileCheck size={15} />
                {t('overview.compilePaper')}
              </button>
            </ButtonRow>
          }
        />
        <div className="data-list">
          <div className="data-row">
            <div>
              <h3>{spec?.research_question || t('overview.noSpec')}</h3>
              <p>{spec?.domain} · {(spec?.keywords || []).join(', ')}</p>
            </div>
            <Badge status={project.spec?.feasibility} />
          </div>
        </div>
      </div>

      <div className="section overview-grid">
        <div className="data-list overview-card">
          <SectionHeading title={t('overview.projectDescription')} hint={t('overview.descriptionHint')} />
          <div className="overview-fields">
            <div><span>{t('overview.domain')}</span><strong>{spec?.domain || t('common.notConfirmed')}</strong></div>
            <div><span>{t('overview.question')}</span><strong>{spec?.research_question || t('common.notConfirmed')}</strong></div>
            <div><span>{t('overview.hypotheses')}</span><strong>{spec?.hypotheses?.join('；') || t('overview.notGenerated')}</strong></div>
            <div><span>{t('overview.successCriteria')}</span><strong>{spec?.success_criteria?.join('；') || t('overview.notGenerated')}</strong></div>
          </div>
        </div>
        <div className="data-list overview-card">
          <SectionHeading title={t('overview.innovationCandidates')} hint={t('overview.innovationHint')} />
          {spec?.expected_contributions?.length ? (
            <ul className="candidate-list">
              {spec.expected_contributions.map((item, index) => <li key={`${item}-${index}`}><ShieldAlert size={15} /><span>{item}</span><Badge status="candidate-only" /></li>)}
            </ul>
          ) : <p className="empty-inline">{t('overview.noInnovation')}</p>}
        </div>
      </div>

      <div className="section">
        <SectionHeading title={t('overview.progress')} hint={t('overview.progressHint')} />
        {timeline.length ? (
          <div className="timeline" role="list">
            {timeline.map(item => (
              <div className="timeline-item" role="listitem" key={item.id}>
                <span className="timeline-dot" />
                <div><strong>{item.label}</strong><p>{item.detail} · {formatDateTime(item.created_at, locale)}</p></div>
                <Badge status={item.status} />
              </div>
            ))}
          </div>
        ) : <div className="empty">{t('overview.noTimeline')}</div>}
      </div>

      <div className="section">
        <SectionHeading
          title={t('overview.projectStatus')}
          extra={
            project.status === 'active' ? (
              <ButtonRow>
                <button className="secondary" type="button" onClick={() => changeState('pause')}>
                  <Pause size={15} />
                  {t('overview.pause')}
                </button>
                <button className="reject" type="button" onClick={() => onRequestConfirm({
                  title: t('overview.cancelProject'),
                  description: t('overview.cancelConfirmDescription'),
                  confirmLabel: t('overview.confirmCancel'),
                  onConfirm: () => changeState('cancel'),
                })}>
                  <Square size={15} />
                  {t('overview.cancelProject')}
                </button>
              </ButtonRow>
            ) : project.status === 'paused' ? (
              <ButtonRow>
                <button className="approve" type="button" onClick={() => changeState('resume')}>
                  <Play size={15} />
                  {t('overview.resume')}
                </button>
                <button className="reject" type="button" onClick={() => onRequestConfirm({
                  title: t('overview.cancelProject'),
                  description: t('overview.cancelConfirmDescription'),
                  confirmLabel: t('overview.confirmCancel'),
                  onConfirm: () => changeState('cancel'),
                })}>
                  <Square size={15} />
                  {t('overview.cancelProject')}
                </button>
              </ButtonRow>
            ) : null
          }
        />
        <div className="data-list">
          <div className="data-row">
            <div>
              <h3>{project.current_stage === 'initialized' ? t('overview.stageInitialized') : project.current_stage || t('overview.stageUnknown')}</h3>
              <p>{t('overview.ideaVersion', {
                version: project.current_idea_version ?? 1,
                status: project.status === 'active'
                  ? t('overview.statusActive')
                  : project.status === 'paused'
                    ? t('overview.statusPaused')
                    : project.status === 'cancelled'
                      ? t('overview.statusCancelled')
                      : project.status,
              })}</p>
            </div>
            <Badge status={project.status} />
          </div>
        </div>
      </div>
    </>
  )
}
