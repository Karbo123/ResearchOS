import { useEffect, useState } from 'react'
import { Search, Share2 } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { MemoryGraphResponse, MemorySearchResponse, MemoryStatusResponse } from '../types'
import { Modal } from './ui'

type MemoryView = 'graph' | 'search'

function GraphCanvas({ graph }: { graph: MemoryGraphResponse | null }) {
  if (!graph) return null
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const positions = new Map(nodes.map((node, index) => [node.id, {
    x: 80 + (index % 5) * 150,
    y: 70 + Math.floor(index / 5) * 120,
  }]))
  return (
    <svg className="memory-graph-canvas" viewBox="0 0 760 360" role="img" aria-label="项目语义记忆关系图">
      {edges.map(edge => {
        const source = positions.get(edge.source)
        const target = positions.get(edge.target)
        return source && target ? (
          <line key={edge.id} className="memory-graph-edge" x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
        ) : null
      })}
      {nodes.map(node => {
        const position = positions.get(node.id)
        if (!position) return null
        return (
          <g key={node.id}>
            <circle
              className={`memory-graph-node ${node.kind !== 'memory' ? 'related' : ''}`}
              cx={position.x}
              cy={position.y}
              r="18"
            >
              <title>{node.label}</title>
            </circle>
            <text className="memory-graph-label" x={position.x} y={position.y + 36} textAnchor="middle">
              {node.label.slice(0, 20)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function MemoryGraphModal({
  open,
  projectId,
  onClose,
  showToast,
}: {
  open: boolean
  projectId: string | null
  onClose: () => void
  showToast: (message: string) => void
}) {
  const [view, setView] = useState<MemoryView>('graph')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('输入查询以加载当前项目的 Graph Memory。')
  const [graph, setGraph] = useState<MemoryGraphResponse | null>(null)
  const [search, setSearch] = useState<MemorySearchResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !projectId) return
    setView('graph')
    setQuery('')
    setGraph(null)
    setSearch(null)
    api<MemoryStatusResponse>(`/api/projects/${projectId}/memory/status`)
      .then(result => {
        const embedding = result.embedding
        if (embedding && embedding.provider !== 'local' && !embedding.remote_embedding_supported) {
          setStatus(`已配置 ${embedding.provider} embedding，但当前服务端仅支持本地 embedding；记忆请求会失败关闭，不会静默降级。`)
          return
        }
        const model = embedding?.model || 'Xenova/bge-m3'
        const dimensions = embedding?.dimensions || 1024
        setStatus(result.key_configured
          ? `Supermemory 已配置 · ${model}（${dimensions} 维），输入查询后加载项目范围图。`
          : 'Supermemory 尚未配置 API key；不会使用本地或无关数据替代。')
      })
      .catch(error => setStatus(`状态读取失败：${errorMessage(error)}`))
  }, [open, projectId])

  if (!open) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!projectId || !query.trim()) return
    setLoading(true)
    setStatus('正在检索当前项目范围…')
    setGraph(null)
    setSearch(null)
    try {
      if (view === 'search') {
        const result = await api<MemorySearchResponse>(`/api/projects/${projectId}/memory/search`, {
          method: 'POST',
          body: JSON.stringify({ query: query.trim(), limit: 20, search_mode: 'hybrid' }),
        })
        setSearch(result)
        setStatus(`${result.total} 条候选 · 来源：Supermemory · 当前项目范围`)
      } else {
        const result = await api<MemoryGraphResponse>(`/api/projects/${projectId}/memory/graph`, {
          method: 'POST',
          body: JSON.stringify({ query: query.trim(), limit: 8 }),
        })
        setGraph(result)
        setStatus(`${result.nodes.length} 个节点 · ${result.edges.length} 条关系 · 来源：Supermemory`)
      }
    } catch (error) {
      setStatus(`请求失败：${errorMessage(error)}`)
      showToast(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      eyebrow="项目级语义上下文"
      title="Supermemory Graph Memory"
      description="只显示当前项目范围的语义候选及其关系；候选不等于论文证据。"
      onClose={onClose}
      wide
    >
      <div className="memory-view-switch" role="tablist" aria-label="语义记忆视图">
        <button
          className={view === 'graph' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'graph'}
          onClick={() => {
            setView('graph')
            setStatus('输入查询以加载当前项目的 Graph Memory。')
          }}
        >
          <Share2 size={16} />
          关系图
        </button>
        <button
          className={view === 'search' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'search'}
          onClick={() => {
            setView('search')
            setStatus('输入查询以检索当前项目的语义候选。')
          }}
        >
          <Search size={16} />
          语义检索
        </button>
      </div>
      <form className="memory-graph-form" onSubmit={submit}>
        <label htmlFor="memoryGraphQuery">查询当前项目</label>
        <div className="memory-graph-query">
          <input
            id="memoryGraphQuery"
            maxLength={2000}
            required
            placeholder="输入研究目标、事实或材料线索"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <button className="primary" type="submit" disabled={loading}>
            <Search size={16} />
            检索
          </button>
        </div>
      </form>
      <div className="empty">{loading ? '正在检索当前项目范围…' : status}</div>
      {view === 'graph' ? (
        <>
          <GraphCanvas graph={graph} />
          {graph?.nodes?.filter(node => node.kind === 'memory').length ? (
            <div className="memory-graph-results">
              {graph.nodes.filter(node => node.kind === 'memory').map(node => (
                <article className="memory-graph-result" key={node.id}>
                  <strong>{node.label}</strong>
                  <p>项目范围：{graph.project_id} · 语义候选，需人工证据复核</p>
                </article>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="memory-search-results">
          {search?.results?.length ? search.results.map((item, index) => {
            const source = item.source_type
              ? `${item.source_type}${item.source_id ? ` · ${item.source_id}` : ''}`
              : 'Supermemory semantic result'
            return (
              <article className="memory-search-result" key={index}>
                <h3>{String(item.memory || '未命名候选')}</h3>
                <p>相似度：{String(item.similarity ?? '未提供')} · 来源：{source}</p>
                <p>Artifact：{String(item.artifact_id || item.metadata?.artifact_id || '无')} · 证据状态：{String(item.evidence_status || 'semantic_candidate')}</p>
              </article>
            )
          }) : null}
        </div>
      )}
    </Modal>
  )
}
