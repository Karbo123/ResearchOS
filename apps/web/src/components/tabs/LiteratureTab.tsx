import { useEffect, useState } from 'react'
import { ChevronsDown, Download, GitBranch, GitFork, ScanText, Search, ShieldCheck, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ClaimReview, MaterialSearchResponse, ProjectDetail, RelatedWorkCandidate, RelatedWorkFieldProvenance, RelatedWorkRun, Repository, RepositoryDiscovery, SearchCandidate, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, Modal, SectionHeading } from '../ui'
import { useTranslation } from '../../i18n'

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
  const { t } = useTranslation()
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
  const [recursiveReason, setRecursiveReason] = useState(t('literature.recursiveDefaultReason'))
  const [recursiveLoading, setRecursiveLoading] = useState(false)
  const [provenanceCandidateId, setProvenanceCandidateId] = useState<string | null>(null)

  const activeRecursiveRun = project.related_work_runs?.find(run => ['queued', 'running'].includes(run.status))

  const candidateProvenance = (candidateId: string) => (project.related_work_field_provenance || []).filter(item => item.candidate_id === candidateId)
  const provenanceCandidate = project.related_work_candidates?.find(candidate => candidate.id === provenanceCandidateId) || null

  const valueLabel = (value: unknown) => {
    if (value === null || value === undefined) return t('common.notProvided')
    if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 180)}…` : value
    try { return JSON.stringify(value) } catch { return String(value) }
  }

  const decideCandidate = async (candidate: RelatedWorkCandidate, decision: 'approved' | 'rejected' | 'reopened') => {
    try {
      await api(`/api/projects/${project.id}/related-work/candidates/${candidate.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: decision === 'approved' ? t('literature.approveReason') : decision === 'rejected' ? t('literature.rejectReason') : t('literature.reopenReason') }),
      })
      await onRefresh()
      showToast(decision === 'approved' ? t('literature.approvedToast') : decision === 'rejected' ? t('literature.rejectedToast') : t('literature.reopenedToast'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const requestCandidateDecision = (candidate: RelatedWorkCandidate, decision: 'approved' | 'rejected' | 'reopened') => {
    const labels = { approved: t('literature.confirmPaper'), rejected: t('literature.rejectCandidate'), reopened: t('literature.reopen') }
    onRequestConfirm({
      title: labels[decision],
      description: decision === 'approved' ? t('literature.approveDescription') : t('literature.rejectDescription'),
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
      showToast(t('literature.fieldSelected', { field: field.field_name, provider: field.provider }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const proposeCandidateEnrichment = async (candidate: RelatedWorkCandidate) => {
    const fields = ['title', 'authors', 'abstract', 'venue', 'doi', 'year', 'institutions', 'pdf_url', 'bibtex']
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/related-work/candidate-enrichment`, {
        method: 'POST',
        body: JSON.stringify({ candidate_id: candidate.id, fields, providers: ['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv'], reason: t('literature.enrichReason') }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('literature.enrichProposal', { id: result.proposal_id.slice(0, 8) }))
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
      showToast(t('literature.seedRecorded', { status: result.status, candidates: result.candidate_ids?.length || 0, failures: result.attempts?.filter(item => item.status !== 'succeeded').length || 0 }))
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
      showToast(t('literature.recursiveProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setRecursiveLoading(false)
    }
  }

  const cancelRecursiveRun = async (run: RelatedWorkRun) => {
    try {
      await api(`/api/projects/${project.id}/related-work/runs/${run.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: t('literature.cancelRecursiveReason') }) })
      await onRefresh()
      showToast(t('literature.cancelRequested'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const toggleRecursiveProvider = (provider: string) => {
    setRecursiveProviders(current => current.includes(provider) ? current.filter(item => item !== provider) : [...current, provider])
  }

  const runSearch = async () => {
    try {
      showToast(t('literature.searchingSources'))
      const result = await api<{ resource_candidates?: SearchCandidate[]; provider_errors?: string[] }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({ project_id: project.id, limit: 8 }),
      })
      await onRefresh()
      showToast(t('literature.searchDone', { failures: result.provider_errors?.length || 0, candidates: result.resource_candidates?.length || 0 }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const ingestEvidence = async () => {
    try {
      showToast(t('literature.ingestingEvidence'))
      const result = await api<{ stored_count: number; errors: unknown[] }>(`/api/projects/${project.id}/evidence/ingest`, {
        method: 'POST',
        body: JSON.stringify({ limit: 3 }),
      })
      await onRefresh()
      showToast(t('literature.evidenceSaved', { count: result.stored_count, failures: result.errors.length }))
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
      showToast(t('literature.repoAdded'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const discoverRepositories = async (paperId: string) => {
    setRepositoryDiscoveryLoading(paperId)
    try {
      const response = await api<{ candidates: RepositoryDiscovery[] }>(`/api/projects/${project.id}/papers/${paperId}/repositories/discover`)
      setRepositoryDiscoveries(previous => ({ ...previous, [paperId]: response.candidates }))
      if (!response.candidates.length) showToast(t('literature.noRepoLinks'))
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
      showToast(t('literature.repoVerified'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const proposeRepositoryDownload = async (repositoryId: string) => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/repositories/${repositoryId}/download`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('literature.downloadProposal', { id: result.proposal_id.slice(0, 8) }))
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
      showToast(t('literature.claimSubmitted'))
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
      showToast(decision === 'accepted' ? t('literature.reviewRecorded') : t('literature.reviewRejected'))
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
        ? <span className="muted">{t('literature.downloadedTo', { path: download.relative_path || t('literature.projectCodeDir') })}</span>
        : <button className="secondary" type="button" onClick={() => proposeRepositoryDownload(repository.id)}>
            <Download size={15} />
            {t('literature.proposeDownload')}
          </button>
    }
    return (
      <button className="secondary" type="button" onClick={() => verifyRepository(repository.id)}>
        <ShieldCheck size={15} />
        {t('literature.crossVerify')}
      </button>
    )
  }

  return (
    <>
      <SectionHeading
        title={t('literature.title')}
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={runSearch}>
              <Search size={15} />
              {t('literature.updateSearch')}
            </button>
            <button className="secondary" type="button" onClick={ingestEvidence}>
              <ScanText size={15} />
              {t('literature.extractEvidence')}
            </button>
          </ButtonRow>
        }
      />
      <div className="section related-work-seed-panel">
        <SectionHeading title={t('literature.seedTitle')} hint={t('literature.seedHint')} />
        <div className="related-work-seed-form">
          <label>
            {t('literature.seedType')}
            <select value={seedType} onChange={event => { setSeedType(event.target.value as typeof seedType); resetSeedForm() }}>
              <option value="doi">DOI</option>
              <option value="title">{t('literature.titleOption')}</option>
              <option value="url">{t('literature.urlOption')}</option>
              <option value="bibtex">BibTeX</option>
              <option value="artifact_pdf">{t('literature.pdfOption')}</option>
              <option value="existing_paper">{t('literature.existingPaperOption')}</option>
            </select>
          </label>
          {seedType === 'artifact_pdf' ? (
            <label>
              PDF Artifact
              <select value={seedArtifactId} onChange={event => setSeedArtifactId(event.target.value)}>
                <option value="">{t('literature.selectPdf')}</option>
                {(project.artifacts || []).filter(artifact => artifact.mime_type === 'application/pdf' && artifact.valid !== false).map(artifact => (
                  <option value={artifact.id} key={artifact.id}>{artifact.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {seedType === 'existing_paper' ? (
            <label>
              {t('literature.projectPaper')}
              <select value={seedPaperId} onChange={event => setSeedPaperId(event.target.value)}>
                <option value="">{t('literature.selectPaper')}</option>
                {(project.papers || []).map(paper => <option value={paper.id} key={paper.id}>{paper.title}</option>)}
              </select>
            </label>
          ) : null}
          {seedType !== 'artifact_pdf' && seedType !== 'existing_paper' ? (
            <label className="related-work-seed-value">
              {seedType === 'doi' ? 'DOI' : seedType === 'title' ? t('literature.paperTitle') : seedType === 'url' ? t('literature.httpsUrl') : t('literature.bibtexEntry')}
              {seedType === 'bibtex' ? (
                <textarea rows={5} maxLength={100_000} value={seedValue} onChange={event => setSeedValue(event.target.value)} placeholder="@article{...}" />
              ) : (
                <input maxLength={2_000} value={seedValue} onChange={event => setSeedValue(event.target.value)} placeholder={seedType === 'doi' ? '10.1000/example' : seedType === 'url' ? 'https://doi.org/...' : t('literature.enterTitle')} />
              )}
            </label>
          ) : null}
          {seedType !== 'title' && seedType !== 'existing_paper' ? (
            <label>
              {t('literature.optionalTitle')}
              <input maxLength={2_000} value={seedTitle} onChange={event => setSeedTitle(event.target.value)} placeholder={t('literature.optionalTitlePlaceholder')} />
            </label>
          ) : null}
          <button className="secondary" type="button" disabled={seedLoading || (seedType === 'artifact_pdf' ? !seedArtifactId : seedType === 'existing_paper' ? !seedPaperId : !seedValue.trim())} onClick={() => void addSeed()}>
            <GitFork size={15} />
            {seedLoading ? t('literature.parsing') : t('literature.addSeed')}
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
                    <span>{seed.source_type} · {seed.status} · {seed.created_at ? new Date(seed.created_at).toLocaleString() : t('literature.timeUnknown')}</span>
                  </span>
                  <Badge status={seed.status} />
                </label>
              ))}
            </div>
            <div className="related-work-recursive-controls">
              <div className="control-grid">
                <label>{t('literature.depth')}<input type="number" min={1} max={5} value={recursiveDepth} onChange={event => setRecursiveDepth(Number(event.target.value))} /></label>
                <label>{t('literature.width')}<input type="number" min={1} max={50} value={recursiveWidth} onChange={event => setRecursiveWidth(Number(event.target.value))} /></label>
                <label>{t('literature.maxTotal')}<input type="number" min={1} max={500} value={recursiveMaxTotal} onChange={event => setRecursiveMaxTotal(Number(event.target.value))} /></label>
              </div>
              <label>{t('literature.proposalReason')}<input maxLength={2_000} value={recursiveReason} onChange={event => setRecursiveReason(event.target.value)} /></label>
              <div className="provider-choice" aria-label={t('literature.recursiveProviders')}>
                {['crossref', 'openalex', 'semantic_scholar'].map(provider => (
                  <label key={provider}><input type="checkbox" checked={recursiveProviders.includes(provider)} onChange={() => toggleRecursiveProvider(provider)} />{provider}</label>
                ))}
              </div>
              <button className="secondary" type="button" disabled={recursiveLoading || !selectedSeeds.length || !recursiveProviders.length} onClick={() => void createRecursivePlan()}>
                <GitFork size={15} />
                {recursiveLoading ? t('literature.creating') : t('literature.createRecursiveProposal', { count: selectedSeeds.length })}
              </button>
            </div>
          </div>
        ) : <EmptyState text={t('literature.noSeeds')} />}
      </div>

      {project.related_work_runs?.length ? (
        <div className="section related-work-run-panel">
          <SectionHeading title={t('literature.runsTitle')} hint={t('literature.runsHint')} />
          <div className="data-list">
            {project.related_work_runs.map(run => (
              <div className="data-row" key={run.id}>
                <div>
                  <h3>{run.status} · {t('literature.runCandidates', { count: run.discovered_count || 0, edges: run.edge_count || 0 })}</h3>
                  <p>depth {run.depth} · width {run.width} · max_total {run.max_total} · providers {run.providers.join(', ')}</p>
                  {run.error ? <p className="error-text">{run.error}</p> : null}
                </div>
                <div className="button-row">
                  <Badge status={run.status} />
                  {['queued', 'running'].includes(run.status) ? <button className="secondary" type="button" onClick={() => void cancelRecursiveRun(run)}><Square size={14} />{t('common.cancel')}</button> : null}
                </div>
              </div>
            ))}
          </div>
          {project.related_work_attempts?.some(attempt => attempt.status !== 'succeeded') ? (
            <div className="related-work-failures">
              <h3>{t('literature.providerFailures')}</h3>
              {project.related_work_attempts.filter(attempt => attempt.status !== 'succeeded').slice(0, 12).map(attempt => (
                <p key={attempt.id || `${attempt.provider}-${attempt.query}-${attempt.finished_at}`}><strong>{attempt.provider}</strong> · {attempt.status} · {attempt.failure?.message || t('literature.noFailureDetail')}</p>
              ))}
            </div>
          ) : null}
          {project.related_work_edges?.length ? (
            <div className="citation-edge-list">
              <h3>{t('literature.edgeTitle')}</h3>
              {project.related_work_edges.slice(0, 20).map(edge => <p key={edge.id || `${edge.source_candidate_id}-${edge.target_candidate_id}-${edge.provider}`}><strong>{edge.source_title || edge.source_candidate_id}</strong> → {edge.target_title || edge.target_candidate_id} · {edge.provider} · {(edge.ranking_reasons || []).join(', ') || t('literature.noRankingSignal')}</p>)}
            </div>
          ) : null}
        </div>
      ) : null}
      {project.related_work_candidates?.length ? (
        <div className="section related-work-candidate-panel">
          <SectionHeading title={t('literature.candidatesTitle')} hint={t('literature.candidatesHint')} />
          <div className="data-list">
            {project.related_work_candidates.map(candidate => (
              <div className="data-row" key={candidate.id}>
                <div>
                  <h3>{candidate.title}</h3>
                  <p>{candidate.provider} · depth {candidate.discovery_depth ?? 0} · {candidate.year || t('literature.yearUnknown')} · DOI {candidate.normalized_doi || t('common.notProvided')} · {t('literature.providerEvidenceCount', { count: candidate.source_count || 0 })}</p>
                  {(() => {
                    const provenance = candidateProvenance(candidate.id)
                    const conflictFields = [...new Set(provenance.filter(item => item.status === 'conflict').map(item => item.field_name))]
                    return <p className="muted">{t('literature.fieldProvenanceCount', { count: provenance.length })} · {conflictFields.length ? t('literature.conflicts', { fields: conflictFields.join(', ') }) : t('literature.noConflicts')}</p>
                  })()}
                </div>
                <div className="button-row">
                  <Badge status={candidate.paper_id ? 'confirmed-paper' : candidate.status || 'metadata-candidate'} />
                  {candidateProvenance(candidate.id).length ? <button className="secondary" type="button" onClick={() => setProvenanceCandidateId(candidate.id)}>{t('literature.viewFieldProvenance')}</button> : null}
                  {!candidate.paper_id && candidate.status !== 'rejected' ? (
                    <>
                      <button className="secondary" type="button" onClick={() => void proposeCandidateEnrichment(candidate)}>{t('literature.enrichFields')}</button>
                      <button className="primary" type="button" onClick={() => requestCandidateDecision(candidate, 'approved')}>{t('literature.confirmPaper')}</button>
                      <button className="reject" type="button" onClick={() => requestCandidateDecision(candidate, 'rejected')}>{t('common.reject')}</button>
                    </>
                  ) : null}
                  {!candidate.paper_id && candidate.status === 'rejected' ? <button className="secondary" type="button" onClick={() => requestCandidateDecision(candidate, 'reopened')}>{t('literature.reopen')}</button> : null}
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
          description={t('literature.provenanceDescription')}
          onClose={() => setProvenanceCandidateId(null)}
          wide
        >
          <div className="provenance-drawer-list">
            {[...new Set(candidateProvenance(provenanceCandidate.id).map(item => item.field_name))].sort().map(fieldName => {
              const fields = candidateProvenance(provenanceCandidate.id).filter(item => item.field_name === fieldName)
              return (
                <section className="provenance-drawer-field" key={fieldName}>
                  <div className="provenance-drawer-field-heading">
                    <div><span className="eyebrow">{t('literature.field')}</span><h3>{fieldName}</h3></div>
                    <Badge status={fields.some(item => item.status === 'conflict') ? 'conflict' : fields.some(item => item.status === 'selected') ? 'selected' : 'observed'} />
                  </div>
                  <div className="data-list">
                    {fields.map(field => (
                      <div className="data-row compact-row" key={field.id}>
                        <div>
                          <strong>{field.provider || field.source_type || t('literature.sourceUnrecorded')}{field.status === 'selected' ? t('literature.selected') : ''}</strong>
                          <p>{valueLabel(field.normalized_value)}</p>
                          <p className="muted">source_type={field.source_type || 'unknown'} · attempt={field.source_attempt_id || t('common.none')} · artifact={field.artifact_id || t('common.none')} · locator={field.locator || t('common.none')} · hash={field.raw_value_hash || t('common.none')}</p>
                        </div>
                        {field.status !== 'selected' && !provenanceCandidate.paper_id ? <button className="secondary compact" type="button" onClick={() => void selectCandidateField(provenanceCandidate, field)}>{t('literature.selectSource')}</button> : null}
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
                  {paper.year || ''} {paper.venue || ''} · {paper.source_provider || 'unknown'} · DOI {paper.doi || t('common.notProvided')} ·
                  {paper.verified ? t('literature.metadataVerified') : t('literature.pendingVerification')} · {t('literature.fulltextCount', { count: paper.fulltext_evidence_count || 0 })} ·
                  {t('literature.codeCandidateCount', { count: (paper.code_repositories || []).length })}
                </p>
                {paper.pdf_url ? <p><a href={paper.pdf_url} target="_blank" rel="noreferrer">{t('literature.openPdf')}</a></p> : null}
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
                  {repositoryDiscoveryLoading === paper.id ? t('literature.loadingRepos') : t('literature.findRepoLinks')}
                </button>
                {repoInputFor === paper.id ? (
                  <span className="inline-repo-form">
                    <input
                      value={repoUrl}
                      placeholder={t('literature.repoPlaceholder')}
                      onChange={event => setRepoUrl(event.target.value)}
                    />
                    <button className="secondary" type="button" onClick={() => addRepositoryCandidate(paper.id)}>{t('literature.add')}</button>
                  </span>
                ) : (
                  <button className="secondary" type="button" onClick={() => { setRepoInputFor(paper.id); setRepoUrl('') }}>
                    <GitBranch size={15} />
                    {t('literature.addRepository')}
                  </button>
                )}
              </div>
              {repositoryDiscoveries[paper.id]?.length ? (
                <div className="repository-discovery-list">
                  <p className="muted">{t('literature.discoveryHint')}</p>
                  {repositoryDiscoveries[paper.id].map(discovery => {
                    const exists = (paper.code_repositories || []).some(repository => repository.source_url === discovery.canonical_url)
                    return (
                      <div className="repository-discovery-row" key={discovery.canonical_url}>
                        <a href={discovery.canonical_url} target="_blank" rel="noreferrer">{discovery.canonical_url}</a>
                        <span className="muted">{discovery.locator}</span>
                        {exists ? <Badge status="candidate-exists" /> : <button className="secondary compact" type="button" onClick={() => { void addRepositoryCandidate(paper.id, discovery.canonical_url) }}>{t('literature.addCandidate')}</button>}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text={t('literature.noPapers')} />
      )}

      <div className="section material-search-panel">
        <SectionHeading title={t('literature.materialsTitle')} hint={t('literature.materialsHint')} />
        <form
          className="material-search-form"
          onSubmit={event => {
            event.preventDefault()
            void searchMaterials(0, false)
          }}
        >
          <label className="sr-only" htmlFor="materialSearchQuery">{t('literature.searchMaterials')}</label>
          <input
            id="materialSearchQuery"
            maxLength={200}
            placeholder={t('literature.materialPlaceholder')}
            value={materialQuery}
            onChange={event => setMaterialQuery(event.target.value)}
          />
          <button className="secondary" type="submit">
            <Search size={15} />
            {t('literature.searchMaterials')}
          </button>
        </form>
        <div className="material-search-results">
          {materialLoading ? (
            <EmptyState text={t('literature.searchingMaterials')} />
          ) : materialRows.length ? (
            <>
              <p className="muted">{t('literature.materialTotal', { count: materialTotal })}</p>
              <div className="data-list">
                {materialRows.map((item, index) => (
                  <div className="data-row" key={index}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.kind || 'material'} · {item.parse_status || 'unknown'} · SHA-256 {String(item.sha256 || '').slice(0, 12)}… · {t('literature.similarity', { value: String(item.similarity ?? t('common.notProvided')) })}</p>
                      <p className="muted">{item.snippet || t('literature.noSnippet')}</p>
                    </div>
                    <span className="badge pending">{t('literature.semanticCandidate')}</span>
                  </div>
                ))}
              </div>
              {nextOffset != null ? (
                <button className="secondary material-search-more" type="button" onClick={() => searchMaterials(nextOffset, true)}>
                  <ChevronsDown size={15} />
                  {t('literature.loadMore')}
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState text={t('literature.materialsEmpty')} />
          )}
        </div>
      </div>

      <div className="section claim-review-panel">
        <SectionHeading title={t('literature.claimTitle')} hint={t('literature.claimHint')} />
        {project.evidence?.length ? (
          <>
            <label className="claim-review-input">
              {t('literature.claimToReview')}
              <textarea
                value={claimText}
                maxLength={4_000}
                rows={3}
                placeholder={t('literature.claimPlaceholder')}
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
                    <strong>{evidence.locator || t('literature.noLocator')}</strong>
                    <span>{evidence.quote || t('literature.noQuote')}</span>
                  </span>
                </label>
              ))}
            </div>
            <button className="secondary" type="button" disabled={!claimText.trim() || !selectedEvidence.length} onClick={() => void createClaimReview()}>
              {t('literature.submitReview')}
            </button>
          </>
        ) : <EmptyState text={t('literature.evidenceFirst')} />}
        {project.claim_reviews?.length ? (
          <div className="data-list claim-review-list">
            {project.claim_reviews.map(review => (
              <div className="data-row" key={review.id}>
                <div>
                  <h3>{review.claim}</h3>
                  <p>{t('literature.quoteCount', { count: review.evidence_ids.length })} · {review.evidence_status}</p>
                  {review.decision_comment ? <p className="muted">{review.decision_comment}</p> : null}
                </div>
                <div className="button-row">
                  <Badge status={review.status} />
                  {review.status === 'pending' ? (
                    <>
                      <button className="secondary" type="button" onClick={() => void decideClaimReview(review, 'accepted')}>{t('literature.acceptReview')}</button>
                      <button className="secondary" type="button" onClick={() => void decideClaimReview(review, 'rejected')}>{t('literature.rejectReview')}</button>
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
          <SectionHeading title={t('literature.externalCandidates')} hint={t('literature.externalHint')} extra={<Badge>{t('literature.count', { count: searchCandidates.length })}</Badge>} />
          <div className="data-list">
            {searchCandidates.map((item, index) => (
              <div className="data-row" key={index}>
                <div>
                  <h3><a href={item.url} target="_blank" rel="noreferrer">{item.name || item.title || item.url || t('literature.candidateResource')}</a></h3>
                  <p>
                    {item.resource_type || 'resource'} · {item.provider || 'unknown'} · robots {item.compliance?.robots_status || 'unknown'}
                    {item.compliance?.terms_url ? <> · <a href={item.compliance.terms_url} target="_blank" rel="noreferrer">{t('literature.viewTerms')}</a></> : null}
                  </p>
                  {item.snippet ? <p className="muted">{item.snippet}</p> : null}
                </div>
                <span className="badge pending">{t('literature.toVerify')}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {project.repositories?.length ? (
        <div className="section">
          <SectionHeading title={t('literature.repositoriesTitle')} hint={t('literature.repositoriesHint')} />
          <div className="data-list">
            {project.repositories.map(repository => (
              <div className="data-row" key={repository.id}>
                <div>
                  <h3>{repository.source_url}</h3>
                  <p>
                    {repository.license_spdx || t('literature.unknownLicense')} · commit {String(repository.commit_or_tag || t('literature.notPinned')).slice(0, 12)} ·
                    {repository.metadata?.verification?.match?.method || t('literature.notVerified')}
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
