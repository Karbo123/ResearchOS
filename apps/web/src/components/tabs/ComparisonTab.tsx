import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitCompare, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { Paper, ProjectDetail, ReproductionRun, ResearchComparison } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'

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
  const labels: Record<string, string> = {
    innovation: '潜在创新信号',
    potential_improvement: '潜在改善信号',
    potential_regression: '潜在回归信号',
    counterexample: '反例信号',
    difference: '数值差异',
    comparability_gap: '可比性缺口',
    research_gap: '待核验研究空白',
  }
  return labels[type] || type
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { comparable: '可比', partial: '部分可比', blocked: '不可比/阻塞', candidate: '待核验候选', accepted: '已保留候选', rejected: '已拒绝' }
  return labels[status] || status
}

function metricNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toPrecision(8).replace(/0+$/, '').replace(/\.$/, '') : '未记录'
}

function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value) } catch { throw new Error(`${label}必须是有效 JSON`) }
}

export function ComparisonTab({ project, onRefresh, showToast }: ComparisonTabProps) {
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
      if (!paperId || !runId || !evidenceIds.length) throw new Error('请选择已确认 Paper、已完成复现 Run 和至少一条定位 Evidence')
      const metrics = parseJson(paperMetrics, '论文指标')
      const datasets = parseJson(context.datasets || '[]', '数据集')
      const definitions = parseJson(context.metric_definitions || '{}', '指标定义')
      const seeds = context.seeds.trim() ? context.seeds.split(',').map(item => Number(item.trim())) : null
      if (seeds && seeds.some(seed => !Number.isInteger(seed))) throw new Error('论文 seeds 必须是逗号分隔的整数')
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
          reason: '用户请求比较论文报告指标与固定 commit 的真实复现输出',
        }),
      })
      await onRefresh()
      showToast('比较记录已保存；候选仍需人工核验，不是科学结论')
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
        body: JSON.stringify({ decision, reason: decision === 'accepted' ? '保留为待核验候选，后续需要独立验证。' : '当前证据不足，拒绝该候选。' }),
      })
      await onRefresh()
      showToast(decision === 'accepted' ? '候选已保留，仍未升级为研究结论' : '候选已拒绝并保留审计记录')
    } catch (requestError) { showToast(errorMessage(requestError)) } finally { setBusy(false) }
  }

  const toggleEvidence = (id: string) => setEvidenceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])

  return (
    <>
      <SectionHeading
        title="复现效果比较"
        hint="只比较当前项目已确认 Paper、带定位和哈希的 Evidence，以及已登记 Artifact 的真实复现 Run。结果是 integration result；潜在改善、反例和创新信号都必须人工核验。"
        extra={<ButtonRow><button className="secondary" type="button" disabled={busy} onClick={() => { void onRefresh() }}><RefreshCw size={15} />刷新</button></ButtonRow>}
      />
      <div className="section comparison-scope">
        <div className="data-row compact-row"><div><strong>项目范围</strong><p><code>{project.id}</code></p></div><Badge status="project-scoped" /></div>
        <p className="muted">可比较 Paper：{papers.length} · 已完成且有 Artifact 的复现：{runs.length} · 已保存比较：{comparisons.length}</p>
      </div>
      {!papers.length || !runs.length ? <EmptyState text="创建比较前，需要已确认 Paper，以及 completed 且已登记输出 Artifact 的复现 Run。" /> : null}
      <div className="section comparison-form-panel">
        <SectionHeading title="创建结构化比较" hint="论文指标必须由用户从有定位的 Evidence 中录入；系统不会从模型或标题猜测指标。" extra={<GitCompare size={16} className="muted" />} />
        <div className="form-grid two-up">
          <label>确认的 Paper<select value={paperId} onChange={event => { setPaperId(event.target.value); setEvidenceIds([]) }}><option value="">请选择</option>{papers.map(paper => <option value={paper.id} key={paper.id}>{paper.title}</option>)}</select></label>
          <label>复现 Run<select value={runId} onChange={event => setRunId(event.target.value)}><option value="">请选择</option>{runs.map(run => <option value={run.id} key={run.id}>Run {run.id.slice(0, 8)} · seeds {run.random_seeds.join(', ')}</option>)}</select></label>
        </div>
        <div className="comparison-evidence-picker">
          <strong>论文 Evidence</strong>
          {selectedPaper && paperEvidence.length ? paperEvidence.map(evidence => <label className="comparison-evidence-option" key={evidence.id}><input type="checkbox" checked={evidenceIds.includes(evidence.id)} onChange={() => toggleEvidence(evidence.id)} /><span>{evidence.locator} · {evidence.claim || '未命名 claim'}<small>{evidence.metadata?.pdf_sha256 ? `SHA-256 ${String(evidence.metadata.pdf_sha256).slice(0, 12)}…` : '缺少 PDF hash'}</small></span></label>) : <p className="muted">当前 Paper 没有带定位的 Evidence。</p>}
        </div>
        <label>论文指标 JSON<textarea rows={7} value={paperMetrics} onChange={event => setPaperMetrics(event.target.value)} /></label>
        <div className="form-grid two-up">
          <label>论文数据版本<input value={context.data_version} onChange={event => setContext(current => ({ ...current, data_version: event.target.value }))} placeholder="没有披露则留空，比较会标记 partial" /></label>
          <label>论文配置 SHA-256<input value={context.config_fingerprint} onChange={event => setContext(current => ({ ...current, config_fingerprint: event.target.value }))} placeholder="没有固定配置则留空" /></label>
          <label>论文 datasets JSON<input value={context.datasets} onChange={event => setContext(current => ({ ...current, datasets: event.target.value }))} /></label>
          <label>论文 seeds<input value={context.seeds} onChange={event => setContext(current => ({ ...current, seeds: event.target.value }))} placeholder="13,37,73；没有披露则留空" /></label>
        </div>
        <label>指标定义 JSON<textarea rows={3} value={context.metric_definitions} onChange={event => setContext(current => ({ ...current, metric_definitions: event.target.value }))} placeholder='例如 {"accuracy":"top-1 accuracy"}' /></label>
        {error ? <div className="inline-warning" role="alert"><AlertTriangle size={15} />{error}</div> : null}
        <ButtonRow><button className="primary" type="button" disabled={busy || !papers.length || !runs.length} onClick={() => { void createComparison() }}><ShieldCheck size={15} />保存比较</button></ButtonRow>
      </div>
      <div className="section comparison-results">
        <SectionHeading title="已保存比较与待核验候选" hint="每个数值都显示论文 Evidence、复现 commit、seed、配置和 Artifact 绑定；接受候选只表示保留审阅任务。" />
        {comparisons.length ? <div className="data-list">{comparisons.map(comparison => <ComparisonCard key={comparison.id} comparison={comparison} busy={busy} onDecide={decideCandidate} />)}</div> : <EmptyState text="当前项目还没有效果比较记录。" />}
      </div>
    </>
  )
}

