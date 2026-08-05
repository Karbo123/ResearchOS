import { Archive, BookOpen, ClipboardCheck, FileCheck, FilePenLine, FlaskConical, Pause, Play, Search, ShieldAlert, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type {
  Artifact,
  AuditEvent,
  Checkpoint,
  ConfirmRequest,
  HumanFeedback,
  ProjectDetail,
  ProjectTask,
  RelatedWorkRun,
  Report,
  ReproductionRun,
  SpecFieldStatusEntry,
  TabId,
} from '../../types'
import { Badge, ButtonRow, SectionHeading } from '../ui'
import { formatDateTime, useTranslation, type TranslationKey } from '../../i18n'
import { NoveltyExplorer } from '../NoveltyExplorer'
import { WorkflowGraphCard } from '../WorkflowGraphCard'

const CORE_FIELDS = ['research_question', 'domain', 'available_data', 'ethics_and_compliance']
const FIELD_LABEL_KEYS: Record<string, TranslationKey> = {
  research_question: 'spec.researchQuestion',
  domain: 'spec.domain',
  available_data: 'spec.availableData',
  ethics_and_compliance: 'spec.ethicsAndCompliance',
}

type TimelineCategory = 'search' | 'reproduction' | 'artifact' | 'report' | 'feedback' | 'failure' | 'cancel' | 'pause' | 'approval' | 'invalidation' | 'experiment' | 'proposal' | 'checkpoint' | 'project' | 'memory' | 'evidence' | 'paper' | 'comparison' | 'related' | 'system'

type TimelineDraft = {
  id: string
  at?: string
  category: TimelineCategory
  titleKey: TranslationKey
  detail: string
  status?: string
}

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const TIMELINE_IGNORED_AUDIT_ACTIONS = new Set([
  'project.reordered',
  'project.pinned',
  'project.unpinned',
  'project.slugs_migrated',
  'project.artifact_files_migrated',
  'embedding.settings_updated',
  'memory.revoke_proposal_created',
])

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

function cleanText(value: string, max = 140): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

function auditEventMeta(action: string, details?: Record<string, unknown>): { category: TimelineCategory; titleKey: TranslationKey; status?: string } {
  const value = action.toLowerCase()
  const detailStatus = typeof details?.status === 'string' ? details.status : undefined
  if (value === 'project.created') return { category: 'project', titleKey: 'timeline.projectCreated', status: 'active' }
  if (value === 'project.workspace_created') return { category: 'project', titleKey: 'timeline.workspaceCreated', status: 'active' }
  if (value === 'project.paused' || value === 'project.pause.requested' || value === 'project.pause.completed') return { category: 'pause', titleKey: 'timeline.projectPaused', status: 'paused' }
  if (value === 'project.resumed' || value === 'project.resume.requested' || value === 'project.resume.completed') return { category: 'pause', titleKey: 'timeline.projectResumed', status: 'active' }
  if (value === 'project.cancelled' || value === 'project.cancel.requested' || value === 'project.cancel.completed') return { category: 'cancel', titleKey: 'timeline.projectCancelled', status: 'cancelled' }
  if (value.startsWith('proposal.')) {
    if (value === 'proposal.created') return { category: 'proposal', titleKey: 'timeline.proposalCreated', status: 'pending' }
    if (value === 'proposal.approved') return { category: 'approval', titleKey: 'timeline.proposalApproved', status: 'approved' }
    if (value === 'proposal.rejected') return { category: 'approval', titleKey: 'timeline.proposalRejected', status: 'rejected' }
    return { category: 'proposal', titleKey: 'timeline.proposalDecision', status: value.split('.')[1] || 'pending' }
  }
  if (value.startsWith('experiment.')) {
    if (value === 'experiment.failed') return { category: 'failure', titleKey: 'timeline.experimentFailed', status: 'failed' }
    if (value === 'experiment.cancelled') return { category: 'cancel', titleKey: 'timeline.experimentCancelled', status: 'cancelled' }
    if (value === 'experiment.succeeded' || (value === 'experiment.synced' && detailStatus === 'succeeded')) return { category: 'experiment', titleKey: 'timeline.experimentSucceeded', status: 'succeeded' }
    if (value === 'experiment.synced' && detailStatus === 'failed') return { category: 'failure', titleKey: 'timeline.experimentFailed', status: 'failed' }
    return { category: 'experiment', titleKey: 'timeline.experimentSubmitted', status: detailStatus || 'queued' }
  }
  if (value === 'repository.reproduction_downloaded') return { category: 'reproduction', titleKey: 'timeline.reproductionDownloaded', status: 'source_downloaded' }
  if (value === 'repository.reproduction_dependencies_installed') return { category: 'reproduction', titleKey: 'timeline.reproductionDependenciesInstalled', status: 'ready' }
  if (value === 'repository.reproduction_dependencies_failed') return { category: 'failure', titleKey: 'timeline.reproductionDependenciesFailed', status: 'dependency_failed' }
  if (value === 'repository.reproduction_succeeded_waiting_artifact') return { category: 'reproduction', titleKey: 'timeline.reproductionSucceeded', status: 'awaiting_artifact_approval' }
  if (value === 'repository.reproduction_failed') return { category: 'failure', titleKey: 'timeline.reproductionFailed', status: 'failed' }
  if (value === 'repository.reproduction_artifacts_registered') return { category: 'artifact', titleKey: 'timeline.reproductionArtifactsRegistered', status: 'valid' }
  if (value === 'repository.reproduction_artifacts_rejected') return { category: 'failure', titleKey: 'timeline.reproductionArtifactsRejected', status: 'rejected' }
  if (value.startsWith('related_work.recursive')) {
    if (value === 'related_work.recursive_started') return { category: 'search', titleKey: 'timeline.relatedWorkStarted', status: 'running' }
    if (value === 'related_work.recursive_failed') return { category: 'failure', titleKey: 'timeline.relatedWorkFailed', status: 'failed' }
    if (value === 'related_work.recursive_cancel_requested' || value === 'related_work.recursive_cancelled') return { category: 'cancel', titleKey: 'timeline.relatedWorkCancelled', status: 'cancelled' }
    return { category: 'search', titleKey: 'timeline.relatedWorkSucceeded', status: 'succeeded' }
  }
  if (value === 'related_work.seed_created') return { category: 'search', titleKey: 'timeline.seedCreated', status: 'resolved' }
  if (value.startsWith('related_work.candidate_')) {
    if (value === 'related_work.candidate_approved') return { category: 'approval', titleKey: 'timeline.candidateApproved', status: 'approved' }
    if (value === 'related_work.candidate_rejected') return { category: 'approval', titleKey: 'timeline.candidateRejected', status: 'rejected' }
    return { category: 'search', titleKey: 'timeline.relatedWorkDecision', status: value.split('_').pop() || 'pending' }
  }
  if (value === 'related_work.cache_hit') return { category: 'search', titleKey: 'timeline.cacheHit', status: 'cache_hit' }
  if (value === 'related_work.cache_miss') return { category: 'search', titleKey: 'timeline.cacheMiss', status: 'cache_miss' }
  if (value.startsWith('related_work.field_enrichment_')) return { category: 'search', titleKey: 'timeline.fieldEnrichment', status: value.split('_').pop() || 'pending' }
  if (value === 'literature.searched') return { category: 'search', titleKey: 'timeline.searchCompleted', status: 'completed' }
  if (value === 'novelty.analysis_generated') return { category: 'related', titleKey: 'timeline.noveltyAnalysis', status: 'ready' }
  if (value === 'report.generated') return { category: 'report', titleKey: 'timeline.reportGenerated', status: 'valid' }
  if (value === 'human_feedback.created') return { category: 'feedback', titleKey: 'timeline.feedbackCreated', status: 'open' }
  if (value === 'human_feedback.proposal_created') return { category: 'feedback', titleKey: 'timeline.feedbackProposalCreated', status: 'proposal_created' }
  if (value.startsWith('human_feedback.')) return { category: 'feedback', titleKey: 'timeline.feedbackDecided', status: value.split('.')[1] || 'open' }
  if (value.startsWith('claim_review.')) {
    if (value === 'claim_review.created') return { category: 'evidence', titleKey: 'timeline.claimReviewCreated', status: 'pending' }
    return { category: 'evidence', titleKey: 'timeline.claimReviewDecided', status: value.split('.')[1] || 'pending' }
  }
  if (value.startsWith('evidence.')) return { category: 'evidence', titleKey: 'timeline.evidenceIngested', status: 'valid' }
  if (value.startsWith('memory.')) return { category: 'memory', titleKey: value.includes('revok') ? 'timeline.memoryRevoked' : 'timeline.memoryIngested', status: value.includes('revok') ? 'revoked' : 'active' }
  if (value.startsWith('paper.') || value.startsWith('latex_compile.')) return { category: 'paper', titleKey: value.startsWith('paper.') ? 'timeline.paperUpdated' : 'timeline.paperCompileProposed', status: 'pending' }
  if (value.startsWith('research_status.')) return { category: 'comparison', titleKey: 'timeline.researchStatusUpdated', status: value.split('.').pop() || 'pending' }
  if (value.startsWith('research_comparison.')) return { category: 'comparison', titleKey: value.includes('candidate') ? 'timeline.comparisonCandidateDecided' : 'timeline.comparisonCreated', status: value.split('.').pop() || 'pending' }
  if (value === 'lineage.invalidated') return { category: 'invalidation', titleKey: 'timeline.lineageInvalidated', status: 'invalidated' }
  if (value === 'change.proposed') return { category: 'proposal', titleKey: 'timeline.proposalCreated', status: 'pending' }
  if (value === 'workflow.triggered') return { category: 'system', titleKey: 'timeline.workflowTriggered', status: detailStatus || 'succeeded' }
  return { category: 'system', titleKey: 'timeline.systemEvent', status: detailStatus }
}

function auditEventDetail(event: AuditEvent, t: Translate): string {
  const details = event.details || {}
  const parts: string[] = []
  if (typeof details.reason === 'string' && details.reason.trim()) parts.push(cleanText(details.reason, 160))
  if (typeof details.kind === 'string' && details.kind.trim()) parts.push(details.kind)
  if (typeof details.experiment_type === 'string' && details.experiment_type.trim()) parts.push(details.experiment_type)
  if (typeof details.run_id === 'string') parts.push(t('overview.runDetail', { run: shortId(details.run_id) }))
  if (typeof details.proposal_id === 'string') parts.push(t('timeline.proposalId', { id: shortId(details.proposal_id) }))
  if (typeof details.report_id === 'string') parts.push(t('timeline.reportId', { id: shortId(details.report_id) }))
  if (typeof details.period === 'string') parts.push(details.period === 'daily' ? t('reports.daily') : details.period === 'weekly' ? t('reports.weekly') : details.period)
  if (typeof details.query === 'string' && details.query.trim()) parts.push(cleanText(details.query))
  if (typeof details.provider === 'string') parts.push(details.provider)
  if (typeof details.commit === 'string') parts.push(shortId(details.commit))
  if (typeof details.status === 'string' && !['succeeded', 'failed'].includes(details.status) && details.status.trim()) parts.push(details.status)
  return parts.length ? parts.join(' · ') : t('timeline.eventDetailFallback')
}

function auditEntityKey(event: AuditEvent): string | null {
  const details = event.details || {}
  if (typeof details.proposal_id === 'string') return `proposal:${details.proposal_id}`
  if (event.action.startsWith('report.') && typeof details.report_id === 'string') return `report:${details.report_id}`
  if (event.action.startsWith('human_feedback.') && typeof details.feedback_id === 'string') return `feedback:${details.feedback_id}`
  if (typeof details.reproduction_run_id === 'string') return `reproduction_run:${details.reproduction_run_id}`
  if (typeof details.reproduction_id === 'string') return `reproduction:${details.reproduction_id}`
  if (event.action.startsWith('related_work.recursive') && typeof details.run_id === 'string') return `related_run:${details.run_id}`
  return null
}

function artifactGroupKey(artifact: Artifact): string {
  const lineage = artifact.metadata?.lineage as Record<string, unknown> | undefined
  if (typeof lineage?.run_id === 'string' && lineage.run_id.trim()) return lineage.run_id
  if (typeof artifact.run_id === 'string' && artifact.run_id.trim()) return artifact.run_id
  if (artifact.experiment_id) return artifact.experiment_id
  return artifact.id
}

function artifactTimelineItems(artifacts: Artifact[], t: Translate): TimelineDraft[] {
  const groups = new Map<string, { id: string; at?: string; count: number; names: string[]; valid: boolean }>()
  for (const artifact of artifacts) {
    const key = artifactGroupKey(artifact)
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.valid = existing.valid && artifact.valid !== false
      if (existing.names.length < 3 && !existing.names.includes(artifact.name)) existing.names.push(artifact.name)
      if (!existing.at && artifact.created_at) existing.at = artifact.created_at
    } else {
      groups.set(key, { id: `artifact-${key}`, at: artifact.created_at, count: 1, names: [artifact.name], valid: artifact.valid !== false })
    }
  }
  return Array.from(groups.values()).map(group => {
    const detail = [group.names.join('、'), group.count > group.names.length ? t('timeline.artifactCount', { count: group.count }) : ''].filter(Boolean).join(' · ')
    return { id: group.id, at: group.at, category: 'artifact', titleKey: 'timeline.artifactCreated', detail, status: group.valid ? 'valid' : 'invalidated' }
  })
}

