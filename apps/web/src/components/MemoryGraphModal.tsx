import { useEffect, useState } from 'react'
import { Search, Share2 } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { MemoryGraphResponse, MemorySearchResponse, MemoryStatusResponse } from '../types'
import { Modal } from './ui'
import { useTranslation } from '../i18n'

type MemoryView = 'graph' | 'search'

function GraphCanvas({ graph }: { graph: MemoryGraphResponse | null }) {
  const { t } = useTranslation()
  if (!graph) return null
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const positions = new Map(nodes.map((node, index) => [node.id, {
    x: 80 + (index % 5) * 150,
    y: 70 + Math.floor(index / 5) * 120,
  }]))
  return (
    <svg className="memory-graph-canvas" viewBox="0 0 760 360" role="img" aria-label={t('memory.graphAria')}>
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
  const { t } = useTranslation()
  const [view, setView] = useState<MemoryView>('graph')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(t('memory.graphPrompt'))
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
          setStatus(t('memory.remoteUnsupported', { provider: embedding.provider }))
          return
        }
        const model = embedding?.model || 'Xenova/bge-m3'
        const dimensions = embedding?.dimensions || 1024
        setStatus(result.key_configured
          ? t('memory.configured', { model, dimensions })
          : t('memory.notConfigured'))
      })
      .catch(error => setStatus(t('memory.statusFailed', { error: errorMessage(error) })))
  }, [open, projectId])

  if (!open) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!projectId || !query.trim()) return
    setLoading(true)
    setStatus(t('memory.searching'))
    setGraph(null)
    setSearch(null)
    try {
      if (view === 'search') {
        const result = await api<MemorySearchResponse>(`/api/projects/${projectId}/memory/search`, {
          method: 'POST',
          body: JSON.stringify({ query: query.trim(), limit: 20, search_mode: 'hybrid' }),
        })
        setSearch(result)
        setStatus(t('memory.searchResults', { total: result.total }))
      } else {
        const result = await api<MemoryGraphResponse>(`/api/projects/${projectId}/memory/graph`, {
          method: 'POST',
          body: JSON.stringify({ query: query.trim(), limit: 8 }),
        })
        setGraph(result)
        setStatus(t('memory.graphResults', { nodes: result.nodes.length, edges: result.edges.length }))
      }
    } catch (error) {
      setStatus(t('memory.requestFailed', { error: errorMessage(error) }))
      showToast(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      eyebrow={t('memory.eyebrow')}
      title="Supermemory Graph Memory"
      description={t('memory.description')}
      onClose={onClose}
      wide
    >
      <div className="memory-view-switch" role="tablist" aria-label={t('memory.viewAria')}>
        <button
          className={view === 'graph' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'graph'}
          onClick={() => {
            setView('graph')
            setStatus(t('memory.graphPrompt'))
          }}
        >
          <Share2 size={16} />
          {t('memory.graphView')}
        </button>
        <button
          className={view === 'search' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'search'}
          onClick={() => {
            setView('search')
            setStatus(t('memory.searchPrompt'))
          }}
        >
          <Search size={16} />
          {t('memory.searchView')}
        </button>
      </div>
      <form className="memory-graph-form" onSubmit={submit}>
        <label htmlFor="memoryGraphQuery">{t('memory.queryLabel')}</label>
        <div className="memory-graph-query">
          <input
            id="memoryGraphQuery"
            maxLength={2000}
            required
            placeholder={t('memory.queryPlaceholder')}
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <button className="primary" type="submit" disabled={loading}>
            <Search size={16} />
            {t('memory.search')}
          </button>
        </div>
      </form>
      <div className="empty">{loading ? t('memory.searching') : status}</div>
      {view === 'graph' ? (
        <>
          <GraphCanvas graph={graph} />
          {graph?.nodes?.filter(node => node.kind === 'memory').length ? (
            <div className="memory-graph-results">
              {graph.nodes.filter(node => node.kind === 'memory').map(node => (
                <article className="memory-graph-result" key={node.id}>
                  <strong>{node.label}</strong>
                  <p>{t('memory.projectScope', { projectId: graph.project_id })}</p>
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
                <h3>{String(item.memory || t('memory.unnamedCandidate'))}</h3>
                <p>{t('memory.similarity', { value: String(item.similarity ?? t('common.notProvided')) })} · {t('memory.source', { source })}</p>
                <p>{t('memory.artifact', { value: String(item.artifact_id || item.metadata?.artifact_id || t('common.none')) })} · {t('memory.evidenceStatus', { value: String(item.evidence_status || 'semantic_candidate') })}</p>
              </article>
            )
          }) : null}
        </div>
      )}
    </Modal>
  )
}
