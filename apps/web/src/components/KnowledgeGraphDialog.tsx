import { useEffect, useMemo, useState } from 'react'
import { FileText, GitBranch, LoaderCircle } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useTranslation, type TranslationKey } from '../i18n'
import type { KnowledgeGraphNode, KnowledgeGraphResponse } from '../types'
import { Badge, Modal, statusLabel } from './ui'

type PositionedNode = KnowledgeGraphNode & { x: number; y: number; width: number }

const NODE_TYPE_LABELS: Record<string, TranslationKey> = {
  knowledge_document: 'knowledge.nodeType.knowledgeDocument',
  idea_version: 'knowledge.nodeType.ideaVersion',
  paper: 'knowledge.nodeType.paper',
  evidence: 'knowledge.nodeType.evidence',
  repository: 'knowledge.nodeType.repository',
  reproduction: 'knowledge.nodeType.reproduction',
  reproduction_run: 'knowledge.nodeType.reproductionRun',
  uploaded_file: 'knowledge.nodeType.uploadedFile',
  artifact: 'knowledge.nodeType.artifact',
  experiment: 'knowledge.nodeType.experiment',
  checkpoint: 'knowledge.nodeType.checkpoint',
  git_commit: 'knowledge.nodeType.gitCommit',
  data_version: 'knowledge.nodeType.dataVersion',
  config: 'knowledge.nodeType.config',
}

function nodeTypeLabel(value: string, t: (key: TranslationKey) => string): string {
  const key = NODE_TYPE_LABELS[value]
  return key ? t(key) : value
}

function compactLabel(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function graphLayout(graph: KnowledgeGraphResponse): { nodes: PositionedNode[]; width: number; height: number } {
  const upstream = graph.nodes.filter(node => node.category !== 'knowledge_document').sort((left, right) => left.node_type.localeCompare(right.node_type) || left.label.localeCompare(right.label))
  const documents = graph.nodes.filter(node => node.category === 'knowledge_document').sort((left, right) => left.label.localeCompare(right.label))
  const rowHeight = 68
  const height = Math.max(360, 72 + Math.max(upstream.length, documents.length) * rowHeight)
  return {
    width: 960,
    height,
    nodes: [
      ...upstream.map((node, index) => ({ ...node, x: 36, y: 38 + index * rowHeight, width: 330 })),
      ...documents.map((node, index) => ({ ...node, x: 594, y: 38 + index * rowHeight, width: 330 })),
    ],
  }
}

function GraphCanvas({ graph, selectedId, onSelect }: { graph: KnowledgeGraphResponse; selectedId: string | null; onSelect: (node: KnowledgeGraphNode) => void }) {
  const { t } = useTranslation()
  const layout = useMemo(() => graphLayout(graph), [graph])
  const positions = new Map(layout.nodes.map(node => [node.id, node]))
  return (
    <div className="knowledge-graph-scroll" tabIndex={0} aria-label={t('knowledge.graphScrollLabel')}>
      <svg className="knowledge-lineage-canvas" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={t('knowledge.graphAria', { nodes: graph.nodes.length, edges: graph.edges.length })}>
        <defs>
          <marker id="knowledge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <text className="knowledge-graph-column-label" x="36" y="22">{t('knowledge.graphEntities')}</text>
        <text className="knowledge-graph-column-label" x="594" y="22">{t('knowledge.graphDocuments')}</text>
        {graph.edges.map(edge => {
          const source = positions.get(edge.source)
          const target = positions.get(edge.target)
          if (!source || !target) return null
          const sourceX = source.x < target.x ? source.x + source.width : source.x
          const targetX = source.x < target.x ? target.x : target.x + target.width
          const sourceY = source.y + 22
          const targetY = target.y + 22
          const middleX = sourceX + (targetX - sourceX) / 2
          return (
            <path
              key={edge.id}
              className={`knowledge-graph-edge${edge.valid ? '' : ' is-invalid'}`}
              d={`M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}`}
              markerEnd="url(#knowledge-arrow)"
            >
              <title>{`${edge.relation}${edge.impact_policy ? ` · ${edge.impact_policy}` : ''}`}</title>
            </path>
          )
        })}
        {layout.nodes.map(node => {
          const selected = selectedId === node.id
          return (
            <g
              key={node.id}
              className={`knowledge-graph-node-group category-${node.category}${selected ? ' is-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${node.label}, ${nodeTypeLabel(node.node_type, t)}, ${statusLabel(node.status, t)}`}
              aria-pressed={selected}
              onClick={() => onSelect(node)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(node)
                }
              }}
            >
              <rect x={node.x} y={node.y} width={node.width} height="44" rx="7" />
              <circle cx={node.x + 19} cy={node.y + 22} r="6" />
              <text className="knowledge-graph-node-label" x={node.x + 34} y={node.y + 18}>{compactLabel(node.label)}</text>
              <text className="knowledge-graph-node-meta" x={node.x + 34} y={node.y + 34}>{`${nodeTypeLabel(node.node_type, t)} · ${statusLabel(node.status, t)}`}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function KnowledgeGraphDialog({ open, projectId, onClose, showToast }: { open: boolean; projectId: string; onClose: () => void; showToast: (message: string) => void }) {
  const { t } = useTranslation()
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null)
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setFailure('')
    setGraph(null)
    setSelected(null)
    api<KnowledgeGraphResponse>(`/api/projects/${encodeURIComponent(projectId)}/knowledge/graph`)
      .then(result => {
        if (cancelled) return
        setGraph(result)
        setSelected(result.nodes.find(node => node.category === 'knowledge_document') || result.nodes[0] || null)
      })
      .catch(error => {
        if (cancelled) return
        const message = errorMessage(error)
        setFailure(message)
        showToast(message)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, projectId, showToast])

  if (!open) return null
  return (
    <Modal eyebrow={t('knowledge.eyebrow')} title={t('knowledge.graphTitle')} description={t('knowledge.graphScope', { projectId })} onClose={onClose} wide>
      {loading ? <div className="knowledge-loading" role="status"><LoaderCircle size={18} className="spin" />{t('common.loading')}</div> : null}
      {failure ? <div className="form-error" role="alert">{failure}</div> : null}
      {graph?.graph_status === 'empty' ? <div className="empty">{t('knowledge.graphEmpty')}</div> : null}
      {graph?.graph_status === 'ready' ? (
        <>
          <div className="knowledge-graph-summary">
            <span><FileText size={14} />{t('knowledge.graphNodeCount', { count: graph.nodes.length })}</span>
            <span><GitBranch size={14} />{t('knowledge.graphEdgeCount', { count: graph.edges.length })}</span>
            {graph.truncated ? <Badge status="partial">{t('knowledge.graphTruncated')}</Badge> : null}
          </div>
          <GraphCanvas graph={graph} selectedId={selected?.id || null} onSelect={setSelected} />
          {selected ? (
            <section className="knowledge-graph-detail" aria-live="polite">
              <div>
                <span className="eyebrow">{nodeTypeLabel(selected.node_type, t)}</span>
                <h3>{selected.label}</h3>
              </div>
              <dl>
                <div><dt>{t('knowledge.status')}</dt><dd><Badge status={selected.status} /></dd></div>
                <div><dt>{t('knowledge.locator')}</dt><dd>{selected.locator}</dd></div>
                <div><dt>{t('knowledge.permission')}</dt><dd>{statusLabel(selected.permission, t)}</dd></div>
                {selected.document_sha256 ? <div><dt>SHA-256</dt><dd><code>{selected.document_sha256}</code></dd></div> : null}
              </dl>
            </section>
          ) : null}
        </>
      ) : null}
    </Modal>
  )
}
