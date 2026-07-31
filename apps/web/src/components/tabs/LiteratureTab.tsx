import { useEffect, useState } from 'react'
import { ChevronsDown, Download, GitBranch, ScanText, Search, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { MaterialSearchResponse, NoveltyAnalysis, ProjectDetail, Repository, SearchCandidate, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'

export function LiteratureTab({
  project,
  onRefresh,
  showToast,
  onNavigate,
  searchCandidates,
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onNavigate: (tab: TabId) => void
  searchCandidates: SearchCandidate[]
}) {
  const [novelty, setNovelty] = useState<NoveltyAnalysis | null>(null)
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialLoading, setMaterialLoading] = useState(false)
  const [materialRows, setMaterialRows] = useState<Array<Record<string, any>>>([])
  const [materialTotal, setMaterialTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [repoInputFor, setRepoInputFor] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState('')

  useEffect(() => {
    setNovelty(null)
    api<NoveltyAnalysis>(`/api/projects/${project.id}/novelty`)
      .then(setNovelty)
      .catch(() => setNovelty(null))
  }, [project.id])

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

  const addRepositoryCandidate = async (paperId: string) => {
    const sourceUrl = repoUrl.trim()
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

  const noveltyList = (items?: Array<Record<string, any>>, empty = '当前没有已标记的覆盖候选。') =>
    items && items.length ? (
      <div className="data-list">
        {items.map((item, index) => (
          <div className="data-row" key={index}>
            <div>
              <h3>{item.title || item.target || item.statement || '候选'}</h3>
              <p>{item.note || item.basis || item.statement || ''}</p>
            </div>
            <Badge status={item.status || 'candidate_only'} />
          </div>
        ))}
      </div>
    ) : (
      <EmptyState text={empty} />
    )

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
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="尚无文献记录。" />
      )}

      <div className="section material-search-panel">
        <SectionHeading title="项目材料库" hint="只检索已扫描的材料元数据和摘要；结果是未核验上下文候选，不是论文证据。" />
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
            placeholder="检索文件名、文本或 OCR 内容"
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
              <p className="muted">{materialTotal} 个匹配 · 确定性词法检索 · 不升级为全文证据</p>
              <div className="data-list">
                {materialRows.map((item, index) => (
                  <div className="data-row" key={index}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.kind || 'material'} · {item.parse_status || 'unknown'} · SHA-256 {String(item.sha256 || '').slice(0, 12)}…</p>
                      <p className="muted">{item.snippet || '无可展示摘要'}</p>
                    </div>
                    <span className="badge pending">词法候选 · 未核验</span>
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

      {novelty ? (
        <div className="section related-work-panel">
          <SectionHeading title="Related Work 与证据覆盖" extra={<Badge status={novelty.assessment || 'review-required'} />} />
          <p className="muted">{novelty.summary || ''}</p>
          <h3>证据覆盖缺口</h3>
          {noveltyList(novelty.research_gap_candidates)}
          {novelty.duplicate_candidates?.length ? (
            <>
              <h3>重复研究候选</h3>
              {noveltyList(novelty.duplicate_candidates)}
            </>
          ) : null}
          <p className="muted">{novelty.claim_gate || ''}</p>
        </div>
      ) : null}
    </>
  )
}
