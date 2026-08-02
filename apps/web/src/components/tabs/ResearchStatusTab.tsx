import { useEffect, useMemo, useState } from 'react'
import { Download, Filter, Lightbulb, RefreshCw, Table2 } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, ResearchStatusGapCandidate, ResearchStatusResponse } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'

function listLabel(values: string[]) {
  return values.length ? values.join('、') : 'unresolved'
}

function evidenceLabel(status: string) {
  if (status === 'claim_reviewed') return '已审阅 Claim'
  if (status === 'page_quote') return '定位 quote'
  return '仅 metadata'
}

export function ResearchStatusTab({
  project,
  showToast,
}: {
  project: ProjectDetail
  showToast: (message: string) => void
}) {
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
      showToast('当前没有同时满足确认 Paper、定位 Evidence 和 accepted ClaimReview 的材料。')
      return
    }
    setWorking(true)
    try {
      const created = await api<ResearchStatusResponse>(`/api/projects/${project.id}/research-status/matrices`, {
        method: 'POST',
        body: JSON.stringify({ rows: eligibleRows }),
      })
      setStatus(created)
      showToast('研究现状矩阵已建立，未记录的字段保持 unresolved。')
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
      showToast('候选已记录，仍需人工判断，不代表研究结论。')
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
        body: JSON.stringify({ decision, reason: decision === 'accepted' ? '用户确认保留为待核验候选。' : '用户拒绝该待核验候选。' }),
      })
      await loadStatus()
      showToast(decision === 'accepted' ? '候选已确认保留，仍未升级为科学结论。' : '候选已拒绝并保留审计记录。')
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
        title="研究现状矩阵"
        hint="矩阵只接受当前项目已确认的 Paper、带页码/章节定位的 Evidence 和已接受 ClaimReview；未知字段不会由模型或 metadata 猜测。"
        extra={
          <ButtonRow>
            <button className="secondary" type="button" disabled={loading || working} onClick={() => { void loadStatus(); showToast('正在刷新项目范围研究现状…') }}>
              <RefreshCw size={15} />
              刷新
            </button>
            <button className="primary" type="button" disabled={working || Boolean(matrix)} onClick={() => { void createMatrix() }}>
              <Table2 size={15} />
              {matrix ? '矩阵已建立' : '建立矩阵'}
            </button>
          </ButtonRow>
        }
      />
      <div className="section research-status-scope">
        <div className="data-row compact-row">
          <div><strong>Project scope</strong><p><code>{project.id}</code></p></div>
          <Badge status={status?.permission_status || 'project-scoped'} />
        </div>
        <p className="muted">可建立行：{eligibleRows.length} · 当前矩阵行：{matrix?.rows.length || 0} · 当前 Idea v{project.current_idea_version || 1}</p>
      </div>
      <div className="section research-status-filters">
        <SectionHeading title="筛选矩阵" hint="筛选只影响当前项目返回的数据，不会改变证据或候选状态。" extra={<Filter size={16} className="muted" />} />
        <div className="form-grid three-up">
          <label>主题<input value={theme} onChange={event => setTheme(event.target.value)} placeholder="例如 efficient adaptation" /></label>
          <label>方法<input value={method} onChange={event => setMethod(event.target.value)} placeholder="例如 parameter-efficient tuning" /></label>
          <label>年份<input inputMode="numeric" value={year} onChange={event => setYear(event.target.value)} placeholder="2024" /></label>
        </div>
        <ButtonRow><button className="secondary" type="button" disabled={loading} onClick={() => { void loadStatus(); showToast('已应用矩阵筛选。') }}>应用筛选</button></ButtonRow>
      </div>
      {loading ? <EmptyState text="正在读取当前项目的研究现状数据…" /> : null}
      {error ? <EmptyState text={`研究现状请求失败：${error}`} /> : null}
      {!loading && !error && status && !matrix ? <EmptyState text={status.limitations[0] || '尚未创建研究现状矩阵。'} action={<button className="secondary" type="button" disabled={working || !eligibleRows.length} onClick={() => { void createMatrix() }}>从已审阅材料建立</button>} /> : null}
      {!loading && !error && matrix ? (
        <>
          <div className="section research-status-matrix-panel">
            <SectionHeading title={`矩阵 v${matrix.idea_version}`} hint={`创建者：${matrix.created_by} · ${new Date(matrix.created_at).toLocaleString()}`} extra={<ButtonRow><a className="secondary" href={exportUrl('csv')} download><Download size={15} />CSV</a><a className="secondary" href={exportUrl('markdown')} download><Download size={15} />Markdown</a><a className="secondary" href={exportUrl('json')} download><Download size={15} />JSON</a></ButtonRow>} />
            {matrix.rows.length ? (
              <div className="research-status-table-wrap">
                <table className="research-status-table">
                  <thead><tr><th>Paper</th><th>主题</th><th>方法</th><th>年份</th><th>数据集</th><th>指标</th><th>代码</th><th>证据</th></tr></thead>
                  <tbody>{matrix.rows.map(row => <tr key={row.id}>
                    <td><strong>{row.paper?.title || row.paper_id}</strong><small>{row.paper?.doi || 'DOI 未记录'}</small></td>
                    <td>{row.theme || 'unresolved'}</td>
                    <td>{row.method || 'unresolved'}</td>
                    <td>{row.year || 'unresolved'}</td>
                    <td>{listLabel(row.datasets)}</td>
                    <td>{listLabel(row.metrics)}</td>
                    <td><Badge status={row.code_availability} /></td>
                    <td><Badge status={row.evidence_status} /> <small>{evidenceLabel(row.evidence_status)}</small><details><summary>来源</summary><code>{row.evidence_ids.join(', ')}</code><br /><code>{row.claim_review_ids.join(', ')}</code></details></td>
                  </tr>)}</tbody>
                </table>
              </div>
            ) : <EmptyState text="筛选后没有矩阵行。" />}
          </div>
          <div className="section research-gap-panel">
            <SectionHeading title="研究空白与相似主题候选" hint="这里的记录只是待核验候选；接受候选表示保留跟进，不表示已经证明存在研究空白或重复。" extra={<Lightbulb size={16} className="muted" />} />
            <div className="form-grid gap-candidate-form">
              <label>候选类型<select value={gapType} onChange={event => setGapType(event.target.value as typeof gapType)}><option value="gap">研究空白</option><option value="cluster">主题聚类</option><option value="duplicate_risk">重复风险</option></select></label>
              <label className="wide-field">候选陈述<textarea value={gapStatement} onChange={event => setGapStatement(event.target.value)} placeholder="写下需要核验的候选，不要写成已经证明的结论。" rows={3} /></label>
            </div>
            <ButtonRow><button className="secondary" type="button" disabled={working || !gapStatement.trim()} onClick={() => { void createGapCandidate() }}>记录待核验候选</button></ButtonRow>
            {status.gap_candidates.length ? <div className="data-list">{status.gap_candidates.map(candidate => <div className="data-row" key={candidate.id}><div><h3>{candidate.statement}</h3><p>{candidate.candidate_type} · {candidate.row_ids.length} 个矩阵行 · {candidate.evidence_status}</p></div><ButtonRow><Badge status={candidate.status} />{candidate.status === 'candidate' ? <><button className="secondary" type="button" disabled={working} onClick={() => { void decideGap(candidate, 'accepted') }}>保留候选</button><button className="secondary" type="button" disabled={working} onClick={() => { void decideGap(candidate, 'rejected') }}>拒绝</button></> : null}</ButtonRow></div>)}</div> : <EmptyState text="尚未记录待核验候选。" />}
          </div>
        </>
      ) : null}
    </>
  )
}
