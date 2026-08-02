import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Network, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, ProjectWorkspaceDetail, ResearchStatusGraphEdge, ResearchStatusGraphNode, ResearchStatusResponse, TabId } from '../../types'
import { Badge, EmptyState, SectionHeading } from '../ui'

function text(value: unknown, fallback = '未记录') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

const GRAPH_KINDS: ResearchStatusGraphNode['kind'][] = ['candidate', 'paper', 'evidence', 'claim_review']
const GRAPH_NODE_WIDTH = 224
const GRAPH_NODE_HEIGHT = 86
const GRAPH_COLUMN_GAP = 38
const GRAPH_COLUMN_PADDING = 24
const GRAPH_TOP = 58
const GRAPH_ROW_GAP = 18

const GRAPH_KIND_LABELS: Record<ResearchStatusGraphNode['kind'], string> = {
  candidate: '候选',
  paper: 'Paper',
  evidence: 'Evidence',
  claim_review: 'ClaimReview',
}

const GRAPH_STATUS_LABELS: Record<string, string> = {
  candidate: '待确认',
  confirmed: '已确认',
  unconfirmed: '未确认',
  located: '已有定位',
  unlocated: '无定位',
  pending: '待审阅',
  accepted: '已接受',
  rejected: '已拒绝',
}

const GRAPH_EVIDENCE_LABELS: Record<string, string> = {
  metadata_only: '仅 metadata',
  page_quote: '页码/章节 quote',
  claim_reviewed: 'ClaimReview 已接受',
}

type PositionedGraphNode = ResearchStatusGraphNode & { x: number; y: number }