function failedTaskTimelineItems(tasks: ProjectTask[]): TimelineDraft[] {
  return tasks
    .filter(task => ['failed', 'timed_out', 'rate_limited'].includes(String(task.status).toLowerCase()))
    .map(task => ({
      id: `task-${task.id}`,
      at: task.updated_at || task.created_at,
      category: 'failure',
      titleKey: 'timeline.taskFailed',
      detail: [task.kind, task.error ? cleanText(task.error, 160) : ''].filter(Boolean).join(' · '),
      status: task.status,
    }))
}

function reportTimelineItem(report: Report, t: Translate): TimelineDraft {
  const period = report.period === 'daily' ? t('reports.daily') : report.period === 'weekly' ? t('reports.weekly') : report.period
  return { id: `report-${report.id}`, at: report.created_at, category: 'report', titleKey: 'timeline.reportGenerated', detail: period, status: report.status || 'valid' }
}

function feedbackTimelineItem(feedback: HumanFeedback, t: Translate): TimelineDraft {
  const decided = Boolean(feedback.decided_at) || feedback.status !== 'open'
  return {
    id: `feedback-${feedback.id}`,
    at: feedback.decided_at || feedback.created_at,
    category: 'feedback',
    titleKey: decided ? 'timeline.feedbackDecided' : 'timeline.feedbackCreated',
    detail: cleanText(feedback.instruction, 160),
    status: feedback.status,
  }
}

