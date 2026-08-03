import { FileCheck, FilePenLine, Pause, Play, Search, ShieldAlert, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ConfirmRequest, ProjectDetail, SpecFieldStatusEntry, TabId } from '../../types'
import { Badge, ButtonRow, SectionHeading } from '../ui'
import { formatDateTime, useTranslation, type TranslationKey } from '../../i18n'
import { NoveltyExplorer } from '../NoveltyExplorer'

const CORE_FIELDS = ['research_question', 'domain', 'available_data', 'ethics_and_compliance']
const FIELD_LABEL_KEYS: Record<string, TranslationKey> = {
  research_question: 'spec.researchQuestion',
  domain: 'spec.domain',
  available_data: 'spec.availableData',
  ethics_and_compliance: 'spec.ethicsAndCompliance',
}

function FieldStatusPill({ status }: { status?: SpecFieldStatusEntry }) {
  const { t } = useTranslation()
  const kind = status?.status || 'unresolved'
  const labelKey = kind === 'user_confirmed'
    ? 'spec.fieldConfirmed'
    : kind === 'model_candidate'
      ? 'spec.fieldModelCandidate'
      : 'spec.fieldUnresolved'
  return <span className={`spec-field-pill spec-field-${kind}`}>{t(labelKey)}</span>
}

