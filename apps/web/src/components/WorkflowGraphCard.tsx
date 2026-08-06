import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  GitBranch,
  List,
  Loader2,
  Play,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react'
import { api, errorMessage } from '../api'
import { formatDateTime, useTranslation, type TranslationKey } from '../i18n'
import type {
  WorkflowEventRun,
  WorkflowGraphNode,
  WorkflowGraphSnapshot,
  WorkflowNodeRun,
  WorkflowRuntimeStatus,
} from '../types'
import { EmptyState, SectionHeading, statusLabel } from './ui'

type Filter = 'all' | 'succeeded' | 'running' | 'failed' | 'blocked'

const FILTER_KEYS: Record<Filter, TranslationKey> = {
  all: 'workflowGraph.filterAll',
  succeeded: 'workflowGraph.filterSucceeded',
  running: 'workflowGraph.filterRunning',
  failed: 'workflowGraph.filterFailed',
  blocked: 'workflowGraph.filterBlocked',
}

const RUNTIME_STATUS_KEYS: Record<WorkflowRuntimeStatus, TranslationKey> = {
  waiting: 'workflowGraph.runtimeWaiting',
  dispatching: 'workflowGraph.runtimeDispatching',
  blocked: 'workflowGraph.runtimeBlocked',
  failed: 'workflowGraph.runtimeFailed',
  paused: 'workflowGraph.runtimePaused',
}

function labelFromKey(key: string | undefined, fallback: string, t: (key: TranslationKey) => string): string {
  if (!key) return fallback
  return t(key as TranslationKey)
}

function latestNodeRun(nodeId: string, runs: WorkflowNodeRun[]): WorkflowNodeRun | null {
  return runs.find(run => run.node_id === nodeId) ?? null
}

function summary(value: Record<string, unknown> | null): string {
  if (!value) return ''
  return JSON.stringify(value, null, 2).slice(0, 900)
}