function checkpointTimelineItem(checkpoint: Checkpoint, t: Translate): TimelineDraft {
  const invalidated = checkpoint.valid === false
  return {
    id: `checkpoint-${checkpoint.id}`,
    at: invalidated ? checkpoint.invalidated_at || checkpoint.created_at : checkpoint.created_at,
    category: invalidated ? 'invalidation' : 'checkpoint',
    titleKey: invalidated ? 'timeline.checkpointInvalidated' : 'timeline.checkpointRecorded',
    detail: `${checkpoint.stage} · ${t('overview.checkpointVersion', { version: checkpoint.idea_version ?? 1 })}`,
    status: invalidated ? 'invalidated' : 'recorded',
  }
}

function relatedWorkRunTimelineItem(run: RelatedWorkRun, t: Translate): TimelineDraft {
  const status = String(run.status || '').toLowerCase()
  const failed = status === 'failed'
  const cancelled = status.includes('cancel')
  return {
    id: `related-run-${run.id}`,
    at: run.finished_at || run.started_at || run.created_at,
    category: failed ? 'failure' : cancelled ? 'cancel' : 'search',
    titleKey: failed ? 'timeline.relatedWorkFailed' : cancelled ? 'timeline.relatedWorkCancelled' : status === 'succeeded' || status === 'completed' ? 'timeline.relatedWorkSucceeded' : 'timeline.relatedWorkStarted',
    detail: [run.providers?.join(' + '), run.depth ? t('timeline.depth', { depth: run.depth }) : ''].filter(Boolean).join(' · '),
    status: run.status,
  }
}

