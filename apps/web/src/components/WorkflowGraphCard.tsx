import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, ExternalLink, GitBranch, Loader2, ShieldCheck, Waypoints } from 'lucide-react'
import { api, errorMessage } from '../api'
import { formatDateTime, useTranslation, type TranslationKey } from '../i18n'
import type { WorkflowGraphEntry, WorkflowGraphResponse, WorkflowRunRecord } from '../types'
import { EmptyState, SectionHeading } from './ui'

const STEP_LABEL_KEYS: Record<string, TranslationKey> = {
  'run-project-chat-agent': 'workflowGraph.step.chat',
  'project-conversation': 'workflowGraph.step.chat',
  'research-bootstrap': 'workflowGraph.step.relatedWork',
  'literature-review': 'workflowGraph.step.literatureReview',
  'literature-search': 'workflowGraph.step.literatureSearch',
  'literature-novelty-review': 'workflowGraph.step.literatureNoveltyReview',
  'research-phase-context': 'workflowGraph.step.phaseContext',
  'research-lifecycle': 'workflowGraph.step.lifecycle',
  'research-lifecycle-entry': 'workflowGraph.step.lifecycleEntry',
  'research-lifecycle-exit': 'workflowGraph.step.lifecycleExit',
  'literature-phase': 'workflowGraph.step.literaturePhase',
  'literature-phase-output': 'workflowGraph.step.literaturePhaseOutput',
  'method-and-experiment-phase': 'workflowGraph.step.methodExperimentPhase',
  'method-and-experiment-phase-output': 'workflowGraph.step.methodExperimentPhaseOutput',
  'paper-writing-phase': 'workflowGraph.step.paperWritingPhase',
  'paper-writing-phase-output': 'workflowGraph.step.paperWritingPhaseOutput',
  'reporting-phase': 'workflowGraph.step.reportingPhase',
  'reporting-phase-output': 'workflowGraph.step.reportingPhaseOutput',
  'approval-phase': 'workflowGraph.step.approvalPhase',
  'approval-phase-output': 'workflowGraph.step.approvalPhaseOutput',
  'workflow-edit-phase': 'workflowGraph.step.workflowEditPhase',
  'workflow-edit-phase-output': 'workflowGraph.step.workflowEditPhaseOutput',
  'conversation-phase': 'workflowGraph.step.conversationPhase',
  'conversation-phase-output': 'workflowGraph.step.conversationPhaseOutput',
  'human-approval': 'workflowGraph.step.approval',
  'generate-project-reports': 'workflowGraph.step.reports',
  'reporting-and-feedback': 'workflowGraph.step.reports',
  'paper-translate': 'workflowGraph.step.paperTranslate',
  'paper-revise': 'workflowGraph.step.paperRevise',
  'create-experiment-plan': 'workflowGraph.step.experimentPlan',
  'method-design-and-experiment-planning': 'workflowGraph.step.methodExperimentPlanning',
  'workflow-edit-proposal': 'workflowGraph.step.workflowEdit',
  'paper-introduction': 'workflowGraph.step.paperIntroduction',
  'paper-related-work': 'workflowGraph.step.paperRelatedWork',
  'paper-method': 'workflowGraph.step.paperMethod',
  'paper-experiments': 'workflowGraph.step.paperExperiments',
  'paper-conclusion': 'workflowGraph.step.paperConclusion',
}

const RUN_STATUS_KEYS: Record<WorkflowRunRecord['status'], TranslationKey> = {
  running: 'workflowGraph.statusRunning',
  suspended: 'workflowGraph.statusSuspended',
  success: 'workflowGraph.statusSuccess',
  failed: 'workflowGraph.statusFailed',
}

function stepLabel(stepId: string, t: (key: TranslationKey) => string): string {
  const key = STEP_LABEL_KEYS[stepId]
  if (key) return t(key)
  return stepId.replaceAll('-', ' ')
}

