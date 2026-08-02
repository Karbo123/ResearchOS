import { useEffect, useMemo, useState } from 'react'
import { Download, Filter, Lightbulb, RefreshCw, Table2 } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, ResearchStatusGapCandidate, ResearchStatusResponse } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading, statusLabel } from '../ui'
import { formatDateTime, useTranslation, type TranslationKey } from '../../i18n'

function listLabel(values: string[], emptyLabel: string) {
  return values.length ? values.join(', ') : emptyLabel
}

function evidenceLabel(status: string) {
  if (status === 'claim_reviewed') return 'research.claimReviewed'
  if (status === 'page_quote') return 'research.pageQuote'
  return 'research.metadataOnly'
}

export function ResearchStatusTab({
  project,
  showToast,
}: {
  project: ProjectDetail
  showToast: (message: string) => void
}) {
  const { t, locale } = useTranslation()
  const [status, setStatus] = useState<ResearchStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState('')
  const [method, setMethod] = useState('')
  const [year, setYear] = useState('')
  const [gapType, setGapType] = useState<'gap' | 'cluster' | 'duplicate_risk'>('gap')
  const [gapStatement, setGapStatement] = useState('')

  const loadStatus = async (filters = { theme, method, year }) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.theme.trim()) params.set('theme', filters.theme.trim())
      if (filters.method.trim()) params.set('method', filters.method.trim())
      if (filters.year.trim()) params.set('year', filters.year.trim())
      setStatus(await api<ResearchStatusResponse>(`/api/projects/${project.id}/research-status${params.toString() ? `?${params.toString()}` : ''}`))
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setStatus(null)
    void loadStatus({ theme: '', method: '', year: '' })
  }, [project.id])

  const eligibleRows = useMemo(() => {
    const reviews = project.claim_reviews || []
    return (project.papers || []).flatMap(paper => {
      if (paper.confirmed !== true) return []
      const evidence = (project.evidence || []).filter(item => item.paper_id === paper.id && Boolean(item.locator?.trim()))
      const evidenceIds = new Set(evidence.map(item => item.id))
      const acceptedReviews = reviews.filter(review => review.status === 'accepted' && review.evidence_ids.some(id => evidenceIds.has(id)))
      if (!evidence.length || !acceptedReviews.length) return []
      return [{
        paper_id: paper.id,
        theme: null,
        method: null,
        year: paper.year ?? null,
        datasets: [],
        metrics: [],
        limitations: null,
        code_availability: 'unresolved' as const,
        evidence_ids: evidence.map(item => item.id),
        claim_review_ids: acceptedReviews.map(review => review.id),
      }]
    })
  }, [project])

  const createMatrix = async () => {
    if (!eligibleRows.length) {
      showToast(t('research.eligibleRequired'))
      return
    }
    setWorking(true)
    try {
      const created = await api<ResearchStatusResponse>(`/api/projects/${project.id}/research-status/matrices`, {
        method: 'POST',
        body: JSON.stringify({ rows: eligibleRows }),
      })
      setStatus(created)
      showToast(t('research.matrixCreated'))
    } catch (requestError) {
      showToast(errorMessage(requestError))
    } finally {
      setWorking(false)
    }
  }

  const createGapCandidate = async () => {
    if (!status?.matrix || !gapStatement.trim()) return
    setWorking(true)
    try {
      await api(`/api/projects/${project.id}/research-status/gap-candidates`, {
        method: 'POST',
        body: JSON.stringify({
          matrix_id: status.matrix.id,
          candidate_type: gapType,
          statement: gapStatement.trim(),
          row_ids: status.matrix.rows.map(row => row.id),
        }),
      })
      setGapStatement('')
      await loadStatus()
      showToast(t('research.candidateRecorded'))
    } catch (requestError) {
      showToast(errorMessage(requestError))
    } finally {
      setWorking(false)
    }
  }

  const decideGap = async (candidate: ResearchStatusGapCandidate, decision: 'accepted' | 'rejected') => {
    setWorking(true)
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
      setWorking(false)
    }
  }

  const matrix = status?.matrix
  const exportUrl = (format: 'json' | 'csv' | 'markdown') => matrix ? `/api/projects/${project.id}/research-status/export?format=${format}&matrix_id=${matrix.id}` : '#'

  return (
    <>
      <SectionHeading
        title={t('research.title')}
        hint={t('research.hint')}
        extra={
          <ButtonRow>
            <button className="secondary" type="button" disabled={loading || working} onClick={() => { void loadStatus(); showToast(t('research.refreshing')) }}>
              <RefreshCw size={15} />
              {t('topbar.refresh')}
            </button>
            <button className="primary" type="button" disabled={working || Boolean(matrix)} onClick={() => { void createMatrix() }}>
              <Table2 size={15} />
              {matrix ? t('research.matrixReady') : t('research.createMatrix')}
            </button>
          </ButtonRow>
        }
      />
      <div className="section research-status-scope">
        <div className="data-row compact-row">
          <div><strong>{t('context.currentScope')}</strong><p><code>{project.id}</code></p></div>
          <Badge status={status?.permission_status || 'project-scoped'} />
        </div>
        <p className="muted">{t('research.scopeCounts', { eligible: eligibleRows.length, rows: matrix?.rows.length || 0, idea: project.current_idea_version || 1 })}</p>
      </div>
      <div className="section research-status-filters">
        <SectionHeading title={t('research.filtersTitle')} hint={t('research.filtersHint')} extra={<Filter size={16} className="muted" />} />
        <div className="form-grid three-up">
          <label>{t('research.theme')}<input value={theme} onChange={event => setTheme(event.target.value)} placeholder={t('research.themePlaceholder')} /></label>
          <label>{t('research.method')}<input value={method} onChange={event => setMethod(event.target.value)} placeholder={t('research.methodPlaceholder')} /></label>
          <label>{t('research.year')}<input inputMode="numeric" value={year} onChange={event => setYear(event.target.value)} placeholder="2024" /></label>
        </div>
        <ButtonRow><button className="secondary" type="button" disabled={loading} onClick={() => { void loadStatus(); showToast(t('research.filtersApplied')) }}>{t('research.applyFilters')}</button></ButtonRow>
      </div>
      {loading ? <EmptyState text={t('research.loading')} /> : null}
      {error ? <EmptyState text={t('research.requestFailed', { error })} /> : null}
      {!loading && !error && status && !matrix ? <EmptyState text={status.limitations[0] || t('research.noMatrix')} action={<button className="secondary" type="button" disabled={working || !eligibleRows.length} onClick={() => { void createMatrix() }}>{t('research.createFromReviewed')}</button>} /> : null}
      {!loading && !error && matrix ? (
        <>
          <div className="section research-status-matrix-panel">
            <SectionHeading title={t('research.matrixVersion', { version: matrix.idea_version })} hint={t('research.matrixMeta', { creator: matrix.created_by, time: formatDateTime(matrix.created_at, locale) })} extra={<ButtonRow><a className="secondary" href={exportUrl('csv')} download><Download size={15} />CSV</a><a className="secondary" href={exportUrl('markdown')} download><Download size={15} />Markdown</a><a className="secondary" href={exportUrl('json')} download><Download size={15} />JSON</a></ButtonRow>} />
            {matrix.rows.length ? (
              <div className="research-status-table-wrap">
                <table className="research-status-table">
                  <thead><tr><th>{t('research.paper')}</th><th>{t('research.theme')}</th><th>{t('research.method')}</th><th>{t('research.year')}</th><th>{t('research.datasets')}</th><th>{t('research.metrics')}</th><th>{t('research.code')}</th><th>{t('research.evidence')}</th></tr></thead>
                  <tbody>{matrix.rows.map(row => <tr key={row.id}>
                    <td><strong>{row.paper?.title || row.paper_id}</strong><small>{row.paper?.doi || t('research.doiUnrecorded')}</small></td>
                    <td>{row.theme || t('research.unresolved')}</td>
                    <td>{row.method || t('research.unresolved')}</td>
                    <td>{row.year || t('research.unresolved')}</td>
                    <td>{listLabel(row.datasets, t('research.unresolved'))}</td>
                    <td>{listLabel(row.metrics, t('research.unresolved'))}</td>
                    <td><Badge status={row.code_availability} /></td>
                    <td><Badge status={row.evidence_status} /> <small>{t(evidenceLabel(row.evidence_status) as TranslationKey)}</small><details><summary>{t('research.source')}</summary><code>{row.evidence_ids.join(', ')}</code><br /><code>{row.claim_review_ids.join(', ')}</code></details></td>
                  </tr>)}</tbody>
                </table>
              </div>
            ) : <EmptyState text={t('research.noFilteredRows')} />}
          </div>
          <div className="section research-gap-panel">
            <SectionHeading title={t('research.gapTitle')} hint={t('research.gapHint')} extra={<Lightbulb size={16} className="muted" />} />
            <div className="form-grid gap-candidate-form">
              <label>{t('research.candidateType')}<select value={gapType} onChange={event => setGapType(event.target.value as typeof gapType)}><option value="gap">{t('research.gap')}</option><option value="cluster">{t('research.cluster')}</option><option value="duplicate_risk">{t('research.duplicateRisk')}</option></select></label>
              <label className="wide-field">{t('research.candidateStatement')}<textarea value={gapStatement} onChange={event => setGapStatement(event.target.value)} placeholder={t('research.candidatePlaceholder')} rows={3} /></label>
            </div>
            <ButtonRow><button className="secondary" type="button" disabled={working || !gapStatement.trim()} onClick={() => { void createGapCandidate() }}>{t('research.recordCandidate')}</button></ButtonRow>
            {status.gap_candidates.length ? <div className="data-list">{status.gap_candidates.map(candidate => <div className="data-row" key={candidate.id}><div><h3>{candidate.statement}</h3><p>{candidate.candidate_type} · {t('research.rowsCount', { count: candidate.row_ids.length })} · {statusLabel(candidate.evidence_status, t)}</p></div><ButtonRow><Badge status={candidate.status} />{candidate.status === 'candidate' ? <><button className="secondary" type="button" disabled={working} onClick={() => { void decideGap(candidate, 'accepted') }}>{t('research.keepCandidate')}</button><button className="secondary" type="button" disabled={working} onClick={() => { void decideGap(candidate, 'rejected') }}>{t('common.reject')}</button></> : null}</ButtonRow></div>)}</div> : <EmptyState text={t('research.noCandidates')} />}
          </div>
        </>
      ) : null}
    </>
  )
}
