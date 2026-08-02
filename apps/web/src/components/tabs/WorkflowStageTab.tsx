import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Network, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, ProjectWorkspaceDetail, ResearchStatusGraphEdge, ResearchStatusGraphNode, ResearchStatusResponse, TabId } from '../../types'
import { Badge, EmptyState, SectionHeading, statusLabel } from '../ui'
import { useTranslation, type TranslationKey } from '../../i18n'

function text(value: unknown, t: (key: TranslationKey) => string) {
  return typeof value === 'string' && value.trim() ? value : t('common.unrecorded')
}

const GRAPH_KINDS: ResearchStatusGraphNode['kind'][] = ['candidate', 'paper', 'evidence', 'claim_review']
const GRAPH_NODE_WIDTH = 224
const GRAPH_NODE_HEIGHT = 86
const GRAPH_COLUMN_GAP = 38
const GRAPH_COLUMN_PADDING = 24
const GRAPH_TOP = 58
const GRAPH_ROW_GAP = 18

const GRAPH_KIND_LABELS: Record<ResearchStatusGraphNode['kind'], TranslationKey> = {
  candidate: 'graph.kind.candidate',
  paper: 'graph.kind.paper',
  evidence: 'graph.kind.evidence',
  claim_review: 'graph.kind.claimReview',
}

const GRAPH_STATUS_LABELS: Record<string, TranslationKey> = {
  candidate: 'graph.status.candidate',
  confirmed: 'graph.status.confirmed',
  unconfirmed: 'graph.status.unconfirmed',
  located: 'graph.status.located',
  unlocated: 'graph.status.unlocated',
  pending: 'graph.status.pending',
  accepted: 'graph.status.accepted',
  rejected: 'graph.status.rejected',
}

const GRAPH_EVIDENCE_LABELS: Record<string, TranslationKey> = {
  metadata_only: 'graph.evidence.metadataOnly',
  page_quote: 'graph.evidence.pageQuote',
  claim_reviewed: 'graph.evidence.claimReviewed',
}

type PositionedGraphNode = ResearchStatusGraphNode & { x: number; y: number }

function graphLabel(value: string, t: (key: TranslationKey) => string, maxLength = 31) {
  const normalized = text(value, t)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function graphStatusLabel(status: string) {
  return GRAPH_STATUS_LABELS[status] || status || 'common.unrecorded'
}

function graphEvidenceLabel(status: string) {
  return GRAPH_EVIDENCE_LABELS[status] || status || 'common.unrecorded'
}

function layoutGraph(nodes: ResearchStatusGraphNode[]) {
  const grouped = new Map<ResearchStatusGraphNode['kind'], ResearchStatusGraphNode[]>()
  for (const kind of GRAPH_KINDS) grouped.set(kind, [])
  for (const node of nodes) grouped.get(node.kind)?.push(node)

  const positioned: PositionedGraphNode[] = []
  const columnWidth = GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP
  for (const [columnIndex, kind] of GRAPH_KINDS.entries()) {
    const columnNodes = (grouped.get(kind) || []).slice().sort((left, right) => {
      const labelOrder = left.label.localeCompare(right.label, 'zh-CN')
      return labelOrder || left.id.localeCompare(right.id)
    })
    for (const [rowIndex, node] of columnNodes.entries()) {
      positioned.push({
        ...node,
        x: GRAPH_COLUMN_PADDING + columnIndex * columnWidth,
        y: GRAPH_TOP + rowIndex * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
      })
    }
  }

  const maxRows = Math.max(1, ...GRAPH_KINDS.map(kind => grouped.get(kind)?.length || 0))
  return {
    nodes: positioned,
    width: GRAPH_COLUMN_PADDING * 2 + GRAPH_NODE_WIDTH * GRAPH_KINDS.length + GRAPH_COLUMN_GAP * (GRAPH_KINDS.length - 1),
    height: GRAPH_TOP + maxRows * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP) + 26,
  }
}