function GraphNode({ entry, t }: { entry: WorkflowGraphEntry; t: (key: TranslationKey) => string }) {
  if (entry.type === 'conditional' || entry.type === 'parallel' || (entry.type !== 'step' && entry.steps?.length)) {
    return (
      <div className="workflow-graph-branch">
        <div className="workflow-graph-branch-label">
          <GitBranch size={13} />
          {entry.type === 'parallel' ? entry.type : t('workflowGraph.branch')}
        </div>
        <div className="workflow-graph-branch-body">
          {(entry.steps || []).map((child, index) => <GraphNode key={`${entry.type}-${index}`} entry={child} t={t} />)}
        </div>
      </div>
    )
  }
  const stepId = entry.step?.id || 'unknown-step'
  if (entry.type === 'step' && entry.step?.component === 'WORKFLOW' && entry.step.serializedStepFlow?.length) {
    return (
      <div className="workflow-graph-branch workflow-graph-nested">
        <div className="workflow-graph-branch-label">
          <GitBranch size={13} />
          {stepLabel(stepId, t)}
        </div>
        <div className="workflow-graph-branch-body">
          {entry.step.serializedStepFlow.map((child, index) => <GraphNode key={`${stepId}-${index}`} entry={child} t={t} />)}
        </div>
      </div>
    )
  }
  const isEntry = stepId === 'workflow-entry'
  const isExit = stepId === 'workflow-exit'
  const isMap = Boolean(entry.step?.mapConfig)
  return (
    <div className={`workflow-graph-node${isEntry ? ' is-entry' : ''}${isExit ? ' is-exit' : ''}`}>
      <div className="workflow-graph-node-icon">
        {isEntry || isExit ? <Waypoints size={15} /> : <Activity size={15} />}
      </div>
      <div className="workflow-graph-node-copy">
        <strong>{isEntry ? t('workflowGraph.entry') : isExit ? t('workflowGraph.exit') : stepLabel(stepId, t)}</strong>
        <code>{stepId}</code>
      </div>
      <div className="workflow-graph-node-meta">
        {isMap ? <span className="workflow-graph-tag">{t('workflowGraph.map')}</span> : null}
        {entry.step?.canSuspend ? <span className="workflow-graph-tag suspend">{t('workflowGraph.suspend')}</span> : null}
      </div>
    </div>
  )
}

export function WorkflowGraphCard({ projectId }: { projectId: string }) {
  const { t, locale } = useTranslation()
  const [graph, setGraph] = useState<WorkflowGraphResponse | null>(null)
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [graphResult, runsResult] = await Promise.all([
          api<WorkflowGraphResponse>(`/api/projects/${projectId}/workflow-graph`),
          api<{ runs: WorkflowRunRecord[] }>(`/api/projects/${projectId}/workflow-runs`),
        ])
        if (cancelled) return
        setGraph(graphResult)
        setRuns(runsResult.runs || [])
        setError('')
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [projectId])

  const statusKey = graph?.status === 'active'
    ? 'workflowGraph.active'
    : graph?.status === 'missing'
      ? 'workflowGraph.missing'
      : 'workflowGraph.error'

  return (
    <div className="section workflow-graph-section">
      <SectionHeading
        title={t('workflowGraph.title')}
        hint={t('workflowGraph.hint')}
        extra={
          <a className="secondary workflow-graph-studio" href="/api/mastra/open" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t('workflowGraph.openStudio')}
          </a>
        }
      />
      {loading ? (
        <div className="workflow-graph-loading"><Loader2 className="spin" size={18} />{t('workflowGraph.loading')}</div>
      ) : error ? (
        <div className="workflow-graph-error"><AlertTriangle size={16} />{t('workflowGraph.requestFailed', { error })}</div>
      ) : !graph || graph.graph.length === 0 ? (
        <EmptyState text={t('workflowGraph.empty')} />
      ) : (
        <>
          <div className="workflow-graph-meta">
            <span className="workflow-graph-status"><ShieldCheck size={14} />{t(statusKey)}</span>
            <span>{t('workflowGraph.version', { version: graph.version })}</span>
            <span>{t('workflowGraph.sourceHash', { hash: graph.source_hash.slice(0, 10) })}</span>
            {graph.last_error ? <span className="workflow-graph-error-text">{t('workflowGraph.lastError', { error: graph.last_error })}</span> : null}
          </div>
          <div className="workflow-graph-canvas">
            <div className="workflow-graph-flow">
              {graph.graph.map((entry, index) => <GraphNode key={index} entry={entry} t={t} />)}
            </div>
          </div>
          <div className="workflow-graph-runs">
            <h3>{t('workflowGraph.recentRuns')}</h3>
            {runs.length ? (
              <div className="data-list">
                {runs.slice(0, 5).map(run => (
                  <div className="data-row" key={run.mastra_run_id}>
                    <div>
                      <h4>{t('workflowGraph.runId', { id: run.mastra_run_id.slice(0, 8) })}</h4>
                      <p>{t('workflowGraph.version', { version: run.workflow_version })} · {formatDateTime(run.created_at, locale)}</p>
                    </div>
                    <span className={`badge ${run.status === 'success' ? 'live' : run.status === 'failed' ? 'failed' : 'pending'}`}>
                      {t(RUN_STATUS_KEYS[run.status])}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="empty-inline">{t('workflowGraph.runsEmpty')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