function ComparisonCard({ comparison, busy, onDecide }: { comparison: ResearchComparison; busy: boolean; onDecide: (comparisonId: string, candidateId: string, decision: 'accepted' | 'rejected') => Promise<void> }) {
  const metrics = Object.entries(comparison.metric_comparisons || {})
  const snapshot = comparison.source_snapshot || {}
  const reproduction = (snapshot.reproduction_run || {}) as Record<string, unknown>
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts as Array<Record<string, unknown>> : []
  return (
    <article className="data-row comparison-card">
      <div className="comparison-card-heading"><div><h3>Paper {comparison.paper_id.slice(0, 8)} · Run {comparison.reproduction_run_id.slice(0, 8)}</h3><p>输入 hash <code>{comparison.input_hash || '未记录'}</code></p></div><Badge status={comparison.status}>{statusLabel(comparison.status)}</Badge></div>
      {comparison.blocking_reasons?.length ? <div className="inline-warning"><AlertTriangle size={15} />{comparison.blocking_reasons.join('、')}</div> : null}
      <div className="comparison-provenance"><span>commit <code>{String(reproduction.source_commit || '未记录')}</code></span><span>seeds {Array.isArray(reproduction.random_seeds) ? reproduction.random_seeds.join(', ') : '未记录'}</span><span>Artifacts {artifacts.length} 个</span></div>
      {metrics.length ? <div className="comparison-metrics"><table><thead><tr><th>指标</th><th>论文</th><th>复现 mean</th><th>std</th><th>delta</th><th>状态</th></tr></thead><tbody>{metrics.map(([name, metric]) => <tr key={name}><td>{name}</td><td>{metricNumber(metric.paper_value)}</td><td>{metricNumber(metric.reproduction_mean)}</td><td>{metricNumber(metric.reproduction_population_std)}</td><td>{metricNumber(metric.delta)}</td><td><Badge status={metric.status}>{statusLabel(metric.status)}</Badge></td></tr>)}</tbody></table></div> : null}
      {comparison.candidates?.length ? <div className="comparison-candidates">{comparison.candidates.map(candidate => <div className="data-row compact-row" key={candidate.id}><div><strong>{candidateLabel(candidate.candidate_type)}</strong><p>{candidate.statement}</p><small>Evidence 状态：{candidate.evidence_status} · 候选 ID <code>{candidate.id.slice(0, 8)}</code></small></div><ButtonRow><Badge status={candidate.status}>{statusLabel(candidate.status)}</Badge>{candidate.status === 'candidate' ? <><button className="secondary" type="button" disabled={busy} onClick={() => { void onDecide(comparison.id, candidate.id, 'accepted') }}>保留</button><button className="secondary" type="button" disabled={busy} onClick={() => { void onDecide(comparison.id, candidate.id, 'rejected') }}>拒绝</button></> : null}</ButtonRow></div>)}</div> : <p className="muted">没有自动生成的差异信号。</p>}
    </article>
  )
}
