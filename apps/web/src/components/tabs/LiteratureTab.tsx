import { useEffect, useState } from 'react'
import { ChevronsDown, Download, GitBranch, GitFork, ScanText, Search, ShieldCheck, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ClaimReview, MaterialSearchResponse, ProjectDetail, RelatedWorkCandidate, RelatedWorkFieldProvenance, RelatedWorkRun, Repository, RepositoryDiscovery, SearchCandidate, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, Modal, SectionHeading } from '../ui'

export function LiteratureTab({
  project,
  onRefresh,
  showToast,
  onNavigate,
  onRequestConfirm,
  searchCandidates,
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onNavigate: (tab: TabId) => void
  onRequestConfirm: (request: { title: string; description: string; confirmLabel: string; onConfirm: () => void }) => void
  searchCandidates: SearchCandidate[]
}) {
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialLoading, setMaterialLoading] = useState(false)
  const [materialRows, setMaterialRows] = useState<Array<Record<string, any>>>([])
  const [materialTotal, setMaterialTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [repoInputFor, setRepoInputFor] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const [repositoryDiscoveries, setRepositoryDiscoveries] = useState<Record<string, RepositoryDiscovery[]>>({})
  const [repositoryDiscoveryLoading, setRepositoryDiscoveryLoading] = useState<string | null>(null)
  const [claimText, setClaimText] = useState('')
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([])
  const [seedType, setSeedType] = useState<'doi' | 'title' | 'url' | 'bibtex' | 'artifact_pdf' | 'existing_paper'>('doi')
  const [seedValue, setSeedValue] = useState('')
  const [seedTitle, setSeedTitle] = useState('')
  const [seedArtifactId, setSeedArtifactId] = useState('')
  const [seedPaperId, setSeedPaperId] = useState('')
  const [seedLoading, setSeedLoading] = useState(false)
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>([])
  const [recursiveDepth, setRecursiveDepth] = useState(2)
  const [recursiveWidth, setRecursiveWidth] = useState(5)
  const [recursiveMaxTotal, setRecursiveMaxTotal] = useState(30)
  const [recursiveProviders, setRecursiveProviders] = useState<string[]>(['crossref', 'openalex', 'semantic_scholar'])
  const [recursiveReason, setRecursiveReason] = useState('扩展当前项目的相关工作引用网络')
  const [recursiveLoading, setRecursiveLoading] = useState(false)
  const [provenanceCandidateId, setProvenanceCandidateId] = useState<string | null>(null)

  const activeRecursiveRun = project.related_work_runs?.find(run => ['queued', 'running'].includes(run.status))

  const candidateProvenance = (candidateId: string) => (project.related_work_field_provenance || []).filter(item => item.candidate_id === candidateId)
  const provenanceCandidate = project.related_work_candidates?.find(candidate => candidate.id === provenanceCandidateId) || null

  const valueLabel = (value: unknown) => {
    if (value === null || value === undefined) return '未提供'
    if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 180)}…` : value
    try { return JSON.stringify(value) } catch { return String(value) }
  }

  const decideCandidate = async (candidate: RelatedWorkCandidate, decision: 'approved' | 'rejected' | 'reopened') => {
    try {
      await api(`/api/projects/${project.id}/related-work/candidates/${candidate.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: decision === 'approved' ? '用户确认该 metadata candidate 可进入项目 Paper' : decision === 'rejected' ? '用户拒绝该 metadata candidate' : '用户要求重新审阅该 candidate' }),
      })
      await onRefresh()
      showToast(decision === 'approved' ? '候选已转换为项目 Paper' : decision === 'rejected' ? '候选已拒绝并保留审计记录' : '候选已重新打开')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const requestCandidateDecision = (candidate: RelatedWorkCandidate, decision: 'approved' | 'rejected' | 'reopened') => {
    const labels = { approved: '确认 Paper', rejected: '拒绝候选', reopened: '重新打开' }
    onRequestConfirm({
      title: labels[decision],
      description: decision === 'approved' ? '确认后会创建当前项目范围内的 Paper；它仍然不是全文证据。' : '候选不会被物理删除，决定和原因会保留在项目审计中。',
      confirmLabel: labels[decision],
      onConfirm: () => { void decideCandidate(candidate, decision) },
    })
  }

  const selectCandidateField = async (candidate: RelatedWorkCandidate, field: RelatedWorkFieldProvenance) => {
    try {
      await api(`/api/projects/${project.id}/related-work/candidates/${candidate.id}/fields/${encodeURIComponent(field.field_name)}/select`, {
        method: 'POST',
        body: JSON.stringify({ provenance_id: field.id }),
      })
      await onRefresh()
      showToast(`已选择 ${field.field_name} 的 ${field.provider} 来源`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const proposeCandidateEnrichment = async (candidate: RelatedWorkCandidate) => {
    const fields = ['title', 'authors', 'abstract', 'venue', 'doi', 'year', 'institutions', 'pdf_url', 'bibtex']
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/related-work/candidate-enrichment`, {
        method: 'POST',
        body: JSON.stringify({ candidate_id: candidate.id, fields, providers: ['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv'], reason: '补全当前候选缺失字段并记录多源 provenance' }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(`字段补全 Proposal ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  useEffect(() => {
    if (!activeRecursiveRun) return
    const timer = window.setInterval(() => { void onRefresh() }, 3_000)
    return () => window.clearInterval(timer)
  }, [activeRecursiveRun?.id, activeRecursiveRun?.status, onRefresh])

  const resetSeedForm = () => {
    setSeedValue('')
    setSeedTitle('')
    setSeedArtifactId('')
    setSeedPaperId('')
  }

  const addSeed = async () => {
    const payload: Record<string, unknown> = { source_type: seedType, providers: ['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv'] }
    if (seedType === 'doi') payload.doi = seedValue.trim()
    if (seedType === 'title') payload.title = seedValue.trim()
    if (seedType === 'url') payload.url = seedValue.trim()
    if (seedType === 'bibtex') payload.bibtex = seedValue.trim()
    if (seedType === 'artifact_pdf') payload.artifact_id = seedArtifactId
    if (seedType === 'existing_paper') payload.paper_id = seedPaperId
    if (seedTitle.trim() && seedType !== 'title' && seedType !== 'existing_paper') payload.title = seedTitle.trim()
    if (seedType === 'artifact_pdf' && seedTitle.trim()) payload.title = seedTitle.trim()
    try {
      setSeedLoading(true)
      const result = await api<{ seed_id: string; status: string; candidate_ids?: string[]; attempts?: Array<{ provider: string; status: string }> }> (`/api/projects/${project.id}/related-work/seeds`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await onRefresh()
      resetSeedForm()
      showToast(`种子已记录：${result.status}，${result.candidate_ids?.length || 0} 个候选；provider 失败 ${result.attempts?.filter(item => item.status !== 'succeeded').length || 0}`)
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setSeedLoading(false)
    }
  }

  const createRecursivePlan = async () => {
    if (!selectedSeeds.length || !recursiveProviders.length) return
    try {
      setRecursiveLoading(true)
      const result = await api<{ proposal_id: string }> (`/api/projects/${project.id}/related-work/recursive-plan`, {
        method: 'POST',
        body: JSON.stringify({ seed_ids: selectedSeeds, depth: recursiveDepth, width: recursiveWidth, max_total: recursiveMaxTotal, providers: recursiveProviders, reason: recursiveReason.trim() }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(`递归检索 Proposal ${result.proposal_id.slice(0, 8)} 已创建，等待审批`)
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setRecursiveLoading(false)
    }
  }

  const cancelRecursiveRun = async (run: RelatedWorkRun) => {
    try {
      await api(`/api/projects/${project.id}/related-work/runs/${run.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: '用户在相关工作页面取消递归检索' }) })
      await onRefresh()
      showToast('递归检索已发出取消请求')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const toggleRecursiveProvider = (provider: string) => {
    setRecursiveProviders(current => current.includes(provider) ? current.filter(item => item !== provider) : [...current, provider])
  }

  const runSearch = async () => {
    try {
      showToast('正在并行检索多个学术来源与资源注册表…')
      const result = await api<{ resource_candidates?: SearchCandidate[]; provider_errors?: string[] }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({ project_id: project.id, limit: 8 }),
      })
      await onRefresh()
      showToast(`检索完成；${result.provider_errors?.length || 0} 个来源暂时失败，${result.resource_candidates?.length || 0} 条候选待核验`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const ingestEvidence = async () => {
    try {
      showToast('正在下载开放 PDF 并提取页码原文证据…')
      const result = await api<{ stored_count: number; errors: unknown[] }>(`/api/projects/${project.id}/evidence/ingest`, {
        method: 'POST',
        body: JSON.stringify({ limit: 3 }),
      })
      await onRefresh()
      showToast(`已保存 ${result.stored_count} 条全文证据；${result.errors.length} 条失败`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const searchMaterials = async (offset = 0, append = false) => {
    const query = materialQuery.trim()
    if (!query) return
    setMaterialLoading(true)
    try {
      const encoded = encodeURIComponent(query)
      const response = await api<MaterialSearchResponse>(
        `/api/projects/${project.id}/materials/search?q=${encoded}&limit=20&offset=${offset}`,
      )
      const rows = response.results || []
      setMaterialRows(previous => append ? [...previous, ...rows] : rows)
      setMaterialTotal(Number(response.total_matches || 0))
      setNextOffset(response.next_offset == null ? null : Number(response.next_offset))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setMaterialLoading(false)
    }
  }

  const addRepositoryCandidate = async (paperId: string, discoveredUrl?: string) => {
    const sourceUrl = (discoveredUrl || repoUrl).trim()
    if (!sourceUrl) return
    try {
      await api(`/api/projects/${project.id}/repositories`, {
        method: 'POST',
        body: JSON.stringify({ paper_id: paperId, source_url: sourceUrl }),
      })
      setRepoInputFor(null)
      setRepoUrl('')
      await onRefresh()
      showToast('代码仓库候选已添加，请执行交叉验证')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const discoverRepositories = async (paperId: string) => {
    setRepositoryDiscoveryLoading(paperId)
    try {
      const response = await api<{ candidates: RepositoryDiscovery[] }>(`/api/projects/${project.id}/papers/${paperId}/repositories/discover`)
      setRepositoryDiscoveries(previous => ({ ...previous, [paperId]: response.candidates }))
      if (!response.candidates.length) showToast('论文已保存的来源中没有明确的 GitHub/GitLab 链接；不会根据标题猜仓库')
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setRepositoryDiscoveryLoading(null)
    }
  }

  const verifyRepository = async (repositoryId: string) => {
    try {
      await api(`/api/projects/${project.id}/repositories/${repositoryId}/verify`, { method: 'POST' })
      await onRefresh()
      showToast('仓库双源验证完成')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const proposeRepositoryDownload = async (repositoryId: string) => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/repositories/${repositoryId}/download`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(`下载 Proposal ${result.proposal_id.slice(0, 8)} 已创建`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const createClaimReview = async () => {
    const claim = claimText.trim()
    if (!claim || !selectedEvidence.length) return
    try {
      await api(`/api/projects/${project.id}/claim-reviews`, {
        method: 'POST',
        body: JSON.stringify({ claim, evidence_ids: selectedEvidence }),
      })
      setClaimText('')
      setSelectedEvidence([])
      await onRefresh()
      showToast('Claim 已提交人工证据复核')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const decideClaimReview = async (review: ClaimReview, decision: 'accepted' | 'rejected') => {
    try {
      await api(`/api/projects/${project.id}/claim-reviews/${review.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, actor: 'local-user' }),
      })
      await onRefresh()
      showToast(decision === 'accepted' ? '人工复核已记录' : 'Claim 已标记为未通过复核')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const renderRepositoryActions = (repository: Repository) => {
    const verification = repository.metadata?.verification || {}
    const download = repository.metadata?.download
    const knownSpdx = verification.license_status === 'known_spdx'
    if (repository.verified_official && knownSpdx) {
      return download
        ? <span className="muted">已下载到 {download.relative_path || '项目代码目录'}</span>
        : <button className="secondary" type="button" onClick={() => proposeRepositoryDownload(repository.id)}>
            <Download size={15} />
            提出下载
          </button>
    }
    return (
      <button className="secondary" type="button" onClick={() => verifyRepository(repository.id)}>
        <ShieldCheck size={15} />
        交叉验证
      </button>
    )
  }

  return (
    <>
      <SectionHeading
        title="可验证文献记录"
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={runSearch}>
              <Search size={15} />
              更新检索
            </button>
            <button className="secondary" type="button" onClick={ingestEvidence}>
              <ScanText size={15} />
              提取全文证据
            </button>
          </ButtonRow>
        }
      />
      <div className="section related-work-seed-panel">
        <SectionHeading title="项目范围种子与引用网络" hint="种子只会进入当前项目的候选池；递归扩展必须先生成 Proposal 并获得批准。metadata candidate、全文证据和已确认 Paper 始终分开。" />
        <div className="related-work-seed-form">
          <label>
            种子类型
            <select value={seedType} onChange={event => { setSeedType(event.target.value as typeof seedType); resetSeedForm() }}>
              <option value="doi">DOI</option>
              <option value="title">标题</option>
              <option value="url">来源 URL</option>
              <option value="bibtex">BibTeX</option>
              <option value="artifact_pdf">受控 PDF Artifact</option>
              <option value="existing_paper">当前项目已有 Paper</option>
            </select>
          </label>
          {seedType === 'artifact_pdf' ? (
            <label>
              PDF Artifact
              <select value={seedArtifactId} onChange={event => setSeedArtifactId(event.target.value)}>
                <option value="">选择受控 PDF</option>
                {(project.artifacts || []).filter(artifact => artifact.mime_type === 'application/pdf' && artifact.valid !== false).map(artifact => (
                  <option value={artifact.id} key={artifact.id}>{artifact.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {seedType === 'existing_paper' ? (
            <label>
              项目 Paper
              <select value={seedPaperId} onChange={event => setSeedPaperId(event.target.value)}>
                <option value="">选择当前项目 Paper</option>
                {(project.papers || []).map(paper => <option value={paper.id} key={paper.id}>{paper.title}</option>)}
              </select>
            </label>
          ) : null}
          {seedType !== 'artifact_pdf' && seedType !== 'existing_paper' ? (
            <label className="related-work-seed-value">
              {seedType === 'doi' ? 'DOI' : seedType === 'title' ? '论文标题' : seedType === 'url' ? 'HTTPS 来源 URL' : 'BibTeX 条目'}
              {seedType === 'bibtex' ? (
                <textarea rows={5} maxLength={100_000} value={seedValue} onChange={event => setSeedValue(event.target.value)} placeholder="@article{...}" />
              ) : (
                <input maxLength={2_000} value={seedValue} onChange={event => setSeedValue(event.target.value)} placeholder={seedType === 'doi' ? '10.1000/example' : seedType === 'url' ? 'https://doi.org/...' : '输入论文标题'} />
              )}
            </label>
          ) : null}
          {seedType !== 'title' && seedType !== 'existing_paper' ? (
            <label>
              可选标题
              <input maxLength={2_000} value={seedTitle} onChange={event => setSeedTitle(event.target.value)} placeholder="用于补充元数据解析" />
            </label>
          ) : null}
          <button className="secondary" type="button" disabled={seedLoading || (seedType === 'artifact_pdf' ? !seedArtifactId : seedType === 'existing_paper' ? !seedPaperId : !seedValue.trim())} onClick={() => void addSeed()}>
            <GitFork size={15} />
            {seedLoading ? '正在解析…' : '添加并解析种子'}
          </button>
        </div>
        {project.related_work_seeds?.length ? (
          <div className="related-work-seeds">
            <div className="related-work-seed-list">
              {project.related_work_seeds.map(seed => (
                <label className="related-work-seed-row" key={seed.id}>
                  <input
                    type="checkbox"
                    checked={selectedSeeds.includes(seed.id)}
                    onChange={event => setSelectedSeeds(current => event.target.checked ? [...current, seed.id] : current.filter(id => id !== seed.id))}
                  />
                  <span>
                    <strong>{seed.input_summary}</strong>
                    <span>{seed.source_type} · {seed.status} · {seed.created_at ? new Date(seed.created_at).toLocaleString() : '时间未知'}</span>
                  </span>
                  <Badge status={seed.status} />
                </label>
              ))}
            </div>
            <div className="related-work-recursive-controls">
              <div className="control-grid">
                <label>层数<input type="number" min={1} max={5} value={recursiveDepth} onChange={event => setRecursiveDepth(Number(event.target.value))} /></label>
                <label>每层宽度<input type="number" min={1} max={50} value={recursiveWidth} onChange={event => setRecursiveWidth(Number(event.target.value))} /></label>
                <label>候选上限<input type="number" min={1} max={500} value={recursiveMaxTotal} onChange={event => setRecursiveMaxTotal(Number(event.target.value))} /></label>
              </div>
              <label>Proposal 原因<input maxLength={2_000} value={recursiveReason} onChange={event => setRecursiveReason(event.target.value)} /></label>
              <div className="provider-choice" aria-label="递归来源">
                {['crossref', 'openalex', 'semantic_scholar'].map(provider => (
                  <label key={provider}><input type="checkbox" checked={recursiveProviders.includes(provider)} onChange={() => toggleRecursiveProvider(provider)} />{provider}</label>
                ))}
              </div>
              <button className="secondary" type="button" disabled={recursiveLoading || !selectedSeeds.length || !recursiveProviders.length} onClick={() => void createRecursivePlan()}>
                <GitFork size={15} />
                {recursiveLoading ? '正在创建…' : `为 ${selectedSeeds.length} 个种子创建递归 Proposal`}
              </button>
            </div>
          </div>
        ) : <EmptyState text="还没有项目范围种子。先添加 DOI、标题、URL、BibTeX、受控 PDF 或已有 Paper。" />}
      </div>

      {project.related_work_runs?.length ? (
        <div className="section related-work-run-panel">
          <SectionHeading title="引用网络运行" hint="运行状态和 provider attempt 来自真实请求；失败、取消和上限截断不会被标记为成功。" />
          <div className="data-list">
            {project.related_work_runs.map(run => (
              <div className="data-row" key={run.id}>
                <div>
                  <h3>{run.status} · {run.discovered_count || 0} 个候选 · {run.edge_count || 0} 条引用边</h3>
                  <p>depth {run.depth} · width {run.width} · max_total {run.max_total} · providers {run.providers.join(', ')}</p>
                  {run.error ? <p className="error-text">{run.error}</p> : null}
                </div>
                <div className="button-row">
                  <Badge status={run.status} />
                  {['queued', 'running'].includes(run.status) ? <button className="secondary" type="button" onClick={() => void cancelRecursiveRun(run)}><Square size={14} />取消</button> : null}
                </div>
              </div>
            ))}
          </div>
          {project.related_work_attempts?.some(attempt => attempt.status !== 'succeeded') ? (
            <div className="related-work-failures">
              <h3>Provider 失败与部分失败</h3>
              {project.related_work_attempts.filter(attempt => attempt.status !== 'succeeded').slice(0, 12).map(attempt => (
                <p key={attempt.id || `${attempt.provider}-${attempt.query}-${attempt.finished_at}`}><strong>{attempt.provider}</strong> · {attempt.status} · {attempt.failure?.message || '未提供失败详情'}</p>
              ))}
            </div>
          ) : null}
          {project.related_work_edges?.length ? (
            <div className="citation-edge-list">
              <h3>引用图边（当前项目范围）</h3>
              {project.related_work_edges.slice(0, 20).map(edge => <p key={edge.id || `${edge.source_candidate_id}-${edge.target_candidate_id}-${edge.provider}`}><strong>{edge.source_title || edge.source_candidate_id}</strong> → {edge.target_title || edge.target_candidate_id} · {edge.provider} · {(edge.ranking_reasons || []).join(', ') || '无排序信号'}</p>)}
            </div>
          ) : null}
        </div>
      ) : null}
      {project.related_work_candidates?.length ? (
        <div className="section related-work-candidate-panel">
          <SectionHeading title="待确认 metadata candidate" hint="这些记录来自 provider 元数据和引用网络，尚未自动升级为已确认 Paper，也不能替代 PDF 页码 quote。" />
          <div className="data-list">
            {project.related_work_candidates.map(candidate => (
              <div className="data-row" key={candidate.id}>
                <div>
                  <h3>{candidate.title}</h3>
                  <p>{candidate.provider} · depth {candidate.discovery_depth ?? 0} · {candidate.year || '年份未知'} · DOI {candidate.normalized_doi || '未提供'} · {candidate.source_count || 0} 个 provider 证据</p>
                  {(() => {
                    const provenance = candidateProvenance(candidate.id)
                    const conflictFields = [...new Set(provenance.filter(item => item.status === 'conflict').map(item => item.field_name))]
                    return <p className="muted">字段来源 {provenance.length} 条 · {conflictFields.length ? `冲突：${conflictFields.join('、')}` : '暂无字段冲突'}</p>
                  })()}
                </div>
                <div className="button-row">
                  <Badge status={candidate.paper_id ? 'confirmed-paper' : candidate.status || 'metadata-candidate'} />
                  {candidateProvenance(candidate.id).length ? <button className="secondary" type="button" onClick={() => setProvenanceCandidateId(candidate.id)}>查看字段来源</button> : null}
                  {!candidate.paper_id && candidate.status !== 'rejected' ? (
                    <>
                      <button className="secondary" type="button" onClick={() => void proposeCandidateEnrichment(candidate)}>补全字段</button>
                      <button className="primary" type="button" onClick={() => requestCandidateDecision(candidate, 'approved')}>确认 Paper</button>
                      <button className="reject" type="button" onClick={() => requestCandidateDecision(candidate, 'rejected')}>拒绝</button>
                    </>
                  ) : null}
                  {!candidate.paper_id && candidate.status === 'rejected' ? <button className="secondary" type="button" onClick={() => requestCandidateDecision(candidate, 'reopened')}>重新打开</button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {provenanceCandidate ? (
        <Modal
          eyebrow="Field provenance"
          title={provenanceCandidate.title}
          description="选择来源只会更新当前项目候选的字段快照，并留下审计记录；它不会把 metadata candidate 自动变成全文证据。"
          onClose={() => setProvenanceCandidateId(null)}
          wide
        >
          <div className="provenance-drawer-list">
            {[...new Set(candidateProvenance(provenanceCandidate.id).map(item => item.field_name))].sort().map(fieldName => {
              const fields = candidateProvenance(provenanceCandidate.id).filter(item => item.field_name === fieldName)
              return (
                <section className="provenance-drawer-field" key={fieldName}>
                  <div className="provenance-drawer-field-heading">
                    <div><span className="eyebrow">字段</span><h3>{fieldName}</h3></div>
                    <Badge status={fields.some(item => item.status === 'conflict') ? 'conflict' : fields.some(item => item.status === 'selected') ? 'selected' : 'observed'} />
                  </div>
                  <div className="data-list">
                    {fields.map(field => (
                      <div className="data-row compact-row" key={field.id}>
                        <div>
                          <strong>{field.provider || field.source_type || '来源未记录'}{field.status === 'selected' ? ' · 已选' : ''}</strong>
                          <p>{valueLabel(field.normalized_value)}</p>
                          <p className="muted">source_type={field.source_type || 'unknown'} · attempt={field.source_attempt_id || '无'} · artifact={field.artifact_id || '无'} · locator={field.locator || '无'} · hash={field.raw_value_hash || '无'}</p>
                        </div>
                        {field.status !== 'selected' && !provenanceCandidate.paper_id ? <button className="secondary compact" type="button" onClick={() => void selectCandidateField(provenanceCandidate, field)}>选择此来源</button> : null}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </Modal>
      ) : null}
      {project.papers?.length ? (
        <div className="data-list">
          {project.papers.map(paper => (
            <div className="data-row" key={paper.id}>
              <div>
                <h3><a href={paper.source_url} target="_blank" rel="noreferrer">{paper.title}</a></h3>
                <p>
                  {paper.year || ''} {paper.venue || ''} · {paper.source_provider || 'unknown'} · DOI {paper.doi || '未提供'} ·
                  {paper.verified ? ' 元数据已验证' : ' 待验证'} · 页码原文证据 {paper.fulltext_evidence_count || 0} ·
                  代码候选 {(paper.code_repositories || []).length}
                </p>
                {paper.pdf_url ? <p><a href={paper.pdf_url} target="_blank" rel="noreferrer">打开来源 PDF</a></p> : null}
                {paper.bibtex ? (
                  <details>
                    <summary>BibTeX</summary>
                    <pre className="code-block">{paper.bibtex}</pre>
                  </details>
                ) : null}
              </div>
              <div className="button-row">
                <Badge status={Number(paper.fulltext_evidence_count || 0) > 0 ? 'fulltext-evidence' : 'metadata-only'} />
                <button className="secondary" type="button" disabled={repositoryDiscoveryLoading === paper.id} onClick={() => { void discoverRepositories(paper.id) }}>
                  <Search size={15} />
                  {repositoryDiscoveryLoading === paper.id ? '读取中…' : '查找论文中的代码链接'}
                </button>
                {repoInputFor === paper.id ? (
                  <span className="inline-repo-form">
                    <input
                      value={repoUrl}
                      placeholder="GitHub 或 GitLab HTTPS 地址"
                      onChange={event => setRepoUrl(event.target.value)}
                    />
                    <button className="secondary" type="button" onClick={() => addRepositoryCandidate(paper.id)}>添加</button>
                  </span>
                ) : (
                  <button className="secondary" type="button" onClick={() => { setRepoInputFor(paper.id); setRepoUrl('') }}>
                    <GitBranch size={15} />
                    添加代码仓库
                  </button>
                )}
              </div>
              {repositoryDiscoveries[paper.id]?.length ? (
                <div className="repository-discovery-list">
                  <p className="muted">以下链接来自该 Paper 已保存的 metadata/来源 URL，只是候选，仍需双源验证：</p>
                  {repositoryDiscoveries[paper.id].map(discovery => {
                    const exists = (paper.code_repositories || []).some(repository => repository.source_url === discovery.canonical_url)
                    return (
                      <div className="repository-discovery-row" key={discovery.canonical_url}>
                        <a href={discovery.canonical_url} target="_blank" rel="noreferrer">{discovery.canonical_url}</a>
                        <span className="muted">{discovery.locator}</span>
                        {exists ? <Badge status="candidate-exists" /> : <button className="secondary compact" type="button" onClick={() => { void addRepositoryCandidate(paper.id, discovery.canonical_url) }}>添加候选</button>}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="尚无文献记录。" />
      )}

      <div className="section material-search-panel">
        <SectionHeading title="项目材料库" hint="通过当前项目范围的 Supermemory 语义检索；结果保留来源和定位，只是未核验上下文候选，不是论文证据。" />
        <form
          className="material-search-form"
          onSubmit={event => {
            event.preventDefault()
            void searchMaterials(0, false)
          }}
        >
          <label className="sr-only" htmlFor="materialSearchQuery">检索材料</label>
          <input
            id="materialSearchQuery"
            maxLength={200}
            placeholder="检索已索引材料的语义内容"
            value={materialQuery}
            onChange={event => setMaterialQuery(event.target.value)}
          />
          <button className="secondary" type="submit">
            <Search size={15} />
            检索材料
          </button>
        </form>
        <div className="material-search-results">
          {materialLoading ? (
            <EmptyState text="正在检索材料…" />
          ) : materialRows.length ? (
            <>
              <p className="muted">{materialTotal} 个候选 · Supermemory 项目范围 hybrid 检索 · 不升级为全文证据</p>
              <div className="data-list">
                {materialRows.map((item, index) => (
                  <div className="data-row" key={index}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.kind || 'material'} · {item.parse_status || 'unknown'} · SHA-256 {String(item.sha256 || '').slice(0, 12)}… · 相似度 {String(item.similarity ?? '未提供')}</p>
                      <p className="muted">{item.snippet || '无可展示摘要'}</p>
                    </div>
                    <span className="badge pending">语义候选 · 未核验</span>
                  </div>
                ))}
              </div>
              {nextOffset != null ? (
                <button className="secondary material-search-more" type="button" onClick={() => searchMaterials(nextOffset, true)}>
                  <ChevronsDown size={15} />
                  加载更多
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState text="输入关键词检索当前项目的材料。" />
          )}
        </div>
      </div>

      <div className="section claim-review-panel">
        <SectionHeading title="Claim 到证据人工复核" hint="只能关联当前项目的页码 quote；接受复核不等于证明科学结论。" />
        {project.evidence?.length ? (
          <>
            <label className="claim-review-input">
              待复核 Claim
              <textarea
                value={claimText}
                maxLength={4_000}
                rows={3}
                placeholder="写出需要人工核对的具体研究陈述"
                onChange={event => setClaimText(event.target.value)}
              />
            </label>
            <div className="claim-review-evidence-list">
              {project.evidence.map(evidence => (
                <label className="claim-review-evidence" key={evidence.id}>
                  <input
                    type="checkbox"
                    checked={selectedEvidence.includes(evidence.id)}
                    onChange={event => setSelectedEvidence(current => event.target.checked
                      ? [...current, evidence.id]
                      : current.filter(id => id !== evidence.id))}
                  />
                  <span>
                    <strong>{evidence.locator || '未提供页码/章节'}</strong>
                    <span>{evidence.quote || '无 quote'}</span>
                  </span>
                </label>
              ))}
            </div>
            <button className="secondary" type="button" disabled={!claimText.trim() || !selectedEvidence.length} onClick={() => void createClaimReview()}>
              提交人工复核
            </button>
          </>
        ) : <EmptyState text="先摄取带页码定位的全文证据，再创建 Claim 复核。" />}
        {project.claim_reviews?.length ? (
          <div className="data-list claim-review-list">
            {project.claim_reviews.map(review => (
              <div className="data-row" key={review.id}>
                <div>
                  <h3>{review.claim}</h3>
                  <p>{review.evidence_ids.length} 条 quote · {review.evidence_status}</p>
                  {review.decision_comment ? <p className="muted">{review.decision_comment}</p> : null}
                </div>
                <div className="button-row">
                  <Badge status={review.status} />
                  {review.status === 'pending' ? (
                    <>
                      <button className="secondary" type="button" onClick={() => void decideClaimReview(review, 'accepted')}>接受复核</button>
                      <button className="secondary" type="button" onClick={() => void decideClaimReview(review, 'rejected')}>拒绝复核</button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {searchCandidates.length ? (
        <div className="section search-candidates">
          <SectionHeading title="外部资源候选" hint="仅供发现，尚未核验来源、许可、所有权或全文证据。" extra={<Badge>{`${searchCandidates.length} 条`}</Badge>} />
          <div className="data-list">
            {searchCandidates.map((item, index) => (
              <div className="data-row" key={index}>
                <div>
                  <h3><a href={item.url} target="_blank" rel="noreferrer">{item.name || item.title || item.url || '候选资源'}</a></h3>
                  <p>
                    {item.resource_type || 'resource'} · {item.provider || 'unknown'} · robots {item.compliance?.robots_status || 'unknown'}
                    {item.compliance?.terms_url ? <> · <a href={item.compliance.terms_url} target="_blank" rel="noreferrer">查看条款</a></> : null}
                  </p>
                  {item.snippet ? <p className="muted">{item.snippet}</p> : null}
                </div>
                <span className="badge pending">待核验</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {project.repositories?.length ? (
        <div className="section">
          <SectionHeading title="代码仓库候选" hint="只有论文记录与仓库引用形成双源匹配、许可证可识别且 commit 已固定后，才可提出下载。" />
          <div className="data-list">
            {project.repositories.map(repository => (
              <div className="data-row" key={repository.id}>
                <div>
                  <h3>{repository.source_url}</h3>
                  <p>
                    {repository.license_spdx || '未知许可证'} · commit {String(repository.commit_or_tag || '未固定').slice(0, 12)} ·
                    {repository.metadata?.verification?.match?.method || '未验证'}
                  </p>
                </div>
                <div className="button-row">
                  <Badge
                    status={
                      repository.verified_official
                        ? repository.metadata?.verification?.license_status === 'known_spdx'
                          ? 'verified'
                          : 'license-review-required'
                        : 'candidate-only'
                    }
                  />
                  {renderRepositoryActions(repository)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

    </>
  )
}
