import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Boxes, CircleDashed, RefreshCw, Save, Sparkles } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ProjectDetail, ResearchStatusCandidateType, ResearchStatusGapCandidate, ResearchStatusResponse } from '../types'
import { Badge, ButtonRow, EmptyState, SectionHeading, statusLabel } from './ui'
import { useTranslation, type TranslationKey } from '../i18n'

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

type CellKey = {
  dimension: 'dataset' | 'metric'
  axis: string
  method: string
}

function cellKey(cell: CellKey) {
  return `${cell.dimension}::${cell.axis}::${cell.method}`
}

const CANDIDATE_TYPE_KEYS: Record<ResearchStatusCandidateType, TranslationKey> = {
  gap: 'research.gap',
  cluster: 'research.cluster',
  duplicate_risk: 'research.duplicateRisk',
  innovation: 'research.innovation',
  boundary: 'research.boundary',
  counterexample: 'research.counterexample',
  open_question: 'research.openQuestion',
}

const CANDIDATE_TYPES: ResearchStatusCandidateType[] = [
  'innovation',
  'boundary',
  'counterexample',
  'open_question',
  'gap',
  'cluster',
  'duplicate_risk',
]

export function NoveltyExplorer({
  project,
  showToast,
}: {
  project: ProjectDetail
  showToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ResearchStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [candidateType, setCandidateType] = useState<ResearchStatusCandidateType>('innovation')

  const loadStatus = async () => {
    setLoading(true)
    setError('')
    try {
      setStatus(await api<ResearchStatusResponse>(`/api/projects/${project.id}/research-status`))
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [project.id])

  const matrix = status?.matrix || null
  const rows = matrix?.rows || []
  const methods = useMemo(() => unique(rows.map(row => row.method)), [rows])
  const datasets = useMemo(() => unique(rows.flatMap(row => row.datasets)), [rows])
  const metrics = useMemo(() => unique(rows.flatMap(row => row.metrics)), [rows])

  const covered = useMemo(() => {
    const values = new Set<string>()
    for (const row of rows) {
      if (!row.method) continue
      for (const dataset of row.datasets) values.add(cellKey({ dimension: 'dataset', axis: dataset, method: row.method }))
      for (const metric of row.metrics) values.add(cellKey({ dimension: 'metric', axis: metric, method: row.method }))
    }
    return values
  }, [rows])

  const selectedCells = useMemo(() => {
    const cells: CellKey[] = []
    for (const key of selected) {
      const [dimension, axis, method] = key.split('::') as [CellKey['dimension'], string, string]
      cells.push({ dimension, axis, method })
    }
    return cells
  }, [selected])

  const toggleCell = (cell: CellKey) => {
    const key = cellKey(cell)
    setSelected(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const saveCandidate = async () => {
    if (!matrix || !selectedCells.length) return
    setSaving(true)
    try {
      const statement = t('novelty.statement', {
        combinations: selectedCells
          .map(cell => t('novelty.combination', { axis: cell.axis, method: cell.method }))
          .join('；'),
      })
      await api(`/api/projects/${project.id}/research-status/gap-candidates`, {
        method: 'POST',
        body: JSON.stringify({
          matrix_id: matrix.id,
          candidate_type: candidateType,
          statement,
          row_ids: matrix.rows.map(row => row.id),
        }),
      })
      setSelected(new Set())
      await loadStatus()
      showToast(t('research.candidateRecorded'))
    } catch (requestError) {
      showToast(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const decideCandidate = async (candidate: ResearchStatusGapCandidate, decision: 'accepted' | 'rejected') => {
    setSaving(true)
    try {
      await api(`/api/projects/${project.id}/research-status/gap-candidates/${candidate.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: decision === 'accepted' ? t('research.acceptGapReason') : t('research.rejectGapReason') }),
      })
      await loadStatus()
      showToast(decision === 'accepted' ? t('research.acceptedGapToast') : t('research.rejectedGapToast'))
    } catch (requestError) {
      showToast(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const renderGrid = (dimension: 'dataset' | 'metric', axes: string[]) => {
    if (!methods.length || !axes.length) return null
    return (
      <div className="novelty-grid-panel">
        <h3>{dimension === 'dataset' ? t('novelty.datasetMatrix') : t('novelty.metricMatrix')}</h3>
        <p className="muted">{dimension === 'dataset' ? t('novelty.datasetHint') : t('novelty.metricHint')}</p>
        <div
          className="novelty-grid"
          role="grid"
          aria-label={dimension === 'dataset' ? t('novelty.datasetMatrix') : t('novelty.metricMatrix')}
          style={{ '--novelty-columns': axes.length } as CSSProperties}
        >
          <div className="novelty-grid-head" role="row"><span role="columnheader">{t('research.method')}</span>{axes.map(axis => <span role="columnheader" key={axis}>{axis}</span>)}</div>
          {methods.map(method => (
            <div className="novelty-grid-row" role="row" key={method}>
              <strong>{method}</strong>
              {axes.map(axis => {
                const cell: CellKey = { dimension, axis, method }
                const key = cellKey(cell)
                const isCovered = covered.has(key)
                const isSelected = selected.has(key)
                const className = `novelty-cell${isCovered ? ' covered' : ' uncovered'}${isSelected ? ' selected' : ''}`
                return (
                  <button
                    type="button"
                    role="gridcell"
                    aria-pressed={isSelected}
                    aria-label={t('novelty.cellLabel', { axis, method, state: isCovered ? t('novelty.covered') : t('novelty.uncovered') })}
                    className={className}
                    disabled={isCovered}
                    key={key}
                    onClick={() => toggleCell(cell)}
                  >
                    {isCovered ? <CircleDashed size={14} aria-hidden="true" /> : isSelected ? <Sparkles size={14} aria-hidden="true" /> : <Boxes size={14} aria-hidden="true" />}
                    <span>{isCovered ? t('novelty.covered') : t('novelty.uncovered')}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="novelty-explorer section">
      <SectionHeading
        title={t('novelty.title')}
        hint={t('novelty.hint')}
        extra={
          <ButtonRow>
            <button className="secondary" type="button" disabled={loading} onClick={() => { void loadStatus(); showToast(t('research.refreshing')) }}>
              <RefreshCw size={15} />
              {t('topbar.refresh')}
            </button>
          </ButtonRow>
        }
      />
      {loading ? <EmptyState text={t('research.loading')} /> : null}
      {error ? <EmptyState text={t('research.requestFailed', { error })} /> : null}
      {!loading && !error && !matrix ? (
        <EmptyState text={t('research.noMatrix')} />
      ) : null}
      {!loading && !error && matrix ? (
        <>
          <div className="novelty-meta">
            <Badge status="project-scoped">{t('research.matrixVersion', { version: matrix.idea_version })}</Badge>
            <span className="muted">{t('novelty.rowCount', { count: rows.length, methods: methods.length, datasets: datasets.length, metrics: metrics.length })}</span>
          </div>
          {renderGrid('dataset', datasets)}
          {renderGrid('metric', metrics)}
          {!datasets.length && !metrics.length ? <EmptyState text={t('novelty.noDimensions')} /> : null}
          <div className="novelty-selection">
            <div>
              <strong>{t('research.candidateType')}</strong>
              <select value={candidateType} onChange={event => setCandidateType(event.target.value as ResearchStatusCandidateType)}>
                {CANDIDATE_TYPES.map(type => <option key={type} value={type}>{t(CANDIDATE_TYPE_KEYS[type])}</option>)}
              </select>
              <p className="muted">{t('novelty.selectionTitle')}</p>
              <p className="muted">{selectedCells.length ? selectedCells.map(cell => t('novelty.combination', { axis: cell.axis, method: cell.method })).join(' · ') : t('novelty.selectionEmpty')}</p>
            </div>
            <button className="primary" type="button" disabled={saving || !selectedCells.length} onClick={() => { void saveCandidate() }}>
              <Save size={15} />
              {t('novelty.saveCandidate')}
            </button>
          </div>
          {status?.gap_candidates.length ? (
            <div className="data-list novelty-candidates">
              {status.gap_candidates.map(candidate => (
                <div className="data-row" key={candidate.id}>
                  <div>
                    <h3>{candidate.statement}</h3>
                    <p>{t(CANDIDATE_TYPE_KEYS[candidate.candidate_type] ?? 'research.gap')} · {t('research.rowsCount', { count: candidate.row_ids.length })}</p>
                    <p className="muted">{t('research.sourceCount', {
                      papers: candidate.paper_ids.length,
                      evidence: candidate.evidence_ids.length,
                      claims: candidate.claim_review_ids.length,
                      version: candidate.idea_version,
                    })}</p>
                    <details className="candidate-sources">
                      <summary>{t('research.candidateSources')}</summary>
                      <div>
                        <strong>{t('research.candidatePapers')}</strong>
                        {candidate.basis.papers?.length ? candidate.basis.papers.map(paper => <p key={paper.id}><span>{paper.title}</span><small>{paper.doi || paper.source_url}</small></p>) : <p className="muted">{t('research.noSourceBinding')}</p>}
                      </div>
                      <div>
                        <strong>{t('research.candidateEvidence')}</strong>
                        {candidate.basis.evidence?.length ? candidate.basis.evidence.map(item => <p key={item.id}><span>{item.claim}</span><small>{t('research.locatorValue', { locator: item.locator || t('research.unresolved') })} · <a href={item.source_url} target="_blank" rel="noreferrer">{t('research.source')}</a></small></p>) : <p className="muted">{t('research.noSourceBinding')}</p>}
                      </div>
                      <div>
                        <strong>{t('research.candidateClaims')}</strong>
                        {candidate.basis.claim_reviews?.length ? candidate.basis.claim_reviews.map(review => <p key={review.id}><span>{review.claim}</span><small>{review.evidence_ids.length} {t('research.candidateEvidence')}</small></p>) : <p className="muted">{t('research.noSourceBinding')}</p>}
                      </div>
                    </details>
                  </div>
                  <ButtonRow>
                    <Badge status={candidate.status} />
                    {candidate.status === 'candidate' ? <>
                      <button className="secondary" type="button" disabled={saving} onClick={() => { void decideCandidate(candidate, 'accepted') }}>{t('research.keepCandidate')}</button>
                      <button className="secondary" type="button" disabled={saving} onClick={() => { void decideCandidate(candidate, 'rejected') }}>{t('common.reject')}</button>
                    </> : null}
                  </ButtonRow>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