function graphEdgePath(edge: ResearchStatusGraphEdge, nodes: Map<string, PositionedGraphNode>) {
  const source = nodes.get(edge.source)
  const target = nodes.get(edge.target)
  if (!source || !target) return null

  const forward = target.x >= source.x
  const sourceX = forward ? source.x + GRAPH_NODE_WIDTH : source.x
  const targetX = forward ? target.x : target.x + GRAPH_NODE_WIDTH
  const sourceY = source.y + GRAPH_NODE_HEIGHT / 2
  const targetY = target.y + GRAPH_NODE_HEIGHT / 2
  const curve = Math.max(42, Math.abs(targetX - sourceX) * 0.42)
  const controlDirection = forward ? 1 : -1
  return `M ${sourceX} ${sourceY} C ${sourceX + curve * controlDirection} ${sourceY}, ${targetX - curve * controlDirection} ${targetY}, ${targetX} ${targetY}`
}

export function WorkflowStageTab({
  project,
  tab,
}: {
  project: ProjectDetail
  tab: TabId
}) {
  const { t } = useTranslation()
  const [workspace, setWorkspace] = useState<ProjectWorkspaceDetail | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [researchStatus, setResearchStatus] = useState<ResearchStatusResponse | null>(null)
  const [researchStatusError, setResearchStatusError] = useState<string | null>(null)
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null)

  const graphLayout = useMemo(() => layoutGraph(researchStatus?.graph.nodes || []), [researchStatus])
  const graphNodesById = useMemo(() => new Map(graphLayout.nodes.map(node => [node.id, node])), [graphLayout.nodes])
  const selectedGraphNode = selectedGraphNodeId ? graphNodesById.get(selectedGraphNodeId) || null : null

  useEffect(() => {
    if (tab === 'code_workspace') {
      setWorkspace(null)
      setWorkspaceError(null)
      api<ProjectWorkspaceDetail>(`/api/projects/${project.id}/workspace`)
        .then(setWorkspace)
        .catch(error => setWorkspaceError(errorMessage(error)))
    }
    if (tab === 'citation_graph') {
      setResearchStatus(null)
      setResearchStatusError(null)
      setSelectedGraphNodeId(null)
      api<ResearchStatusResponse>(`/api/projects/${project.id}/research-status`)
        .then(setResearchStatus)
        .catch(error => setResearchStatusError(errorMessage(error)))
    }
  }, [project.id, tab])

  if (tab === 'citation_graph') {
    return (
      <>
        <SectionHeading title={t('graph.title')} hint={t('graph.hint')} extra={<Badge>{t('graph.edgeCount', { count: researchStatus?.graph.edges.length || 0 })}</Badge>} />
        {researchStatusError ? <EmptyState text={t('graph.requestFailed', { error: researchStatusError })} /> : null}
        {!researchStatus && !researchStatusError ? <EmptyState text={t('graph.loading')} /> : null}
        {researchStatus ? (
          <>
            <div className="data-list">
              <div className="data-row"><div><h3>{t('graph.permissionScope')}</h3><p><code>{researchStatus.project_id}</code></p></div><Badge status={researchStatus.permission_status} /></div>
              <div className="data-row"><div><h3>{t('graph.state')}</h3><p>{researchStatus.graph_status === 'partial' ? t('graph.partial') : researchStatus.graph_status === 'empty' ? t('graph.empty') : t('graph.onlySaved')}</p></div><Badge status={researchStatus.graph_status} /></div>
              <div className="data-row"><div><h3>{t('graph.scale')}</h3><p>{t('graph.scaleText', { nodes: researchStatus.graph.nodes.length, edges: researchStatus.graph.edges.length })}</p></div><Network size={16} className="muted" /></div>
            </div>
            {researchStatus.graph_status === 'partial' ? <div className="research-graph-alert" role="status">{t('graph.alert')}</div> : null}
            {graphLayout.nodes.length ? (
              <div className="research-graph-panel">
                <div className="research-graph-legend" aria-label={t('graph.legendAria')}>
                  {GRAPH_KINDS.map(kind => <span className={`research-graph-legend-item kind-${kind}`} key={kind}><i aria-hidden="true" />{t(GRAPH_KIND_LABELS[kind])}</span>)}
                  <span className="research-graph-legend-note">{t('graph.legendNote')}</span>
                </div>
                <div className="research-graph-scroll">
                  <svg className="research-graph-svg" width={graphLayout.width} height={graphLayout.height} viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`} role="group" aria-label={t('graph.aria', { projectId: researchStatus.project_id })}>
                    <title>{t('graph.titleShort')}</title>
                    <defs>
                      <marker id="research-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                        <path d="M 0 0 L 8 4 L 0 8 z" />
                      </marker>
                    </defs>
                    <g className="research-graph-columns" aria-hidden="true">
                      {GRAPH_KINDS.map((kind, index) => <text key={kind} x={GRAPH_COLUMN_PADDING + index * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP)} y="27">{t(GRAPH_KIND_LABELS[kind])}</text>)}
                    </g>
                    <g className="research-graph-edges" aria-label={t('graph.edgesAria')}>
                      {researchStatus.graph.edges.map(edge => {
                        const path = graphEdgePath(edge, graphNodesById)
                        return path ? <path key={edge.id} d={path} className={`research-graph-edge evidence-${edge.evidence_status}`} markerEnd="url(#research-graph-arrow)" aria-label={`${edge.relation} · ${statusLabel(edge.evidence_status, t)} · ${statusLabel(edge.permission_status, t)}`} /> : null
                      })}
                    </g>
                    <g className="research-graph-nodes" aria-label={t('graph.nodesAria')}>
                      {graphLayout.nodes.map(node => {
                        const selected = selectedGraphNodeId === node.id
                        const selectNode = () => setSelectedGraphNodeId(node.id)
                        return (
                          <g
                            className={`research-graph-node-group kind-${node.kind}${selected ? ' selected' : ''}`}
                            key={node.id}
                            role="button"
                            tabIndex={0}
                            aria-label={t('graph.nodeAria', { kind: t(GRAPH_KIND_LABELS[node.kind]), label: node.label, status: t(graphStatusLabel(node.status) as TranslationKey), evidence: t(graphEvidenceLabel(node.evidence_status) as TranslationKey) })}
                            aria-pressed={selected}
                            onClick={selectNode}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                selectNode()
                              }
                            }}
                          >
                            <title>{`${node.label} · ${node.id}`}</title>
                            <rect x={node.x} y={node.y} width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} rx="14" />
                            <line className="research-graph-node-accent" x1={node.x + 4} y1={node.y + 12} x2={node.x + 4} y2={node.y + GRAPH_NODE_HEIGHT - 12} />
                            <text className="research-graph-node-kind" x={node.x + 15} y={node.y + 20}>{t(GRAPH_KIND_LABELS[node.kind])}</text>
                            <text className="research-graph-node-label" x={node.x + 15} y={node.y + 43}>{graphLabel(node.label, t)}</text>
                            <text className="research-graph-node-status" x={node.x + 15} y={node.y + 66}>{t(graphStatusLabel(node.status) as TranslationKey)} · {t(graphEvidenceLabel(node.evidence_status) as TranslationKey)}</text>
                          </g>
                        )
                      })}
                    </g>
                  </svg>
                </div>
                <div className="research-graph-details" aria-live="polite">
                  {selectedGraphNode ? (
                    <>
                      <div className="research-graph-details-heading"><div><span className="eyebrow">{t('graph.selectedNode')}</span><h3>{selectedGraphNode.label}</h3></div><Badge status={selectedGraphNode.status}>{t(graphStatusLabel(selectedGraphNode.status) as TranslationKey)}</Badge></div>
                      <dl className="research-graph-details-list">
                        <div><dt>{t('graph.type')}</dt><dd>{t(GRAPH_KIND_LABELS[selectedGraphNode.kind])}</dd></div>
                        <div><dt>{t('graph.stableId')}</dt><dd><code>{text(selectedGraphNode.source.stable_id, t) || selectedGraphNode.id}</code></dd></div>
                        <div><dt>{t('graph.source')}</dt><dd>{text(selectedGraphNode.source.source_type, t)} · <code>{selectedGraphNode.source.source_id}</code></dd></div>
                        <div><dt>{t('graph.evidenceStatus')}</dt><dd>{t(graphEvidenceLabel(selectedGraphNode.evidence_status) as TranslationKey)}</dd></div>
                        <div><dt>{t('graph.permission')}</dt><dd>{statusLabel(selectedGraphNode.permission_status, t)}</dd></div>
                        {selectedGraphNode.source.provider ? <div><dt>{t('graph.provider')}</dt><dd>{selectedGraphNode.source.provider}</dd></div> : null}
                        {selectedGraphNode.source.locator ? <div><dt>{t('graph.locator')}</dt><dd>{selectedGraphNode.source.locator}</dd></div> : null}
                      </dl>
                      {selectedGraphNode.source.url ? <a className="research-graph-source-link" href={selectedGraphNode.source.url} target="_blank" rel="noreferrer">{t('graph.openSource')} <ExternalLink size={13} /></a> : null}
                    </>
                  ) : <p className="muted">{t('graph.selectHint')}</p>}
                </div>
              </div>
            ) : <EmptyState text={t('graph.empty')} />}
          </>
        ) : null}
      </>
    )
  }

  if (tab === 'overview_progress') {
    const rows = [
      ...(project.related_work_runs || []).map(run => ({ id: `search-${run.id}`, title: t('progress.relatedRun', { id: run.id.slice(0, 8) }), detail: t('progress.candidateCount', { count: run.discovered_count || 0, edges: run.edge_count || 0 }), status: run.status })),
      ...(project.experiments || []).map(run => ({ id: `experiment-${run.id}`, title: run.experiment_type, detail: t('overview.runDetail', { run: run.run_id || t('progress.runPending') }), status: run.status })),
      ...(project.proposals || []).filter(item => item.status === 'pending').map(item => ({ id: `proposal-${item.id}`, title: item.summary, detail: item.kind, status: 'waiting-approval' })),
    ]
    return (
      <>
        <SectionHeading title={t('progress.title')} hint={t('progress.hint')} extra={<Badge>{t('progress.count', { count: rows.length })}</Badge>} />
        {rows.length ? <div className="data-list">{rows.map(row => <div className="data-row" key={row.id}><div><h3>{row.title}</h3><p>{row.detail}</p></div><Badge status={row.status} /></div>)}</div> : <EmptyState text={t('progress.empty')} />}
      </>
    )
  }

  if (tab === 'method_design') {
    const idea = project.spec?.idea
    return (
      <>
        <SectionHeading title={t('method.title')} hint={t('method.hint')} />
        <div className="data-list">
          <div className="data-row"><div><h3>{t('method.question')}</h3><p>{text(idea?.research_question, t) || t('common.notConfirmed')}</p></div><Badge status={idea?.research_question ? 'recorded' : 'unresolved'} /></div>
          <div className="data-row"><div><h3>{t('method.hypotheses')}</h3><p>{idea?.hypotheses?.join('；') || t('common.notConfirmed')}</p></div><Badge status={idea?.hypotheses?.length ? 'recorded' : 'unresolved'} /></div>
          <div className="data-row"><div><h3>{t('method.contributions')}</h3><p>{idea?.expected_contributions?.join('；') || t('common.notConfirmed')}</p></div><Badge status={idea?.expected_contributions?.length ? 'candidate' : 'unresolved'} /></div>
          <div className="data-row"><div><h3>{t('method.relatedEvidence')}</h3><p>{t('method.verifiedCount', { verified: (project.papers || []).filter(paper => paper.verified).length, total: project.papers?.length || 0 })}</p></div><ShieldCheck size={16} className="muted" /></div>
        </div>
      </>
    )
  }

  if (tab === 'code_workspace') {
    return (
      <>
        <SectionHeading title={t('code.title')} hint={t('code.hint')} />
        {workspaceError ? <EmptyState text={t('code.error', { error: workspaceError })} /> : null}
        {workspace ? (
          <>
            <div className="data-list">
              <div className="data-row"><div><h3>{t('code.workspace')}</h3><p><code>{workspace.code_relative_path}</code></p></div><Badge status={workspace.code_directory_exists ? 'project-scoped' : 'missing'} /></div>
              <div className="data-row"><div><h3>{t('code.gitBaseline')}</h3><p>{workspace.branch || t('common.unknown')} · {workspace.head || t('code.noCommit')}</p></div><Badge status={workspace.dirty ? 'dirty' : 'clean'} /></div>
              <div className="data-row"><div><h3>{t('code.pendingTitle')}</h3><p>{t('code.pendingCount', { count: (project.proposals || []).filter(item => ['code_patch', 'config_change', 'dependency_install', 'repository_download', 'repository_dependency_install', 'repository_reproduction_run', 'repository_artifact_write'].includes(item.kind) && item.status === 'pending').length })}</p></div><Badge status="approval-required" /></div>
            </div>
            {workspace.files?.length ? <div className="section"><SectionHeading title={t('code.fileTree')} hint={t('code.fileTreeHint', { max: workspace.limits?.max_files || 600 })} /><div className="data-list">{workspace.files.map(file => <div className="data-row compact-row" key={file.path}><code>{file.kind === 'directory' ? `${file.path}/` : file.path}</code><span className="muted">{file.size_bytes} B</span></div>)}</div></div> : <EmptyState text={t('code.emptyDir')} />}
            {workspace.diff ? <div className="section"><SectionHeading title={t('code.currentDiff')} hint={workspace.diff_truncated ? t('code.diffTruncated') : t('code.diffReadonly')} /><pre className="code-block workspace-diff">{workspace.diff}</pre></div> : null}
          </>
        ) : !workspaceError ? <EmptyState text={t('code.loading')} /> : null}
      </>
    )
  }

  if (tab === 'experiment_queue' || tab === 'experiment_metrics') {
    const experiments = project.experiments || []
    const filtered = tab === 'experiment_queue'
      ? experiments.filter(item => ['queued', 'running', 'paused', 'cancelled', 'waiting-approval'].includes(item.status))
      : experiments.filter(item => Object.keys(item.metrics || {}).length > 0)
    return (
      <>
        <SectionHeading title={tab === 'experiment_queue' ? t('queue.title') : t('metrics.title')} hint={t('queue.hint')} extra={<Badge>{t('queue.count', { count: filtered.length })}</Badge>} />
        {filtered.length ? <div className="data-list">{filtered.map(item => <div className="data-row" key={item.id}><div><h3>{item.experiment_type}</h3><p>{tab === 'experiment_queue' ? t('overview.runDetail', { run: item.run_id || t('queue.runUnassigned') }) : JSON.stringify(item.metrics)}</p></div><Badge status={item.status} /></div>)}</div> : <EmptyState text={tab === 'experiment_queue' ? t('queue.empty') : t('metrics.empty')} />}
      </>
    )
  }

  if (tab === 'lineage') {
    const artifacts = project.artifacts || []
    return (
      <>
        <SectionHeading title={t('lineage.title')} hint={t('lineage.hint')} />
        {artifacts.length ? <div className="data-list">{artifacts.map(artifact => <div className="data-row" key={artifact.id}><div><h3>{artifact.name}</h3><p>{artifact.metadata?.lineage ? JSON.stringify(artifact.metadata.lineage) : t('lineage.missingMeta')}</p></div><Badge status={artifact.valid ? 'valid' : 'invalid'} /></div>)}</div> : <EmptyState text={t('lineage.empty')} />}
      </>
    )
  }

  return <EmptyState text={t('workflow.empty')} />
}