function reproductionRunTimelineItem(run: ReproductionRun): TimelineDraft {
  const status = String(run.status || '').toLowerCase()
  const failed = status === 'failed' || status === 'artifact_rejected'
  return {
    id: `reproduction-run-${run.id}`,
    at: run.finished_at || run.started_at || run.created_at,
    category: failed ? 'failure' : 'reproduction',
    titleKey: failed ? 'timeline.reproductionFailed' : status === 'awaiting_artifact_approval' ? 'timeline.reproductionSucceeded' : 'timeline.reproductionStarted',
    detail: run.entrypoint || run.source_commit || run.id,
    status: run.status,
  }
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
  const auditEvents = project.audit_events || []
  const auditKeys = new Set<string>()
  for (const event of auditEvents) {
    const key = auditEntityKey(event)
    if (key) auditKeys.add(key)
  }
  const timeline = [
    ...auditEvents
      .filter(event => !TIMELINE_IGNORED_AUDIT_ACTIONS.has(event.action))
      .map(event => {
        const meta = auditEventMeta(event.action, event.details)
        return { id: `audit-${event.id}`, at: event.created_at, category: meta.category, titleKey: meta.titleKey, detail: auditEventDetail(event, t), status: meta.status }
      }),
    ...artifactTimelineItems(project.artifacts || [], t),
    ...failedTaskTimelineItems(project.tasks || []),
    ...(project.reports || []).filter(report => !auditKeys.has(`report:${report.id}`)).map(report => reportTimelineItem(report, t)),
    ...(project.feedback || []).filter(item => !auditKeys.has(`feedback:${item.id}`)).map(item => feedbackTimelineItem(item, t)),
    ...(project.related_work_runs || []).filter(run => !auditKeys.has(`related_run:${run.id}`)).map(run => relatedWorkRunTimelineItem(run, t)),
    ...(project.reproduction_runs || []).filter(run => !auditKeys.has(`reproduction_run:${run.id}`)).map(run => reproductionRunTimelineItem(run)),
    ...checkpoints.filter(checkpoint => !checkpoint.stage?.startsWith('project_')).map(checkpoint => checkpointTimelineItem(checkpoint, t)),
  ]
    .filter(item => item.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 14)

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
        <div className="metric">
          <span className="metric-icon metric-icon-blue"><BookOpen size={17} aria-hidden="true" /></span>
          <div className="metric-copy"><span>{t('overview.papers')}</span><strong>{counts.papers ?? 0}</strong></div>
        </div>
        <div className="metric">
          <span className="metric-icon metric-icon-green"><FlaskConical size={17} aria-hidden="true" /></span>
          <div className="metric-copy"><span>{t('overview.experiments')}</span><strong>{counts.experiments ?? 0}</strong></div>
        </div>
        <div className="metric">
          <span className="metric-icon metric-icon-amber"><Archive size={17} aria-hidden="true" /></span>
          <div className="metric-copy"><span>{t('overview.artifacts')}</span><strong>{counts.artifacts ?? 0}</strong></div>
        </div>
        <div className="metric">
          <span className="metric-icon metric-icon-indigo"><ClipboardCheck size={17} aria-hidden="true" /></span>
          <div className="metric-copy"><span>{t('common.pendingApproval')}</span><strong>{pendingCount}</strong></div>
        </div>
      </div>

      <WorkflowGraphCard projectId={project.id} />

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
              <div className={`timeline-item timeline-category-${item.category}`} role="listitem" key={item.id}>
                <span className="timeline-dot" aria-hidden="true" />
                <div><strong>{t(item.titleKey)}</strong><p>{item.detail} · {formatDateTime(item.at, locale)}</p></div>
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
