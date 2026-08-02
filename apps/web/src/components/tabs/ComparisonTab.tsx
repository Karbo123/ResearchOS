import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitCompare, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { Paper, ProjectDetail, ReproductionRun, ResearchComparison } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading, statusLabel as localizedStatusLabel } from '../ui'
import { useTranslation, type TranslationKey } from '../../i18n'

type ComparisonTabProps = {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}

type ContextForm = {
  data_version: string
  datasets: string
  config_fingerprint: string
  seeds: string
  metric_definitions: string
}

const defaultContext = (): ContextForm => ({
  data_version: '',
  datasets: '[]',
  config_fingerprint: '',
  seeds: '',
  metric_definitions: '{}',
})

function completedRuns(project: ProjectDetail): ReproductionRun[] {
  return (project.reproduction_runs || []).filter(run => run.status === 'completed' && (run.artifact_ids || []).length > 0)
}

function candidateLabel(type: string): string {
  const labels: Record<string, TranslationKey> = {
    innovation: 'comparison.innovation',
    potential_improvement: 'comparison.potentialImprovement',
    potential_regression: 'comparison.potentialRegression',
    counterexample: 'comparison.counterexample',
    difference: 'comparison.difference',
    comparability_gap: 'comparison.comparabilityGap',
    research_gap: 'comparison.researchGap',
  }
  return labels[type] || type
}

function statusLabel(status: string): string {
  const labels: Record<string, TranslationKey> = { comparable: 'comparison.comparable', partial: 'comparison.partial', blocked: 'comparison.blocked', candidate: 'comparison.candidate', accepted: 'comparison.accepted', rejected: 'comparison.rejected' }
  return labels[status] || status
}

function metricNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toPrecision(8).replace(/0+$/, '').replace(/\.$/, '') : 'comparison.metricUnrecorded'
}

function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value) } catch { throw new Error(label) }
}