function SpecificationField({ label, field, value, status, emptyLabel }: { label: string; field: string; value?: string | string[]; status?: SpecFieldStatusEntry; emptyLabel: string }) {
  const { t, locale } = useTranslation()
  const values = Array.isArray(value) ? value.filter(item => item.trim()) : value?.trim() ? [value.trim()] : []
  const sourceKey = status?.source === 'user_revision'
    ? t('spec.sourceUserRevision')
    : status?.source === 'project_spec'
      ? t('spec.sourceProjectSpec')
      : t('spec.sourceModelDraft')
  const metaParts = [sourceKey, `${t('spec.ideaVersionShort', { version: status?.version ?? 1 })}`]
  if (status?.confirmed_at) metaParts.push(formatDateTime(status.confirmed_at, locale))
  const diffParts: string[] = []
  if (status?.changed_from_version && status.changed_from_version !== status.version) {
    diffParts.push(t('spec.changedFromVersion', { from: status.changed_from_version, to: status.version }))
  }
  if (status?.change_reason) diffParts.push(status.change_reason)
  return (
    <div className="spec-group">
      <div className="spec-group-head">
        <label>{label}</label>
        <FieldStatusPill status={status} />
      </div>
      <div className="spec-field-meta">{metaParts.join(' · ')}</div>
      {values.length > 1 ? <ul>{values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <div>{values[0] || emptyLabel}</div>}
      {diffParts.length ? <small className="spec-field-diff">{diffParts.join(' · ')}</small> : null}
    </div>
  )
}

function ProjectSpecificationTab({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  const spec = project.spec
  const idea = spec?.idea
  const fieldStatus = project.spec_field_status || {}
  const blockedFields = CORE_FIELDS.filter(field => fieldStatus[field]?.status !== 'user_confirmed')
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
      {blockedFields.length ? (
        <div className="spec-gate-notice" role="status">
          <ShieldAlert size={16} aria-hidden="true" />
          <div>
            <strong>{t('spec.gateTitle')}</strong>
            <p>{t('spec.gateDescription', { fields: blockedFields.map(field => t(FIELD_LABEL_KEYS[field] || 'common.notConfirmed')).join('、') })}</p>
          </div>
        </div>
      ) : null}
      {spec && idea ? (
        <div className="project-spec-details">
          <SpecificationField label={t('spec.titleField')} field="title" value={idea.title} status={fieldStatus.title} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.researchQuestion')} field="research_question" value={idea.research_question} status={fieldStatus.research_question} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.domain')} field="domain" value={idea.domain} status={fieldStatus.domain} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.keywords')} field="keywords" value={idea.keywords} status={fieldStatus.keywords} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.hypotheses')} field="hypotheses" value={idea.hypotheses} status={fieldStatus.hypotheses} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.contributions')} field="expected_contributions" value={idea.expected_contributions} status={fieldStatus.expected_contributions} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.successCriteria')} field="success_criteria" value={idea.success_criteria} status={fieldStatus.success_criteria} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.targetVenues')} field="target_venues" value={idea.target_venues} status={fieldStatus.target_venues} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.availableData')} field="available_data" value={idea.available_data} status={fieldStatus.available_data} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.ethicsAndCompliance')} field="ethics_and_compliance" value={idea.ethics_and_compliance} status={fieldStatus.ethics_and_compliance} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.risks')} field="risks" value={idea.risks} status={fieldStatus.risks} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.openQuestions')} field="open_questions" value={idea.open_questions} status={fieldStatus.open_questions} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.feasibility')} field="feasibility" value={spec.feasibility} status={fieldStatus.feasibility} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.feasibilityNotes')} field="feasibility_notes" value={spec.feasibility_notes} status={fieldStatus.feasibility_notes} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.candidateModifications')} field="candidate_modifications" value={spec.candidate_modifications} status={fieldStatus.candidate_modifications} emptyLabel={emptyLabel} />
          <SpecificationField label={t('spec.approvals')} field="required_approvals" value={spec.required_approvals} status={fieldStatus.required_approvals} emptyLabel={emptyLabel} />
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
  if (tab === 'idea') {
    const idea = project.spec?.idea
    return (
      <>
        <ProjectSpecificationTab project={project} />
        <div className="section overview-grid">
          <div className="data-list overview-card">
            <SectionHeading title={t('overview.boundariesTitle')} hint={t('overview.boundariesHint')} />
            <div className="overview-fields">
              <div><span>{t('overview.risks')}</span><strong>{idea?.risks?.join('；') || t('common.notConfirmed')}</strong></div>
              <div><span>{t('overview.openQuestions')}</span><strong>{idea?.open_questions?.join('；') || t('common.notConfirmed')}</strong></div>
            </div>
          </div>
          <div className="data-list overview-card">
            <SectionHeading title={t('overview.ideaConversation')} hint={t('overview.ideaConversationHint')} />
            <p className="muted">{t('overview.ideaConversationLive')}</p>
          </div>
        </div>
        <NoveltyExplorer project={project} showToast={showToast} />
      </>
    )
  }
  const counts = project.counts || {
    papers: project.papers?.length || 0,
    experiments: project.experiments?.length || 0,
    artifacts: project.artifacts?.length || 0,
  }
  const pendingCount = project.proposals?.filter(proposal => proposal.status === 'pending').length || 0
  const spec = project.spec?.idea
  const fieldStatus = project.spec_field_status || {}
  const blockedFields = CORE_FIELDS.filter(field => fieldStatus[field]?.status !== 'user_confirmed')
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
  const specBlocked = blockedFields.length > 0

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
              <button className="secondary" type="button" disabled={executionDisabled || specBlocked} onClick={runSearch}>
                <Search size={15} />
                {t('overview.searchLiterature')}
              </button>
              <button className="secondary" type="button" disabled={executionDisabled || specBlocked} onClick={createPaperDraft}>
                <FilePenLine size={15} />
                {t('overview.paperDraft')}
              </button>
              <button className="secondary" type="button" disabled={executionDisabled || specBlocked} onClick={createCompilePlan}>
                <FileCheck size={15} />
                {t('overview.compilePaper')}
              </button>
            </ButtonRow>
          }
        />
        {specBlocked ? (
          <div className="spec-gate-notice compact" role="status">
            <ShieldAlert size={15} aria-hidden="true" />
            <div>
              <strong>{t('spec.gateTitle')}</strong>
              <p>{t('spec.gateDescription', { fields: blockedFields.map(field => t(FIELD_LABEL_KEYS[field] || 'common.notConfirmed')).join('、') })}</p>
            </div>
          </div>
        ) : null}
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