function NodeDetail({
  node,
  run,
  snapshot,
  onClose,
  t,
  locale,
}: {
  node: WorkflowGraphNode
  run: WorkflowNodeRun | null
  snapshot: WorkflowGraphSnapshot
  onClose: () => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  locale: ReturnType<typeof useTranslation>['locale']
}) {
  const history = snapshot.node_runs.filter(candidate => candidate.node_id === node.id).slice(0, 6)
  return (
    <div className="workflow-graph-node-detail" role="region" aria-label={labelFromKey(node.label_key, node.id, t)}>
      <div className="workflow-graph-detail-head">
        <strong>{labelFromKey(node.label_key, node.id, t)}</strong>
        <button className="icon-btn" type="button" aria-label={t('common.close')} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p>{labelFromKey(node.description_key, t('workflowGraph.noDescription'), t)}</p>
      <div className="workflow-graph-detail-meta">
        <span><code>{node.id}</code></span>
        <span>{t('workflowGraph.capability', { capability: node.capability })}</span>
        <span>{t('workflowGraph.concurrency', { concurrency: node.concurrency })}</span>
        <span>{t('workflowGraph.timeout', { seconds: node.timeout_seconds })}</span>
      </div>
      {node.requires.length ? (
        <div className="workflow-graph-requires">
          <span>{t('workflowGraph.requires')}</span>
          {node.requires.map(requirement => <code key={requirement}>{requirement}</code>)}
        </div>
      ) : null}
      {run ? (
        <div className={`workflow-graph-detail-status ${badgeKindClass(run.status)}`}>
          <span>{statusLabel(run.status, t)}</span>
          {run.attempt > 0 ? <span>{t('workflowGraph.attempt', { attempt: run.attempt })}</span> : null}
          {run.blocked_reason ? <span>{t('workflowGraph.blockedReason', { reason: run.blocked_reason })}</span> : null}
          {run.error_code ? <span>{t('workflowGraph.errorCode', { error: run.error_code })}</span> : null}
          {run.started_at ? <span>{t('workflowGraph.startedAt', { time: formatDateTime(run.started_at, locale) })}</span> : null}
          {run.finished_at ? <span>{t('workflowGraph.finishedAt', { time: formatDateTime(run.finished_at, locale) })}</span> : null}
        </div>
      ) : <p className="empty-inline">{t('workflowGraph.nodeNotRun')}</p>}
      {run?.input_ref && Object.keys(run.input_ref).length ? (
        <details className="workflow-graph-json">
          <summary>{t('workflowGraph.inputRef')}</summary>
          <pre>{summary(run.input_ref)}</pre>
        </details>
      ) : null}
      {run?.output_ref && Object.keys(run.output_ref).length ? (
        <details className="workflow-graph-json">
          <summary>{t('workflowGraph.outputRef')}</summary>
          <pre>{summary(run.output_ref)}</pre>
        </details>
      ) : null}
      {history.length > 1 ? (
        <div className="workflow-graph-history">
          <h4>{t('workflowGraph.nodeHistory')}</h4>
          {history.map((item, index) => (
            <div className="data-row" key={`${item.id}-${index}`}>
              <div>
                <h4>{statusLabel(item.status, t)}</h4>
                <p>{t('workflowGraph.version', { version: item.definition_version })} · {formatDateTime(item.updated_at ?? item.created_at ?? item.started_at ?? '', locale)}</p>
              </div>
              <span className={`badge ${badgeKindClass(item.status)}`}>{statusLabel(item.status, t)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function badgeKindClass(status: string): string {
  if (['succeeded', 'running', 'waiting_approval'].includes(status)) return 'live'
  if (['failed', 'blocked', 'cancelled'].includes(status)) return 'failed'
  return 'pending'
}

export function WorkflowGraphCard({ projectId }: { projectId: string }) {
  const { t, locale } = useTranslation()
  const [snapshot, setSnapshot] = useState<WorkflowGraphSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let fallbackTimer: number | undefined
    let source: EventSource | null = null
    const applySnapshot = (next: WorkflowGraphSnapshot) => {
      if (cancelled) return
      setSnapshot(next)
      setError('')
      setLoading(false)
    }
    const load = async () => {
      try {
        applySnapshot(await api<WorkflowGraphSnapshot>(`/api/projects/${projectId}/workflow/graph`))
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    if (typeof EventSource === 'function') {
      source = new EventSource(`/api/projects/${projectId}/workflow/stream`)
      source.addEventListener('snapshot', event => {
        try {
          applySnapshot(JSON.parse((event as MessageEvent).data) as WorkflowGraphSnapshot)
        } catch {
          setError(t('workflowGraph.streamParseFailed'))
        }
      })
      source.onerror = () => {
        source?.close()
        if (!cancelled && fallbackTimer === undefined) {
          fallbackTimer = window.setInterval(() => void load(), 5000)
        }
      }
    }
    return () => {
      cancelled = true
      source?.close()
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer)
    }
  }, [projectId])

  const groupedNodes = useMemo(() => {
    if (!snapshot) return []
    return snapshot.groups.map(group => ({
      group,
      nodes: snapshot.nodes.filter(node => node.group === group.id),
    }))
  }, [snapshot])

  if (loading && !snapshot) {
    return (
      <div className="section workflow-graph-section">
        <SectionHeading title={t('workflowGraph.title')} hint={t('workflowGraph.hint')} />
        <div className="workflow-graph-loading"><Loader2 className="spin" size={18} />{t('workflowGraph.loading')}</div>
      </div>
    )
  }

  if (error && !snapshot) {
    return (
      <div className="section workflow-graph-section">
        <SectionHeading title={t('workflowGraph.title')} hint={t('workflowGraph.hint')} />
        <div className="workflow-graph-error"><AlertTriangle size={16} />{t('workflowGraph.requestFailed', { error })}</div>
      </div>
    )
  }

  if (!snapshot || snapshot.definition_version < 1 || snapshot.groups.length === 0) {
    return (
      <div className="section workflow-graph-section">
        <SectionHeading title={t('workflowGraph.title')} hint={t('workflowGraph.hint')} />
        <EmptyState text={snapshot?.last_error ? t('workflowGraph.lastError', { error: snapshot.last_error }) : t('workflowGraph.empty')} />
      </div>
    )
  }

  const statusKey = RUNTIME_STATUS_KEYS[snapshot.status] ?? 'workflowGraph.runtimeUnknown'
  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }
  const toggleAll = () => {
    setCollapsedGroups(current => current.size === 0 ? new Set(snapshot.groups.map(group => group.id)) : new Set())
  }
  const matchesFilter = (node: WorkflowGraphNode) => {
    if (filter === 'all') return true
    const run = latestNodeRun(node.id, snapshot.node_runs)
    return run?.status === filter
  }
  const jumpToNode = (event: WorkflowEventRun) => {
    const target = snapshot.node_runs.find(run => run.correlation_id === event.correlation_id)
    if (!target) return
    const node = snapshot.nodes.find(candidate => candidate.id === target.node_id)
    setFilter('all')
    setCollapsedGroups(current => {
      if (!node) return current
      const next = new Set(current)
      next.delete(node.group)
      return next
    })
    setSelectedNodeId(target.node_id)
    setTimeout(() => {
      const row = document.querySelector(`[data-node-id="${target.node_id}"]`)
      row?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      })
    }, 80)
  }

  return (
    <div className="section workflow-graph-section">
      <SectionHeading
        title={t('workflowGraph.title')}
        hint={t('workflowGraph.hint')}
        extra={
          <button className="secondary workflow-graph-collapse" type="button" onClick={toggleAll}>
            <GitBranch size={14} />
            {collapsedGroups.size ? t('workflowGraph.expandAll') : t('workflowGraph.collapseAll')}
          </button>
        }
      />
      <div className="workflow-graph-meta">
        <span className="workflow-graph-status"><ShieldCheck size={14} />{t(statusKey)}</span>
        <span>{t('workflowGraph.version', { version: snapshot.definition_version })}</span>
        <span>{t('workflowGraph.sourceHash', { hash: snapshot.source_hash.slice(0, 10) })}</span>
        {snapshot.git_commit ? <span>{t('workflowGraph.gitCommit', { commit: snapshot.git_commit.slice(0, 10) })}</span> : null}
        <span>{t('workflowGraph.updated', { time: formatDateTime(snapshot.runtime.updated_at, locale) })}</span>
        {snapshot.last_error ? <span className="workflow-graph-error-text">{t('workflowGraph.lastError', { error: snapshot.last_error })}</span> : null}
      </div>
      <div className="workflow-graph-toolbar" role="group" aria-label={t('workflowGraph.filterLabel')}>
        {(Object.keys(FILTER_KEYS) as Filter[]).map(item => (
          <button
            className={`workflow-graph-filter${filter === item ? ' active' : ''}`}
            type="button"
            key={item}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item === 'all' ? <List size={13} /> : item === 'running' ? <Play size={13} /> : item === 'failed' ? <AlertTriangle size={13} /> : item === 'blocked' ? <Circle size={13} /> : <CheckCircle2 size={13} />}
            {t(FILTER_KEYS[item])}
          </button>
        ))}
      </div>
      <div className="workflow-graph-canvas">
        <div className="workflow-graph-groups">
          {groupedNodes.map(({ group, nodes }) => {
            const visible = nodes.filter(matchesFilter)
            const collapsed = collapsedGroups.has(group.id)
            const groupRuns = nodes.map(node => latestNodeRun(node.id, snapshot.node_runs)).filter(Boolean)
            const summaryCounts = {
              running: groupRuns.filter(run => run?.status === 'running').length,
              failed: groupRuns.filter(run => run?.status === 'failed' || run?.status === 'blocked').length,
              succeeded: groupRuns.filter(run => run?.status === 'succeeded').length,
            }
            return (
              <section className="workflow-graph-group" key={group.id}>
                <button
                  className="workflow-graph-group-head"
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group.id)}
                >
                  {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <span>
                    <strong>{labelFromKey(group.label_key, group.id, t)}</strong>
                    {group.description_key ? <small>{labelFromKey(group.description_key, '', t)}</small> : null}
                  </span>
                  <span className="workflow-graph-group-counts">
                    <span className="live" title={t('workflowGraph.runningCount', { count: summaryCounts.running })} aria-label={t('workflowGraph.runningCount', { count: summaryCounts.running })}>{summaryCounts.running}</span>
                    <span className="ok" title={t('workflowGraph.succeededCount', { count: summaryCounts.succeeded })} aria-label={t('workflowGraph.succeededCount', { count: summaryCounts.succeeded })}>{summaryCounts.succeeded}</span>
                    <span className="failed" title={t('workflowGraph.failedCount', { count: summaryCounts.failed })} aria-label={t('workflowGraph.failedCount', { count: summaryCounts.failed })}>{summaryCounts.failed}</span>
                  </span>
                </button>
                {!collapsed ? (
                  <div className="workflow-graph-group-body">
                    {visible.length ? visible.map(node => {
                      const run = latestNodeRun(node.id, snapshot.node_runs)
                      const selected = selectedNodeId === node.id
                      return (
                        <div className="workflow-graph-node-wrap" key={node.id}>
                          <button
                            className={`workflow-graph-node${run ? ` status-${run.status}` : ''}${selected ? ' is-selected' : ''}`}
                            type="button"
                            data-node-id={node.id}
                            aria-expanded={selected}
                            onClick={() => setSelectedNodeId(selected ? null : node.id)}
                          >
                            <span className="workflow-graph-node-icon">
                              {run?.status === 'running' ? <Activity size={15} /> : run?.status === 'succeeded' ? <CheckCircle2 size={15} /> : run?.status === 'failed' || run?.status === 'blocked' ? <AlertTriangle size={15} /> : <Zap size={15} />}
                            </span>
                            <span className="workflow-graph-node-copy">
                              <strong>{labelFromKey(node.label_key, node.id, t)}</strong>
                              <code>{node.id}</code>
                            </span>
                            <span className="workflow-graph-node-meta">
                              {run ? <span className={`badge ${badgeKindClass(run.status)}`}>{statusLabel(run.status, t)}</span> : <span className="badge neutral">{t('workflowGraph.notRun')}</span>}
                              {run?.attempt ? <span className="workflow-graph-tag">{t('workflowGraph.attempt', { attempt: run.attempt })}</span> : null}
                              {run?.blocked_reason && run.status !== 'blocked' ? <span className="workflow-graph-tag failed">{t('workflowGraph.blocked')}</span> : null}
                            </span>
                          </button>
                          {selected ? (
                            <NodeDetail
                              node={node}
                              run={run}
                              snapshot={snapshot}
                              onClose={() => setSelectedNodeId(null)}
                              t={t}
                              locale={locale}
                            />
                          ) : null}
                        </div>
                      )
                    }) : <p className="empty-inline">{t('workflowGraph.filterEmpty')}</p>}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
        {snapshot.edges.length ? (
          <div className="workflow-graph-edge-list">
            <h3><GitBranch size={14} />{t('workflowGraph.edges')}</h3>
            {snapshot.edges.map(edge => (
              <div className="workflow-graph-edge" key={`${edge.from}-${edge.to}`}>
                <code>{edge.from}</code>
                <span>{t('workflowGraph.edgeCondition', { condition: edge.condition })}</span>
                <code>{edge.to}</code>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="workflow-graph-lists">
        <div className="workflow-graph-list">
          <h3><Clock3 size={14} />{t('workflowGraph.eventTimeline')}</h3>
          {snapshot.events.length ? (
            <div className="data-list">
              {snapshot.events.slice(0, 16).map(event => {
                const eventNodeId = snapshot.node_runs.find(run => run.correlation_id === event.correlation_id)?.node_id ?? ''
                return (
                  <button
                    className="data-row workflow-graph-event-row"
                    type="button"
                    key={event.sequence}
                    data-node-id={eventNodeId}
                    title={t('workflowGraph.jumpToNode')}
                    aria-label={t('workflowGraph.jumpToNode')}
                    onClick={() => jumpToNode(event)}
                  >
                    <div>
                      <h4><code>{event.sequence}</code> · {event.event_type}</h4>
                      <p>{t('workflowGraph.eventMeta', { source: event.source, version: event.definition_version, time: formatDateTime(event.created_at, locale) })}</p>
                    </div>
                    <span className="badge neutral">{event.correlation_id.slice(0, 10)}</span>
                  </button>
                )
              })}
            </div>
          ) : <p className="empty-inline">{t('workflowGraph.noEvents')}</p>}
        </div>
        <div className="workflow-graph-list">
          <h3><Activity size={14} />{t('workflowGraph.nodeRuns')}</h3>
          {snapshot.node_runs.length ? (
            <div className="data-list">
              {snapshot.node_runs.slice(0, 12).map(run => (
                <div className="data-row" key={run.id}>
                  <div>
                    <h4>{run.node_id}</h4>
                    <p>{t('workflowGraph.version', { version: run.definition_version })} · {formatDateTime(run.updated_at ?? run.created_at ?? run.started_at ?? '', locale)}</p>
                  </div>
                  <span className={`badge ${badgeKindClass(run.status)}`}>{statusLabel(run.status, t)}</span>
                </div>
              ))}
            </div>
          ) : <p className="empty-inline">{t('workflowGraph.noNodeRuns')}</p>}
        </div>
        <div className="workflow-graph-list">
          <h3><Zap size={14} />{t('workflowGraph.tasks')}</h3>
          {snapshot.tasks.length ? (
            <div className="data-list">
              {snapshot.tasks.slice(0, 12).map(task => (
                <div className="data-row" key={task.id}>
                  <div>
                    <h4>{task.node_id ?? task.id.slice(0, 8)}</h4>
                    <p>{task.worker_id ? t('workflowGraph.worker', { worker: task.worker_id }) : t('workflowGraph.unassigned')} · {formatDateTime(task.updated_at, locale)}</p>
                  </div>
                  <span className={`badge ${badgeKindClass(task.status)}`}>{statusLabel(task.status, t)}</span>
                </div>
              ))}
            </div>
          ) : <p className="empty-inline">{t('workflowGraph.noTasks')}</p>}
        </div>
      </div>
    </div>
  )
}