export function ComparisonTab({ project, onRefresh, showToast }: ComparisonTabProps) {
  const { t } = useTranslation()
  const papers = useMemo(() => (project.papers || []).filter(paper => paper.confirmed === true), [project.papers])
  const runs = useMemo(() => completedRuns(project), [project.reproduction_runs])
  const [paperId, setPaperId] = useState('')
  const [runId, setRunId] = useState('')
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [paperMetrics, setPaperMetrics] = useState('{\n  "accuracy": {\n    "value": 0,\n    "evidence_ids": [],\n    "direction": "higher_is_better",\n    "definition": null\n  }\n}')
  const [context, setContext] = useState<ContextForm>(defaultContext)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPaper = papers.find(paper => paper.id === paperId) || null
  const paperEvidence = useMemo(() => (project.evidence || []).filter(item => item.paper_id === paperId && Boolean(item.locator?.trim())), [project.evidence, paperId])
  const comparisons = project.research_comparisons || []

  useEffect(() => {
    if (!paperId && papers[0]) setPaperId(papers[0].id)
    if (!runId && runs[0]) setRunId(runs[0].id)
  }, [papers, runs, paperId, runId])

  useEffect(() => {
    setEvidenceIds(current => current.filter(id => paperEvidence.some(evidence => evidence.id === id)))
  }, [paperEvidence])

  const createComparison = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!paperId || !runId || !evidenceIds.length) throw new Error(t('comparison.selectRequired'))
      const metrics = parseJson(paperMetrics, t('comparison.paperMetricsLabel'))
      const datasets = parseJson(context.datasets || '[]', t('comparison.datasetsLabel'))
      const definitions = parseJson(context.metric_definitions || '{}', t('comparison.definitionsLabel'))
      const seeds = context.seeds.trim() ? context.seeds.split(',').map(item => Number(item.trim())) : null
      if (seeds && seeds.some(seed => !Number.isInteger(seed))) throw new Error(t('comparison.seedsInvalid'))
      await api(`/api/projects/${project.id}/research-comparisons`, {
        method: 'POST',
        body: JSON.stringify({
          paper_id: paperId,
          reproduction_run_id: runId,
          evidence_ids: evidenceIds,
          paper_metrics: metrics,
          paper_context: {
            data_version: context.data_version.trim() || null,
            datasets,
            config_fingerprint: context.config_fingerprint.trim() || null,
            seeds,
            metric_definitions: definitions,
          },
          reason: t('comparison.reason'),
        }),
      })
      await onRefresh()
      showToast(t('comparison.saved'))
    } catch (requestError) {
      const message = errorMessage(requestError)
      setError(message)
      showToast(message)
    } finally { setBusy(false) }
  }

  const decideCandidate = async (comparisonId: string, candidateId: string, decision: 'accepted' | 'rejected') => {
    setBusy(true)
    try {
      await api(`/api/projects/${project.id}/research-comparisons/${comparisonId}/candidates/${candidateId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: decision === 'accepted' ? t('comparison.acceptReason') : t('comparison.rejectReason') }),
      })
      await onRefresh()
      showToast(decision === 'accepted' ? t('comparison.acceptedToast') : t('comparison.rejectedToast'))
    } catch (requestError) { showToast(errorMessage(requestError)) } finally { setBusy(false) }
  }

  const toggleEvidence = (id: string) => setEvidenceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])

  return (
    <>
      <SectionHeading
        title={t('comparison.title')}
        hint={t('comparison.hint')}
        extra={<ButtonRow><button className="secondary" type="button" disabled={busy} onClick={() => { void onRefresh() }}><RefreshCw size={15} />{t('topbar.refresh')}</button></ButtonRow>}
      />
      <div className="section comparison-scope">
        <div className="data-row compact-row"><div><strong>{t('comparison.projectScope')}</strong><p><code>{project.id}</code></p></div><Badge status="project-scoped" /></div>
        <p className="muted">{t('comparison.scopeCounts', { papers: papers.length, runs: runs.length, comparisons: comparisons.length })}</p>
      </div>
      {!papers.length || !runs.length ? <EmptyState text={t('comparison.empty')} /> : null}
      <div className="section comparison-form-panel">
        <SectionHeading title={t('comparison.createTitle')} hint={t('comparison.createHint')} extra={<GitCompare size={16} className="muted" />} />
        <div className="form-grid two-up">
          <label>{t('comparison.confirmedPaper')}<select value={paperId} onChange={event => { setPaperId(event.target.value); setEvidenceIds([]) }}><option value="">{t('common.select')}</option>{papers.map(paper => <option value={paper.id} key={paper.id}>{paper.title}</option>)}</select></label>
          <label>{t('comparison.reproductionRun')}<select value={runId} onChange={event => setRunId(event.target.value)}><option value="">{t('common.select')}</option>{runs.map(run => <option value={run.id} key={run.id}>Run {run.id.slice(0, 8)} · seeds {run.random_seeds.join(', ')}</option>)}</select></label>
        </div>
        <div className="comparison-evidence-picker">
          <strong>{t('comparison.paperEvidence')}</strong>
          {selectedPaper && paperEvidence.length ? paperEvidence.map(evidence => <label className="comparison-evidence-option" key={evidence.id}><input type="checkbox" checked={evidenceIds.includes(evidence.id)} onChange={() => toggleEvidence(evidence.id)} /><span>{evidence.locator} · {evidence.claim || t('comparison.unnamedClaim')}<small>{evidence.metadata?.pdf_sha256 ? `SHA-256 ${String(evidence.metadata.pdf_sha256).slice(0, 12)}…` : t('comparison.missingPdfHash')}</small></span></label>) : <p className="muted">{t('comparison.noLocatedEvidence')}</p>}
        </div>
        <label>{t('comparison.paperMetricsJson')}<textarea rows={7} value={paperMetrics} onChange={event => setPaperMetrics(event.target.value)} /></label>
        <div className="form-grid two-up">
          <label>{t('comparison.dataVersion')}<input value={context.data_version} onChange={event => setContext(current => ({ ...current, data_version: event.target.value }))} placeholder={t('comparison.dataVersionPlaceholder')} /></label>
          <label>{t('comparison.configFingerprint')}<input value={context.config_fingerprint} onChange={event => setContext(current => ({ ...current, config_fingerprint: event.target.value }))} placeholder={t('comparison.configPlaceholder')} /></label>
          <label>{t('comparison.datasetsJson')}<input value={context.datasets} onChange={event => setContext(current => ({ ...current, datasets: event.target.value }))} /></label>
          <label>{t('comparison.seedsLabel')}<input value={context.seeds} onChange={event => setContext(current => ({ ...current, seeds: event.target.value }))} placeholder={t('comparison.seedsPlaceholder')} /></label>
        </div>
        <label>{t('comparison.definitionsJson')}<textarea rows={3} value={context.metric_definitions} onChange={event => setContext(current => ({ ...current, metric_definitions: event.target.value }))} placeholder={t('comparison.definitionsPlaceholder')} /></label>
        {error ? <div className="inline-warning" role="alert"><AlertTriangle size={15} />{error}</div> : null}
        <ButtonRow><button className="primary" type="button" disabled={busy || !papers.length || !runs.length} onClick={() => { void createComparison() }}><ShieldCheck size={15} />{t('comparison.save')}</button></ButtonRow>
      </div>
      <div className="section comparison-results">
        <SectionHeading title={t('comparison.savedTitle')} hint={t('comparison.savedHint')} />
        {comparisons.length ? <div className="data-list">{comparisons.map(comparison => <ComparisonCard key={comparison.id} comparison={comparison} busy={busy} onDecide={decideCandidate} />)}</div> : <EmptyState text={t('comparison.savedEmpty')} />}
      </div>
    </>
  )
}

function ComparisonCard({ comparison, busy, onDecide }: { comparison: ResearchComparison; busy: boolean; onDecide: (comparisonId: string, candidateId: string, decision: 'accepted' | 'rejected') => Promise<void> }) {
  const { t } = useTranslation()
  const metrics = Object.entries(comparison.metric_comparisons || {})
  const snapshot = comparison.source_snapshot || {}
  const reproduction = (snapshot.reproduction_run || {}) as Record<string, unknown>
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts as Array<Record<string, unknown>> : []
  return (
    <article className="data-row comparison-card">
      <div className="comparison-card-heading"><div><h3>Paper {comparison.paper_id.slice(0, 8)} · Run {comparison.reproduction_run_id.slice(0, 8)}</h3><p>{t('comparison.inputHash')} <code>{comparison.input_hash || t('common.unrecorded')}</code></p></div><Badge status={comparison.status}>{t(statusLabel(comparison.status) as TranslationKey)}</Badge></div>
      {comparison.blocking_reasons?.length ? <div className="inline-warning"><AlertTriangle size={15} />{comparison.blocking_reasons.join(', ')}</div> : null}
      <div className="comparison-provenance"><span>commit <code>{String(reproduction.source_commit || t('common.unrecorded'))}</code></span><span>seeds {Array.isArray(reproduction.random_seeds) ? reproduction.random_seeds.join(', ') : t('common.unrecorded')}</span><span>{t('comparison.artifactsCount', { count: artifacts.length })}</span></div>
      {metrics.length ? <div className="comparison-metrics"><table><thead><tr><th>{t('comparison.metric')}</th><th>{t('comparison.paper')}</th><th>{t('comparison.reproductionMean')}</th><th>std</th><th>delta</th><th>{t('comparison.status')}</th></tr></thead><tbody>{metrics.map(([name, metric]) => <tr key={name}><td>{name}</td><td>{t(metricNumber(metric.paper_value) as TranslationKey)}</td><td>{t(metricNumber(metric.reproduction_mean) as TranslationKey)}</td><td>{t(metricNumber(metric.reproduction_population_std) as TranslationKey)}</td><td>{t(metricNumber(metric.delta) as TranslationKey)}</td><td><Badge status={metric.status}>{t(statusLabel(metric.status) as TranslationKey)}</Badge></td></tr>)}</tbody></table></div> : null}
      {comparison.candidates?.length ? <div className="comparison-candidates">{comparison.candidates.map(candidate => <div className="data-row compact-row" key={candidate.id}><div><strong>{t(candidateLabel(candidate.candidate_type) as TranslationKey)}</strong><p>{candidate.statement}</p><small>{t('comparison.evidenceStatus')} {localizedStatusLabel(candidate.evidence_status, t)} · {t('comparison.candidateId')} <code>{candidate.id.slice(0, 8)}</code></small></div><ButtonRow><Badge status={candidate.status}>{t(statusLabel(candidate.status) as TranslationKey)}</Badge>{candidate.status === 'candidate' ? <><button className="secondary" type="button" disabled={busy} onClick={() => { void onDecide(comparison.id, candidate.id, 'accepted') }}>{t('comparison.keep')}</button><button className="secondary" type="button" disabled={busy} onClick={() => { void onDecide(comparison.id, candidate.id, 'rejected') }}>{t('common.reject')}</button></> : null}</ButtonRow></div>)}</div> : <p className="muted">{t('comparison.noCandidates')}</p>}
    </article>
  )
}