function graphLabel(value: string, maxLength = 31) {
  const normalized = text(value)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function graphStatusLabel(status: string) {
  return GRAPH_STATUS_LABELS[status] || status || '未记录'
}

function graphEvidenceLabel(status: string) {
  return GRAPH_EVIDENCE_LABELS[status] || status || '未记录'
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
        <SectionHeading title="项目范围引用图" hint="图只投影当前 project_id 中已经保存的引用、Paper-Evidence 和 ClaimReview-Evidence 关系；provider 引用边仍然是 metadata 关系，不是研究结论。" extra={<Badge>{`${researchStatus?.graph.edges.length || 0} 条边`}</Badge>} />
        {researchStatusError ? <EmptyState text={`引用图请求失败：${researchStatusError}`} /> : null}
        {!researchStatus && !researchStatusError ? <EmptyState text="正在读取项目范围引用图…" /> : null}
        {researchStatus ? (
          <>
            <div className="data-list">
              <div className="data-row"><div><h3>权限范围</h3><p><code>{researchStatus.project_id}</code></p></div><Badge status={researchStatus.permission_status} /></div>
              <div className="data-row"><div><h3>图状态</h3><p>{researchStatus.graph_status === 'partial' ? '部分数据可用；未返回的来源关系不会被猜测补齐。' : researchStatus.graph_status === 'empty' ? '当前项目还没有已保存的图节点或关系。' : '只显示数据库中已经保存的关系。'}</p></div><Badge status={researchStatus.graph_status} /></div>
              <div className="data-row"><div><h3>图规模</h3><p>{researchStatus.graph.nodes.length} 个节点 · {researchStatus.graph.edges.length} 条边；按候选、Paper、Evidence、ClaimReview 分层。</p></div><Network size={16} className="muted" /></div>
            </div>
            {researchStatus.graph_status === 'partial' ? <div className="research-graph-alert" role="status">当前响应为 partial。图中只呈现成功返回且已通过项目范围校验的节点和边。</div> : null}
            {graphLayout.nodes.length ? (
              <div className="research-graph-panel">
                <div className="research-graph-legend" aria-label="图例">
                  {GRAPH_KINDS.map(kind => <span className={`research-graph-legend-item kind-${kind}`} key={kind}><i aria-hidden="true" />{GRAPH_KIND_LABELS[kind]}</span>)}
                  <span className="research-graph-legend-note">箭头表示数据库中明确保存的关系</span>
                </div>
                <div className="research-graph-scroll">
                  <svg className="research-graph-svg" width={graphLayout.width} height={graphLayout.height} viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`} role="group" aria-label={`项目 ${researchStatus.project_id} 的项目范围引用图`}>
                    <title>项目范围引用图</title>
                    <defs>
                      <marker id="research-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                        <path d="M 0 0 L 8 4 L 0 8 z" />
                      </marker>
                    </defs>
                    <g className="research-graph-columns" aria-hidden="true">
                      {GRAPH_KINDS.map((kind, index) => <text key={kind} x={GRAPH_COLUMN_PADDING + index * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP)} y="27">{GRAPH_KIND_LABELS[kind]}</text>)}
                    </g>
                    <g className="research-graph-edges" aria-label="关系边">
                      {researchStatus.graph.edges.map(edge => {
                        const path = graphEdgePath(edge, graphNodesById)
                        return path ? <path key={edge.id} d={path} className={`research-graph-edge evidence-${edge.evidence_status}`} markerEnd="url(#research-graph-arrow)" aria-label={`${edge.relation} · ${edge.evidence_status} · ${edge.permission_status}`} /> : null
                      })}
                    </g>
                    <g className="research-graph-nodes" aria-label="图节点">
                      {graphLayout.nodes.map(node => {
                        const selected = selectedGraphNodeId === node.id
                        const selectNode = () => setSelectedGraphNodeId(node.id)
                        return (
                          <g
                            className={`research-graph-node-group kind-${node.kind}${selected ? ' selected' : ''}`}
                            key={node.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${GRAPH_KIND_LABELS[node.kind]}：${node.label}；状态：${graphStatusLabel(node.status)}；证据：${graphEvidenceLabel(node.evidence_status)}`}
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
                            <text className="research-graph-node-kind" x={node.x + 15} y={node.y + 20}>{GRAPH_KIND_LABELS[node.kind]}</text>
                            <text className="research-graph-node-label" x={node.x + 15} y={node.y + 43}>{graphLabel(node.label)}</text>
                            <text className="research-graph-node-status" x={node.x + 15} y={node.y + 66}>{graphStatusLabel(node.status)} · {graphEvidenceLabel(node.evidence_status)}</text>
                          </g>
                        )
                      })}
                    </g>
                  </svg>
                </div>
                <div className="research-graph-details" aria-live="polite">
                  {selectedGraphNode ? (
                    <>
                      <div className="research-graph-details-heading"><div><span className="eyebrow">已选节点</span><h3>{selectedGraphNode.label}</h3></div><Badge status={selectedGraphNode.status}>{graphStatusLabel(selectedGraphNode.status)}</Badge></div>
                      <dl className="research-graph-details-list">
                        <div><dt>类型</dt><dd>{GRAPH_KIND_LABELS[selectedGraphNode.kind]}</dd></div>
                        <div><dt>稳定 ID</dt><dd><code>{text(selectedGraphNode.source.stable_id, selectedGraphNode.id)}</code></dd></div>
                        <div><dt>来源</dt><dd>{text(selectedGraphNode.source.source_type)} · <code>{selectedGraphNode.source.source_id}</code></dd></div>
                        <div><dt>证据状态</dt><dd>{graphEvidenceLabel(selectedGraphNode.evidence_status)}</dd></div>
                        <div><dt>权限</dt><dd>{selectedGraphNode.permission_status}</dd></div>
                        {selectedGraphNode.source.provider ? <div><dt>Provider</dt><dd>{selectedGraphNode.source.provider}</dd></div> : null}
                        {selectedGraphNode.source.locator ? <div><dt>定位</dt><dd>{selectedGraphNode.source.locator}</dd></div> : null}
                      </dl>
                      {selectedGraphNode.source.url ? <a className="research-graph-source-link" href={selectedGraphNode.source.url} target="_blank" rel="noreferrer">打开来源 <ExternalLink size={13} /></a> : null}
                    </>
                  ) : <p className="muted">选择一个节点查看来源、稳定 ID、定位、证据和权限状态。</p>}
                </div>
              </div>
            ) : <EmptyState text="当前项目还没有已保存的图节点或关系。" />}
          </>
        ) : null}
      </>
    )
  }

  if (tab === 'overview_progress') {
    const rows = [
      ...(project.related_work_runs || []).map(run => ({ id: `search-${run.id}`, title: `相关工作递归 ${run.id.slice(0, 8)}`, detail: `${run.discovered_count || 0} 个候选 · ${run.edge_count || 0} 条边`, status: run.status })),
      ...(project.experiments || []).map(run => ({ id: `experiment-${run.id}`, title: run.experiment_type, detail: `Run ${run.run_id || '未入队'}`, status: run.status })),
      ...(project.proposals || []).filter(item => item.status === 'pending').map(item => ({ id: `proposal-${item.id}`, title: item.summary, detail: item.kind, status: 'waiting-approval' })),
    ]
    return (
      <>
        <SectionHeading title="项目进度与待决策" hint="进度来自已发生的运行、Proposal 和审批事件，不由模型自行估计。" extra={<Badge>{`${rows.length} 条记录`}</Badge>} />
        {rows.length ? <div className="data-list">{rows.map(row => <div className="data-row" key={row.id}><div><h3>{row.title}</h3><p>{row.detail}</p></div><Badge status={row.status} /></div>)}</div> : <EmptyState text="当前项目还没有运行或待审批动作。" />}
      </>
    )
  }

  if (tab === 'method_design') {
    const idea = project.spec?.idea
    return (
      <>
        <SectionHeading title="方法设计" hint="方法设计只消费已确认的项目规格和已记录文献；模型输出仍然是候选，写入需要 Proposal。" />
        <div className="data-list">
          <div className="data-row"><div><h3>研究问题</h3><p>{text(idea?.research_question, '尚未确认')}</p></div><Badge status={idea?.research_question ? 'recorded' : 'unresolved'} /></div>
          <div className="data-row"><div><h3>假设</h3><p>{idea?.hypotheses?.join('；') || '尚未确认'}</p></div><Badge status={idea?.hypotheses?.length ? 'recorded' : 'unresolved'} /></div>
          <div className="data-row"><div><h3>预期贡献</h3><p>{idea?.expected_contributions?.join('；') || '尚未确认'}</p></div><Badge status={idea?.expected_contributions?.length ? 'candidate' : 'unresolved'} /></div>
          <div className="data-row"><div><h3>相关工作依据</h3><p>{(project.papers || []).filter(paper => paper.verified).length} 条已验证记录，{project.papers?.length || 0} 条项目 Paper</p></div><ShieldCheck size={16} className="muted" /></div>
        </div>
      </>
    )
  }

  if (tab === 'code_workspace') {
    return (
      <>
        <SectionHeading title="代码工作区" hint="这里属于当前项目自己的代码；复现仓库和项目代码严格分开，所有修改、依赖和 Git 操作都需要 Proposal。" />
        {workspaceError ? <EmptyState text={`代码工作区读取失败：${workspaceError}`} /> : null}
        {workspace ? (
          <>
            <div className="data-list">
              <div className="data-row"><div><h3>项目工作区</h3><p><code>{workspace.code_relative_path}</code></p></div><Badge status={workspace.code_directory_exists ? 'project-scoped' : 'missing'} /></div>
              <div className="data-row"><div><h3>Git 基线</h3><p>{workspace.branch || 'detached/unknown'} · {workspace.head || '尚无 commit'}</p></div><Badge status={workspace.dirty ? 'dirty' : 'clean'} /></div>
              <div className="data-row"><div><h3>待审批代码/配置/复现动作</h3><p>{(project.proposals || []).filter(item => ['code_patch', 'config_change', 'dependency_install', 'repository_download', 'repository_dependency_install', 'repository_reproduction_run', 'repository_artifact_write'].includes(item.kind) && item.status === 'pending').length} 个</p></div><Badge status="approval-required" /></div>
            </div>
            {workspace.files?.length ? <div className="section"><SectionHeading title="受限文件树" hint={`最多显示 ${workspace.limits?.max_files || 600} 个条目；不读取 .git、.venv、node_modules。`} /><div className="data-list">{workspace.files.map(file => <div className="data-row compact-row" key={file.path}><code>{file.kind === 'directory' ? `${file.path}/` : file.path}</code><span className="muted">{file.size_bytes} B</span></div>)}</div></div> : <EmptyState text="代码目录为空，尚未有项目代码文件。" />}
            {workspace.diff ? <div className="section"><SectionHeading title="当前 diff" hint={workspace.diff_truncated ? 'diff 已截断，完整变更仍需通过 Proposal 查看。' : '只读展示当前代码目录的 Git diff。'} /><pre className="code-block workspace-diff">{workspace.diff}</pre></div> : null}
          </>
        ) : !workspaceError ? <EmptyState text="正在读取受限 Git 工作区…" /> : null}
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
        <SectionHeading title={tab === 'experiment_queue' ? '运行队列' : '指标统计'} hint="运行状态和数值均来自真实 Experiment Run；未执行的计划不会显示为结果。" extra={<Badge>{`${filtered.length} 条`}</Badge>} />
        {filtered.length ? <div className="data-list">{filtered.map(item => <div className="data-row" key={item.id}><div><h3>{item.experiment_type}</h3><p>{tab === 'experiment_queue' ? `Run ${item.run_id || '未分配'}` : JSON.stringify(item.metrics)}</p></div><Badge status={item.status} /></div>)}</div> : <EmptyState text={tab === 'experiment_queue' ? '当前没有排队或执行中的实验。' : '还没有带数值指标的实验结果。'} />}
      </>
    )
  }

  if (tab === 'lineage') {
    const artifacts = project.artifacts || []
    return (
      <>
        <SectionHeading title="结果谱系" hint="每个 Artifact 必须能回链 Experiment、Run、Idea 版本、代码 commit、数据版本和配置。" />
        {artifacts.length ? <div className="data-list">{artifacts.map(artifact => <div className="data-row" key={artifact.id}><div><h3>{artifact.name}</h3><p>{artifact.metadata?.lineage ? JSON.stringify(artifact.metadata.lineage) : '缺少谱系元数据'}</p></div><Badge status={artifact.valid ? 'valid' : 'invalid'} /></div>)}</div> : <EmptyState text="当前没有可追溯的 Artifact。" />}
      </>
    )
  }

  return <EmptyState text="当前子页面没有可显示的数据。" />
}
