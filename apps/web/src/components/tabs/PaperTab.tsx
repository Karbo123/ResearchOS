import { FileCheck, FilePenLine, ExternalLink, Image, Link2, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { Paper, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'
import { ArtifactCard } from '../previews'
import { useTranslation } from '../../i18n'
import { localizeFailure } from '../../api'

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
  const { t } = useTranslation()
  const acceptedReviews = project.claim_reviews?.filter(review => review.status === 'accepted').length || 0
  const evidenceCount = project.evidence?.length || 0
  const validArtifacts = (project.artifacts || []).filter(artifact => artifact.valid !== false)
  const compileRuns = (project.experiments || []).filter(item => item.experiment_type === 'compile_latex')
  const compileProposals = (project.proposals || []).filter(item => item.payload?.experiment_type === 'compile_latex' || item.summary.toLowerCase().includes('compile'))

  const createPaperDraft = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/paper-draft`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('paper.draftProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) { showToast(errorMessage(error)) }
  }

  const createCompilePlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/compile-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('paper.compileProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) { showToast(errorMessage(error)) }
  }

  if (tab === 'paper_outline') {
    const sections = [
      ['paper.sectionAbstract', Boolean(project.spec?.idea?.research_question)],
      ['paper.sectionIntroduction', Boolean(project.spec?.idea?.research_question)],
      ['paper.sectionRelatedWork', (project.papers || []).some(paper => paper.confirmed)],
      ['paper.sectionMethod', Boolean(project.spec?.idea?.hypotheses?.length)],
      ['paper.sectionSetup', (project.experiments || []).length > 0],
      ['paper.sectionResults', (project.experiments || []).some(experiment => experiment.status === 'succeeded')],
      ['paper.sectionLimitations', Boolean(project.spec?.idea?.risks?.length)],
    ] as const
    return <>
      <SectionHeading title={t('paper.outlineTitle')} hint={t('paper.outlineHint')} extra={<Badge status="project-scoped">{t('paper.projectScoped')}</Badge>} />
      <div className="data-list">{sections.map(([key, ready]) => <div className="data-row" key={key}><div><h3>{t(key)}</h3><p>{ready ? t('paper.outlineReady') : t('paper.outlineMissing')}</p></div><Badge status={ready ? 'candidate' : 'blocked'}>{ready ? t('paper.candidate') : 'blocked'}</Badge></div>)}</div>
      <div className="section"><SectionHeading title={t('paper.versionRules')} /><p className="muted">{t('paper.versionRulesText')}</p></div>
    </>
  }

  if (tab === 'paper_citations') {
    return <>
      <SectionHeading title={t('paper.citationsTitle')} hint={t('paper.citationsHint')} extra={<Badge status="project-scoped">{t('paper.projectScoped')}</Badge>} />
      {project.papers?.length ? <div className="data-list">{project.papers.map(paper => {
        const evidence = paperEvidence(project, paper)
        const status = evidenceStatus(project, paper)
        return <div className="data-row" key={paper.id}><div><h3>{paper.title}</h3><p>{paper.doi || paper.source_url || t('paper.sourcePending')} · {t('paper.evidenceCount', { count: evidence.length })} · {paper.bibtex ? t('paper.bibtexRecorded') : t('paper.bibtexMissing')}</p><p className="muted">{t('paper.citationReadiness', { status, confirmed: String(Boolean(paper.confirmed)), verified: String(Boolean(paper.verified)) })}</p></div><ButtonRow><Badge status={paper.confirmed ? 'confirmed' : 'metadata-only'} />{paper.source_url ? <a className="secondary" href={paper.source_url} target="_blank" rel="noreferrer" aria-label={`${t('paper.open')} ${paper.title}`}><ExternalLink size={14} /></a> : null}</ButtonRow></div>
      })}</div> : <EmptyState text={t('paper.noPapers')} action={<button className="secondary" type="button" onClick={() => onNavigate('literature')}><Link2 size={14} />{t('paper.openLiterature')}</button>} />}
      <div className="section"><SectionHeading title={t('paper.evidenceGate')} /><div className="data-list"><div className="data-row"><div><h3>{t('paper.claimReviewsTitle')}</h3><p>{t('paper.acceptedReviewCount', { count: acceptedReviews })}</p></div><Badge status={acceptedReviews ? 'ready' : 'evidence-required'} /></div><div className="data-row"><div><h3>{t('paper.fulltextLocated')}</h3><p>{t('paper.locatedCount', { located: (project.evidence || []).filter(item => item.locator).length, total: evidenceCount })}</p></div><ShieldCheck size={16} className="muted" /></div></div></div>
    </>
  }

  if (tab === 'paper_figures') {
    const figures = validArtifacts.filter(artifact => /image|plot|chart|png|jpe?g|svg|pdf|ply|mesh/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`))
    return <>
      <SectionHeading title={t('paper.figuresTitle')} hint={t('paper.figuresHint')} extra={<Badge status="project-scoped">{t('paper.figureCount', { count: figures.length })}</Badge>} />
      {figures.length ? <div className="artifact-grid">{figures.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} />)}</div> : <EmptyState text={t('paper.noFigures')} action={<button className="secondary" type="button" onClick={() => onNavigate('artifacts')}><Image size={14} />{t('paper.viewArtifacts')}</button>} />}
    </>
  }

  if (tab === 'paper_data') {
    const dataArtifacts = validArtifacts.filter(artifact => /json|csv|tsv|table|metric|loss|data|timeseries/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`))
    return <>
      <SectionHeading title={t('paper.dataTitle')} hint={t('paper.dataHint')} extra={<Badge status="project-scoped">{t('paper.dataCount', { count: dataArtifacts.length })}</Badge>} />
      {dataArtifacts.length ? <div className="data-list">{dataArtifacts.map(artifact => {
        const lineage = artifact.metadata?.lineage && typeof artifact.metadata.lineage === 'object' ? artifact.metadata.lineage as Record<string, unknown> : {}
        return <div className="data-row" key={artifact.id}><div><h3>{artifact.name}</h3><p>{artifact.kind} · {artifact.mime_type || t('paper.typePending')}</p><p className="muted">{t('paper.dataLineage', { run: String(lineage.run_id || t('preview.lineageUnbound')), idea: String(lineage.idea_version || t('preview.lineageUnknown')), data: String(lineage.data_version || t('preview.lineageNotDeclared')) })}</p></div><Badge status={artifact.valid ? 'valid' : 'invalid'} /></div>
      })}</div> : <EmptyState text={t('paper.noData')} action={<button className="secondary" type="button" onClick={() => onNavigate('artifacts')}><Image size={14} />{t('paper.viewArtifacts')}</button>} />}
    </>
  }

  if (tab === 'paper_compile') {
    return <>
      <SectionHeading title={t('paper.compileTitle')} hint={t('paper.compileHint')} extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void createCompilePlan() }}><FileCheck size={15} />{t('paper.createCompileProposal')}</button></ButtonRow>} />
      <div className="data-list"><div className="data-row"><div><h3>{t('paper.sourceFile')}</h3><p><code>projects/{project.id}/paper/main.tex</code></p></div><Badge status={compileProposals.length ? 'candidate' : 'blocked'}>{compileProposals.length ? t('paper.compileProposalExists') : t('paper.notProposed')}</Badge></div><div className="data-row"><div><h3>{t('paper.compileRuns')}</h3><p>{compileRuns.length ? t('paper.compileRunCount', { count: compileRuns.length }) : t('paper.noCompileRuns')}</p></div><Badge status={compileRuns.some(item => item.status === 'succeeded') ? 'succeeded' : compileRuns.length ? compileRuns[0].status : 'empty'} /></div></div>
      {compileRuns.length ? <div className="section"><SectionHeading title={t('paper.compileRunRecords')} /><div className="data-list">{compileRuns.map(run => <div className="data-row" key={run.id}><div><h3>{run.run_id || run.id}</h3><p>{run.error ? localizeFailure(run.status, run.error) : JSON.stringify(run.metrics || {})}</p></div><Badge status={run.status} /></div>)}</div></div> : null}
      {compileProposals.length ? <div className="section"><SectionHeading title={t('paper.compileApprovals')} /><div className="data-list">{compileProposals.map(proposal => <div className="data-row" key={proposal.id}><div><h3>{proposal.summary}</h3><p>{proposal.reason || t('paper.noReason')} · {proposal.created_at || t('common.timePending')}</p></div><Badge status={proposal.status} /></div>)}</div></div> : null}
    </>
  }

  if (tab === 'paper_review') {
    const pdfArtifacts = validArtifacts.filter(artifact => /pdf/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`))
    return (
      <>
        <SectionHeading title={t('paper.pdfTitle')} hint={t('paper.pdfHint')} extra={<Badge status="project-scoped">{t('paper.pdfCount', { count: pdfArtifacts.length })}</Badge>} />
        {pdfArtifacts.length ? (
          <div className="data-list">
            {pdfArtifacts.map(artifact => (
              <div className="data-row" key={artifact.id}>
                <div>
                  <h3>{artifact.name}</h3>
                  <p>{artifact.mime_type || 'application/pdf'} · SHA-256 {artifact.sha256 ? artifact.sha256.slice(0, 12) : t('common.unrecorded')}…</p>
                </div>
                <div className="button-row">
                  <Badge status={artifact.valid ? 'valid' : 'invalid'} />
                  {artifact.valid ? <a className="secondary" href={artifact.download_url || artifact.url} target="_blank" rel="noreferrer">{t('paper.openPdf')} <ExternalLink size={14} /></a> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState text={t('paper.noPdf')} action={<button className="secondary" type="button" onClick={() => onNavigate('paper_compile')}><FileCheck size={14} />{t('paper.goCompile')}</button>} />}
      </>
    )
  }

  return <>
    <SectionHeading title={t('paper.projectTitle')} hint={t('paper.projectHint')} extra={<ButtonRow><button className="secondary" type="button" onClick={() => { void createPaperDraft() }}><FilePenLine size={15} />{t('paper.createDraftProposal')}</button><button className="secondary" type="button" onClick={() => { void createCompilePlan() }}><FileCheck size={15} />{t('paper.proposeCompile')}</button></ButtonRow>} />
    <div className="metric-grid"><div className="metric"><span>{t('paper.literatureCount')}</span><strong>{project.papers?.length || 0}</strong></div><div className="metric"><span>{t('paper.evidenceCandidates')}</span><strong>{evidenceCount}</strong></div><div className="metric"><span>{t('paper.acceptedClaims')}</span><strong>{acceptedReviews}</strong></div><div className="metric"><span>{t('paper.validArtifacts')}</span><strong>{validArtifacts.length}</strong></div></div>
    <div className="section"><SectionHeading title={t('paper.evidenceGate')} /><div className="data-list"><div className="data-row"><div><h3>{t('paper.claimPageEvidence')}</h3><p>{t('paper.claimPageEvidenceText')}</p></div><Badge status={acceptedReviews > 0 ? 'ready' : 'evidence-required'} /></div><div className="data-row"><div><h3>{t('paper.proposalCompile')}</h3><p>{t('paper.proposalCompileText')}</p></div><ShieldCheck size={16} className="muted" /></div></div></div>
    {project.papers?.length ? <div className="section"><SectionHeading title={t('paper.referenceRecords')} /><div className="data-list">{project.papers.slice(0, 8).map(paper => <div className="data-row" key={paper.id}><div><h3>{paper.title}</h3><p>{paper.year || t('literature.yearUnknown')} · {paper.venue || paper.source_provider || t('paper.sourcePending')} · DOI {paper.doi || t('common.notProvided')}</p></div><Badge status={paper.confirmed ? 'confirmed' : 'metadata-only'} /></div>)}</div></div> : <EmptyState text={t('paper.noReferences')} />}
  </>
}
