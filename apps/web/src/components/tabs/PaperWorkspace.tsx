import { useEffect, useState, type ReactNode } from 'react'
import {
  BarChart3,
  BookOpen,
  ExternalLink,
  FileCheck,
  FilePenLine,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Languages,
  Quote,
  RefreshCw,
  ScrollText,
  TriangleAlert,
} from 'lucide-react'
import { api, errorMessage, localizeFailure } from '../../api'
import type { Artifact, PaperSectionId, PaperWorkspaceDetail, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'
import { useTranslation } from '../../i18n'

const SECTION_ICONS: Record<PaperSectionId, ReactNode> = {
  introduction: <ScrollText size={15} />,
  paper_related_work: <Quote size={15} />,
  paper_method: <FlaskConical size={15} />,
  paper_experiments: <BarChart3 size={15} />,
  conclusion: <FileText size={15} />,
}

function sectionTabKey(id: PaperSectionId): 'tab.introduction' | 'tab.paperRelatedWork' | 'tab.paperMethod' | 'tab.paperExperiments' | 'tab.conclusion' {
  const keys: Record<PaperSectionId, 'tab.introduction' | 'tab.paperRelatedWork' | 'tab.paperMethod' | 'tab.paperExperiments' | 'tab.conclusion'> = {
    introduction: 'tab.introduction',
    paper_related_work: 'tab.paperRelatedWork',
    paper_method: 'tab.paperMethod',
    paper_experiments: 'tab.paperExperiments',
    conclusion: 'tab.conclusion',
  }
  return keys[id]
}

export function PaperWorkspace({
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
  const [workspace, setWorkspace] = useState<PaperWorkspaceDetail | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const activeSection = workspace?.sections.find(section => section.id === tab)
  const pdfArtifacts = (project.artifacts || []).filter(artifact =>
    artifact.valid !== false
    && /pdf/i.test(`${artifact.kind || ''} ${artifact.name} ${artifact.mime_type || ''}`),
  )
  const compileRuns = (project.experiments || []).filter(item => item.experiment_type === 'compile_latex')
  const latestCompile = compileRuns[0] || null

  const loadWorkspace = async () => {
    setWorkspace(null)
    setWorkspaceError(null)
    try {
      const data = await api<PaperWorkspaceDetail>(`/api/projects/${project.id}/paper-workspace`)
      setWorkspace(data)
    } catch (error) {
      setWorkspaceError(errorMessage(error))
    }
  }

  useEffect(() => {
    void loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(() => {
    setEditing(false)
    setDraftContent(activeSection?.source || '')
  }, [activeSection?.id, activeSection?.source])

  const createPaperDraft = async () => {
    setBusy('draft')
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/paper-draft`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('paper.draftProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const createCompilePlan = async () => {
    setBusy('compile')
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/compile-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('paper.compileProposal', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const saveSectionRevision = async () => {
    if (!activeSection) return
    setBusy(`edit:${activeSection.id}`)
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/paper-section`, {
        method: 'POST',
        body: JSON.stringify({ section_id: activeSection.id, content: draftContent }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('paperWorkspace.saveToast', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const statusLabel = (status: PaperSectionWorkspaceStatus) => {
    if (status === 'ready') return t('paperWorkspace.statusReady')
    if (status === 'draft') return t('paperWorkspace.statusDraft')
    return t('paperWorkspace.statusMissing')
  }

  return (
    <section className="paper-workspace" aria-label={t('paperWorkspace.title')}>
      <div className="workspace-head">
        <SectionHeading
          title={t('paperWorkspace.title')}
          hint={t('paperWorkspace.hint')}
          extra={
            <ButtonRow>
              <button className="secondary" type="button" disabled={busy === 'draft'} onClick={() => { void createPaperDraft() }}>
                <FilePenLine size={15} />
                {t('paperWorkspace.createDraft')}
              </button>
              <button className="secondary" type="button" disabled={busy === 'compile'} onClick={() => { void createCompilePlan() }}>
                <FileCheck size={15} />
                {t('paperWorkspace.createCompile')}
              </button>
              <button className="secondary" type="button" disabled={busy === 'refresh'} onClick={async () => { setBusy('refresh'); try { await Promise.all([loadWorkspace(), onRefresh()]) } finally { setBusy(null) } }}>
                <RefreshCw size={15} />
                {t('topbar.refresh')}
              </button>
            </ButtonRow>
          }
        />
      </div>
      <div className="workspace-split paper-workspace-split">
        <aside className="workspace-list-pane" aria-label={t('paperWorkspace.sections')}>
          <div className="workspace-pane-heading">
            <strong>{t('paperWorkspace.sections')}</strong>
            <Badge>{t('paperWorkspace.sectionCount', { count: workspace?.sections.length || 0 })}</Badge>
          </div>
          <div className="workspace-entry-list">
            {(workspace?.sections || []).map(section => (
              <button
                key={section.id}
                type="button"
                className={`workspace-entry${tab === section.id ? ' active' : ''}`}
                data-active={tab === section.id ? 'true' : 'false'}
                aria-current={tab === section.id ? 'true' : undefined}
                onClick={() => onNavigate(section.id)}
              >
                <span className="workspace-entry-icon">{SECTION_ICONS[section.id]}</span>
                <span className="workspace-entry-copy">
                  <strong>{t(sectionTabKey(section.id))}</strong>
                  <small>{section.citations.length ? t('paperWorkspace.citationMeta', { count: section.citations.length }) : t('paperWorkspace.noCitationMeta')}</small>
                </span>
                <span className="workspace-entry-side">
                  <Badge status={section.status}>{statusLabel(section.status)}</Badge>
                  {section.sentences.length ? <em>{section.sentences.length}</em> : null}
                </span>
              </button>
            ))}
          </div>
          <div className="paper-workspace-compile-card">
            <div className="paper-workspace-compile-title">
              <FileCheck size={14} />
              <strong>{t('paperWorkspace.compile')}</strong>
            </div>
            <div className="paper-workspace-compile-rows">
              <span><Badge status={latestCompile?.status || 'empty'}>{latestCompile ? latestCompile.status : t('paperWorkspace.noCompile')}</Badge></span>
              <span className="muted">{t('paperWorkspace.compileMeta', { runs: workspace?.compile_runs || 0, succeeded: workspace?.compile_succeeded || 0 })}</span>
            </div>
            {latestCompile?.error ? <p className="paper-workspace-error">{localizeFailure(latestCompile.status, latestCompile.error)}</p> : null}
            {pdfArtifacts.length ? <div className="muted">{t('paperWorkspace.pdfMeta', { count: pdfArtifacts.length })}</div> : null}
          </div>
        </aside>
        <div className="workspace-detail-pane paper-editor-pane" aria-live="polite">
          {workspaceError ? (
            <div className="inline-warning"><TriangleAlert size={15} /> {workspaceError}</div>
          ) : !activeSection ? (
            <EmptyState text={t('paperWorkspace.emptyWorkspace')} />
          ) : (
            <>
              <div className="workspace-detail-head">
                <div className="workspace-detail-title">
                  <div className="eyebrow">{t('paperWorkspace.editorEyebrow')}</div>
                  <h3>{t(sectionTabKey(activeSection.id))}</h3>
                  <p className="muted">{activeSection.heading} · {t('paperWorkspace.sentenceCount', { count: activeSection.sentences.length })}</p>
                </div>
                <ButtonRow>
                  <Badge status={activeSection.status}>{statusLabel(activeSection.status)}</Badge>
                  {editing ? (
                    <>
                      <button className="secondary" type="button" disabled={busy === `edit:${activeSection.id}`} onClick={() => { void saveSectionRevision() }}>
                        <FileCheck size={15} />
                        {t('paperWorkspace.saveRevision')}
                      </button>
                      <button className="secondary" type="button" onClick={() => { setEditing(false); setDraftContent(activeSection.source) }}>
                        {t('paperWorkspace.cancel')}
                      </button>
                    </>
                  ) : (
                    <button className="secondary" type="button" onClick={() => { setEditing(true); setDraftContent(activeSection.source) }}>
                      <FilePenLine size={15} />
                      {t('paperWorkspace.edit')}
                    </button>
                  )}
                </ButtonRow>
              </div>

              {editing ? (
                <div className="paper-source-editor">
                  <div className="paper-bilingual-heading">
                    <FilePenLine size={14} />
                    <strong>{t('paperWorkspace.editHint')}</strong>
                  </div>
                  <textarea
                    value={draftContent}
                    onChange={event => setDraftContent(event.target.value)}
                    spellCheck={false}
                    aria-label={t('paperWorkspace.edit')}
                    placeholder={t('paperWorkspace.editPlaceholder')}
                  />
                </div>
              ) : (
                <div className="paper-bilingual">
                  <div className="paper-bilingual-pane paper-manuscript-pane">
                    <div className="paper-bilingual-heading">
                      <ScrollText size={14} />
                      <strong>{t('paperWorkspace.manuscript')}</strong>
                    </div>
                    {activeSection.sentences.length ? (
                      <div className="paper-sentence-list">
                        {activeSection.sentences.map((sentence, index) => (
                          <p key={`${sentence.en}-${index}`}>{sentence.en}</p>
                        ))}
                      </div>
                    ) : activeSection.english ? (
                      <pre className="paper-raw-manuscript">{activeSection.english}</pre>
                    ) : (
                      <EmptyState text={t('paperWorkspace.missingManuscript')} />
                    )}
                  </div>
                  <div className="paper-bilingual-pane paper-translation-pane">
                    <div className="paper-bilingual-heading">
                      <Languages size={14} />
                      <strong>{t('paperWorkspace.translation')}</strong>
                      <span className="paper-translation-note">{t('paperWorkspace.translationNote')}</span>
                    </div>
                    {activeSection.sentences.length ? (
                      <div className="paper-sentence-list">
                        {activeSection.sentences.map((sentence, index) => (
                          <p key={`${sentence.en}-${index}`} className={sentence.zh ? 'paper-translation-ready' : 'paper-translation-pending'}>
                            {sentence.zh || t('paperWorkspace.translationPending')}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text={t('paperWorkspace.translationMissing')} />
                    )}
                  </div>
                </div>
              )}

              <div className="paper-workspace-section">
                <div className="paper-workspace-section-head">
                  <BookOpen size={14} />
                  <h4>{t('paperWorkspace.citations')}</h4>
                  <Badge>{t('paperWorkspace.citationCount', { count: activeSection.citations.length })}</Badge>
                </div>
                {activeSection.citations.length ? (
                  <div className="data-list paper-workspace-detail-list">
                    {activeSection.citations.map(citation => {
                      const reference = workspace?.references.find(item => item.key === citation)
                      const paper = (project.papers || []).find(item => item.bibtex?.includes(citation) || item.title === reference?.title)
                      return (
                        <div className="data-row" key={citation}>
                          <div>
                            <h3>{reference?.title || citation}</h3>
                            <p>{reference ? `${reference.authors || t('common.unrecorded')} · ${reference.year || t('literature.yearUnknown')} · ${reference.venue || t('common.unrecorded')}` : t('paperWorkspace.citationUnresolved')}</p>
                          </div>
                          <Badge status={paper?.confirmed ? 'confirmed' : paper ? 'metadata-only' : 'unresolved'}>
                            {paper?.confirmed ? t('paperWorkspace.confirmedSource') : paper ? t('paperWorkspace.projectSource') : t('paperWorkspace.unresolvedSource')}
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState text={t('paperWorkspace.noCitations')} />
                )}
              </div>

              <div className="paper-workspace-section">
                <div className="paper-workspace-section-head">
                  <ImageIcon size={14} />
                  <h4>{t('paperWorkspace.figures')}</h4>
                  <Badge>{t('paperWorkspace.figureCount', { count: activeSection.figure_refs.length })}</Badge>
                </div>
                {activeSection.figure_refs.length ? (
                  <div className="data-list paper-workspace-detail-list">
                    {activeSection.figure_refs.map(ref => (
                      <div className="data-row" key={ref}>
                        <div><h3><code>{ref}</code></h3><p className="muted">{t('paperWorkspace.figureRefHint')}</p></div>
                        <Badge status="candidate" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text={t('paperWorkspace.noFigures')} />
                )}
              </div>

              <div className="paper-workspace-section">
                <div className="paper-workspace-section-head">
                  <FileCheck size={14} />
                  <h4>{t('paperWorkspace.compile')}</h4>
                  <Badge status={latestCompile?.status || 'empty'}>{latestCompile?.status || t('paperWorkspace.noCompile')}</Badge>
                </div>
                <div className="data-list paper-workspace-detail-list">
                  <div className="data-row">
                    <div><h3>{t('paperWorkspace.sourceFile')}</h3><p><code>{workspace?.source_path || ''}</code></p></div>
                    <Badge status={workspace?.has_source ? 'ready' : 'blocked'}>{workspace?.has_source ? t('paperWorkspace.sourcePresent') : t('paperWorkspace.sourceMissing')}</Badge>
                  </div>
                  {workspace?.source_commit ? (
                    <div className="data-row">
                      <div><h3>{t('paperWorkspace.sourceCommit')}</h3><p><code>{workspace.source_commit.slice(0, 12)}</code> · {workspace.source_dirty ? t('paperWorkspace.sourceDirty') : t('paperWorkspace.sourceClean')}</p></div>
                      <Badge status={workspace.source_dirty ? 'candidate' : 'verified'}>{workspace.source_dirty ? t('paperWorkspace.dirty') : t('paperWorkspace.clean')}</Badge>
                    </div>
                  ) : null}
                  <div className="data-row">
                    <div><h3>{t('paperWorkspace.compileRuns')}</h3><p>{t('paperWorkspace.compileMeta', { runs: workspace?.compile_runs || 0, succeeded: workspace?.compile_succeeded || 0 })}</p></div>
                    <Badge status={workspace?.compile_succeeded ? 'succeeded' : workspace?.compile_runs ? 'failed' : 'empty'} />
                  </div>
                </div>
                {latestCompile?.error ? <div className="inline-warning"><TriangleAlert size={15} /> {localizeFailure(latestCompile.status, latestCompile.error)}</div> : null}
                <div className="paper-pdf-grid">
                  {pdfArtifacts.length ? pdfArtifacts.map(artifact => <PdfCard key={artifact.id} artifact={artifact} />) : <EmptyState text={t('paperWorkspace.noPdf')} />}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function PdfCard({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation()
  return (
    <div className="paper-pdf-card">
      <div className="paper-pdf-card-icon"><FileText size={16} /></div>
      <div className="paper-pdf-card-copy">
        <strong>{artifact.name}</strong>
        <small>{artifact.sha256 ? `SHA-256 ${artifact.sha256.slice(0, 12)}…` : t('common.unrecorded')}</small>
      </div>
      {artifact.download_url ? (
        <a className="paper-pdf-open" href={artifact.download_url} target="_blank" rel="noreferrer" aria-label={`${t('paperWorkspace.openPdf')} ${artifact.name}`}>
          <ExternalLink size={14} />
          {t('paperWorkspace.openPdf')}
        </a>
      ) : null}
    </div>
  )
}

type PaperSectionWorkspaceStatus = 'missing' | 'draft' | 'ready'
