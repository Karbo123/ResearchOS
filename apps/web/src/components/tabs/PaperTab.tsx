import { FileCheck, FilePenLine, ExternalLink, Image, Link2, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { Paper, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'
import { ArtifactCard } from '../previews'

function paperEvidence(project: ProjectDetail, paper: Paper) {
  return (project.evidence || []).filter(evidence => evidence.paper_id === paper.id)
}

function evidenceStatus(project: ProjectDetail, paper: Paper) {
  const evidence = paperEvidence(project, paper)
  const accepted = (project.claim_reviews || []).some(review => review.status === 'accepted' && review.evidence_ids.some(id => evidence.some(item => item.id === id)))
  return accepted ? 'claim_reviewed' : evidence.some(item => item.locator) ? 'page_quote' : 'metadata_only'
}

export function PaperTab({
  project,
  tab,
  onNavigate,
  onRefresh,
  showToast,
}: {
  project: ProjectDetail
  tab: TabId
  onNavigate: (tab: TabId) => void
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}) {
  const acceptedReviews = project.claim_reviews?.filter(review => review.status === 'accepted').length || 0
  const evidenceCount = project.evidence?.length || 0
  const validArtifacts = (project.artifacts || []).filter(artifact => artifact.valid !== false)
  const compileRuns = (project.experiments || []).filter(item => item.experiment_type === 'compile_latex')
  const compileProposals = (project.proposals || []).filter(item => item.payload?.experiment_type === 'compile_latex' || item.summary.toLowerCase().includes('compile') || item.summary.includes('编译'))

  const createPaperDraft = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/paper-draft`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(`论文草稿 Proposal ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) { showToast(errorMessage(error)) }
  }

  const createCompilePlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/compile-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(`LaTeX 编译 Proposal ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) { showToast(errorMessage(error)) }
  }

  if (tab === 'paper_outline') {
    const sections = [
      ['摘要', Boolean(project.spec?.idea?.research_question)],
      ['引言与研究问题', Boolean(project.spec?.idea?.research_question)],
      ['相关工作', (project.papers || []).some(paper => paper.confirmed)],
      ['方法', Boolean(project.spec?.idea?.hypotheses?.length)],
      ['实验设置', (project.experiments || []).length > 0],
      ['结果与讨论', (project.experiments || []).some(experiment => experiment.status === 'succeeded')],
      ['局限与结论', Boolean(project.spec?.idea?.risks?.length)],
    ] as const
    return <>
      <SectionHeading title="大纲与章节" hint="章节状态来自当前项目的结构化来源；未确认字段不会被伪装成已完成章节。" extra={<Badge status="project-scoped">project_scoped</Badge>} />
      <div className="data-list">{sections.map(([title, ready]) => <div className="data-row" key={title}><div><h3>{title}</h3><p>{ready ? '已有项目来源，可进入 Proposal 审阅' : '缺少上游规格、证据或真实实验来源'}</p></div><Badge status={ready ? 'candidate' : 'blocked'}>{ready ? '候选' : 'blocked'}</Badge></div>)}</div>
      <div className="section"><SectionHeading title="版本规则" /><p className="muted">当前页面只展示章节准备度。任何写入 paper/main.tex 的修改都必须通过独立 Proposal，批准后形成 Git diff；失败或被拒绝的写入不会生成成功章节。</p></div>
    </>
  }

  if (tab === 'paper_citations') {
    return <>
      <SectionHeading title="引用与 BibTeX" hint="只显示项目范围 Paper、页码/章节 Evidence 和 ClaimReview 状态；metadata-only 不能进入论证。" extra={<Badge status="project-scoped">project_scoped</Badge>} />
      {project.papers?.length ? <div className="data-list">{project.papers.map(paper => {
        const evidence = paperEvidence(project, paper)
        const status = evidenceStatus(project, paper)
        return <div className="data-row" key={paper.id}><div><h3>{paper.title}</h3><p>{paper.doi || paper.source_url || '来源待记录'} · Evidence {evidence.length} · {paper.bibtex ? 'BibTeX 已记录' : 'BibTeX 未记录'}</p><p className="muted">引用准备度：{status} · confirmed={String(Boolean(paper.confirmed))} · verified={String(Boolean(paper.verified))}</p></div><ButtonRow><Badge status={paper.confirmed ? 'confirmed' : 'metadata-only'} />{paper.source_url ? <a className="secondary" href={paper.source_url} target="_blank" rel="noreferrer" aria-label={`打开 ${paper.title}`}><ExternalLink size={14} /></a> : null}</ButtonRow></div>
      })}</div> : <EmptyState text="尚无项目范围 Paper；请先完成相关工作调研。" action={<button className="secondary" type="button" onClick={() => onNavigate('literature')}><Link2 size={14} />打开文献检索</button>} />}
      <div className="section"><SectionHeading title="证据门禁" /><div className="data-list"><div className="data-row"><div><h3>可用于论证的 ClaimReview</h3><p>{acceptedReviews} 条 accepted review；每条必须关联当前项目的 Evidence。</p></div><Badge status={acceptedReviews ? 'ready' : 'evidence-required'} /></div><div className="data-row"><div><h3>全文定位</h3><p>{(project.evidence || []).filter(item => item.locator).length}/{evidenceCount} 条 Evidence 有页码或章节 locator。</p></div><ShieldCheck size={16} className="muted" /></div></div></div>
    </>
  }

  if (tab === 'paper_figures') {
    const figures = validArtifacts.filter(artifact => /image|plot|chart|png|jpe?g|svg|pdf|ply|mesh/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`))
    return <>
      <SectionHeading title="图表选择与插入" hint="这里只选择 lineage 完整且仍有效的实验 Artifact 插入论文；实验运行、队列和可视化管理在《实验实现》中完成。" extra={<Badge status="project-scoped">{figures.length} 个可选图表</Badge>} />
      {figures.length ? <div className="artifact-grid">{figures.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} />)}</div> : <EmptyState text="尚无可插入论文的有效图表或实验产物。无关 baseline、空数组和失效 Artifact 不会显示为结果。" action={<button className="secondary" type="button" onClick={() => onNavigate('artifacts')}><Image size={14} />查看实验产物</button>} />}
    </>
  }

  if (tab === 'paper_data') {
    const dataArtifacts = validArtifacts.filter(artifact => /json|csv|tsv|table|metric|loss|data|timeseries/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`))
    return <>
      <SectionHeading title="实验数据选择与引用" hint="只列出 lineage 完整且有效的 Artifact 供论文引用数字和表格；数值来自真实 Run，论文页不运行或管理实验。" extra={<Badge status="project-scoped">{dataArtifacts.length} 个可选数据</Badge>} />
      {dataArtifacts.length ? <div className="data-list">{dataArtifacts.map(artifact => {
        const lineage = artifact.metadata?.lineage && typeof artifact.metadata.lineage === 'object' ? artifact.metadata.lineage as Record<string, unknown> : {}
        return <div className="data-row" key={artifact.id}><div><h3>{artifact.name}</h3><p>{artifact.kind} · {artifact.mime_type || '类型待记录'}</p><p className="muted">Run {String(lineage.run_id || '未绑定')} · Idea v{String(lineage.idea_version || '未知')} · 数据版本 {String(lineage.data_version || '未声明')}</p></div><Badge status={artifact.valid ? 'valid' : 'invalid'} /></div>
      })}</div> : <EmptyState text="当前没有可引用的实验数据产物。请先完成实验实现并生成有效 Artifact。" action={<button className="secondary" type="button" onClick={() => onNavigate('artifacts')}><Image size={14} />查看实验产物</button>} />}
    </>
  }

  if (tab === 'paper_compile') {
    return <>
      <SectionHeading title="LaTeX 编译" hint="Linux latexmk 是独立审批动作；编译失败只留下失败日志，不生成成功 PDF。" extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void createCompilePlan() }}><FileCheck size={15} />创建编译 Proposal</button></ButtonRow>} />
      <div className="data-list"><div className="data-row"><div><h3>论文源文件</h3><p><code>projects/{project.id}/paper/main.tex</code></p></div><Badge status={compileProposals.length ? 'candidate' : 'blocked'}>{compileProposals.length ? '已有编译 Proposal' : '尚未提出'}</Badge></div><div className="data-row"><div><h3>编译运行</h3><p>{compileRuns.length ? `${compileRuns.length} 次 compile_latex 运行` : '尚无真实编译运行'}</p></div><Badge status={compileRuns.some(item => item.status === 'succeeded') ? 'succeeded' : compileRuns.length ? compileRuns[0].status : 'empty'} /></div></div>
      {compileRuns.length ? <div className="section"><SectionHeading title="编译运行记录" /><div className="data-list">{compileRuns.map(run => <div className="data-row" key={run.id}><div><h3>{run.run_id || run.id}</h3><p>{run.error || JSON.stringify(run.metrics || {})}</p></div><Badge status={run.status} /></div>)}</div></div> : null}
      {compileProposals.length ? <div className="section"><SectionHeading title="编译审批" /><div className="data-list">{compileProposals.map(proposal => <div className="data-row" key={proposal.id}><div><h3>{proposal.summary}</h3><p>{proposal.reason || '无说明'} · {proposal.created_at || '时间待记录'}</p></div><Badge status={proposal.status} /></div>)}</div></div> : null}
    </>
  }

  if (tab === 'paper_review') {
    const pdfArtifacts = validArtifacts.filter(artifact => /pdf/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`))
    return (
      <>
        <SectionHeading title="PDF 呈现与审阅" hint="只呈现成功编译且仍有效的 PDF Artifact；编译失败不会留下成功 PDF，也不显示为已完成。" extra={<Badge status="project-scoped">{pdfArtifacts.length} 个 PDF</Badge>} />
        {pdfArtifacts.length ? (
          <div className="data-list">
            {pdfArtifacts.map(artifact => (
              <div className="data-row" key={artifact.id}>
                <div>
                  <h3>{artifact.name}</h3>
                  <p>{artifact.mime_type || 'application/pdf'} · SHA-256 {artifact.sha256 ? artifact.sha256.slice(0, 12) : '未记录'}…</p>
                </div>
                <div className="button-row">
                  <Badge status={artifact.valid ? 'valid' : 'invalid'} />
                  {artifact.valid ? <a className="secondary" href={artifact.download_url || artifact.url} target="_blank" rel="noreferrer">打开 PDF <ExternalLink size={14} /></a> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState text="还没有成功编译的 PDF。请先在 LaTeX 编译页提出 Proposal 并完成真实编译。" action={<button className="secondary" type="button" onClick={() => onNavigate('paper_compile')}><FileCheck size={14} />前往 LaTeX 编译</button>} />}
      </>
    )
  }

  return <>
    <SectionHeading title="论文项目" hint="论文草稿只使用项目范围内已记录材料和人工复核状态；修改与编译都必须先进入审批。" extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void createPaperDraft() }}><FilePenLine size={15} />生成论文草稿提案</button><button className="secondary" type="button" onClick={() => { void createCompilePlan() }}><FileCheck size={15} />提出 LaTeX 编译</button></ButtonRow>} />
    <div className="metric-grid"><div className="metric"><span>文献记录</span><strong>{project.papers?.length || 0}</strong></div><div className="metric"><span>原文证据候选</span><strong>{evidenceCount}</strong></div><div className="metric"><span>已接受 Claim 复核</span><strong>{acceptedReviews}</strong></div><div className="metric"><span>有效产物</span><strong>{validArtifacts.length}</strong></div></div>
    <div className="section"><SectionHeading title="论文证据门禁" /><div className="data-list"><div className="data-row"><div><h3>Claim 与页码证据</h3><p>已接受人工复核的 Claim 才能作为论文论证输入；元数据记录不会自动升级为全文证据。</p></div><Badge status={acceptedReviews > 0 ? 'ready' : 'evidence-required'} /></div><div className="data-row"><div><h3>Proposal 与编译</h3><p>批准后才会修改项目中的 paper/main.tex，并由 Linux latexmk 监督器生成编译产物。</p></div><ShieldCheck size={16} className="muted" /></div></div></div>
    {project.papers?.length ? <div className="section"><SectionHeading title="论文参考记录" /><div className="data-list">{project.papers.slice(0, 8).map(paper => <div className="data-row" key={paper.id}><div><h3>{paper.title}</h3><p>{paper.year || '年份未知'} · {paper.venue || paper.source_provider || '来源待补全'} · DOI {paper.doi || '未提供'}</p></div><Badge status={paper.confirmed ? 'confirmed' : 'metadata-only'} /></div>)}</div></div> : <EmptyState text="尚无可引用的文献记录。请先完成相关工作调研。" />}
  </>
}
