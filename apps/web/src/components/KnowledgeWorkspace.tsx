import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  Braces,
  Check,
  FileDiff,
  FilePlus2,
  FileText,
  GitBranch,
  LoaderCircle,
  Network,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react'
import { api, errorMessage } from '../api'
import { formatDateTime, useTranslation } from '../i18n'
import type { KnowledgeDocumentDetail, KnowledgeDocumentRow, ProjectDetail, ResearchArea, TabId } from '../types'
import { MarkdownPreview } from './MarkdownPreview'
import { Badge, EmptyState, statusLabel } from './ui'

type ViewMode = 'preview' | 'source'
type DocumentFilter = 'scope' | 'all'
type DraftKind = 'idea' | 'paper_summary' | 'related_work_synthesis' | 'experiment_plan' | 'run_result' | 'experiment_synthesis' | 'writing_brief'

interface DiffLine {
  kind: 'context' | 'removed' | 'added'
  text: string
  line: number | null
}

const MAX_DIFF_LINES = 400

function compactSha(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—'
}

function documentTitle(row: KnowledgeDocumentRow): string {
  return typeof row.metadata.title === 'string' && row.metadata.title.trim() ? row.metadata.title : row.document_id
}

function lineDiff(before: string, after: string): { changed: boolean; lines: DiffLine[]; truncated: boolean } {
  const beforeLines = before.replace(/\n$/, '').split('\n')
  const afterLines = after.replace(/\n$/, '').split('\n')
  if (before === after) return { changed: false, lines: [], truncated: false }

  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1

  const contextBefore = beforeLines.slice(Math.max(0, prefix - 3), prefix).map((text, index) => ({
    kind: 'context' as const,
    text,
    line: Math.max(0, prefix - 3) + index + 1,
  }))
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix).map((text, index) => ({ kind: 'removed' as const, text, line: prefix + index + 1 }))
  const added = afterLines.slice(prefix, afterLines.length - suffix).map((text, index) => ({ kind: 'added' as const, text, line: prefix + index + 1 }))
  const contextAfter = suffix
    ? afterLines.slice(afterLines.length - suffix, Math.min(afterLines.length, afterLines.length - suffix + 3)).map((text, index) => ({
      kind: 'context' as const,
      text,
      line: afterLines.length - suffix + index + 1,
    }))
    : []
  const lines = [...contextBefore, ...removed, ...added, ...contextAfter]
  return { changed: true, lines: lines.slice(0, MAX_DIFF_LINES), truncated: lines.length > MAX_DIFF_LINES }
}

function scopeKey(area: ResearchArea, tab: TabId): string {
  return `${area}:${tab}`
}

function draftKindsFor(tab: TabId): DraftKind[] {
  if (tab === 'idea') return ['idea']
  if (tab === 'literature' || tab === 'visualization' || tab === 'seed_expansion') return ['paper_summary', 'related_work_synthesis']
  if (tab === 'method' || tab === 'reproduction') return ['experiment_plan', 'run_result', 'experiment_synthesis']
  if (['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'].includes(tab)) return ['writing_brief']
  return []
}

function defaultDraftKind(tab: TabId): DraftKind | null {
  return draftKindsFor(tab)[0] || null
}

function writingSection(tab: TabId): 'introduction' | 'related-work' | 'method' | 'experiments' | 'conclusion' {
  if (tab === 'paper_related_work') return 'related-work'
  if (tab === 'paper_method') return 'method'
  if (tab === 'paper_experiments') return 'experiments'
  if (tab === 'conclusion') return 'conclusion'
  return 'introduction'
}

function KnowledgeDraftControls({
  project,
  tab,
  onRefresh,
  showToast,
}: {
  project: ProjectDetail
  tab: TabId
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const availableKinds = draftKindsFor(tab)
  const [kind, setKind] = useState<DraftKind | null>(() => defaultDraftKind(tab))
  const [instruction, setInstruction] = useState('')
  const [paperId, setPaperId] = useState('')
  const [experimentId, setExperimentId] = useState('')
  const [readScope, setReadScope] = useState<'metadata' | 'abstract' | 'partial' | 'full_text'>('abstract')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setKind(defaultDraftKind(tab))
    setInstruction('')
  }, [tab])

  useEffect(() => {
    if (!paperId && project.papers?.[0]) setPaperId(project.papers[0].id)
    if (paperId && !project.papers?.some(item => item.id === paperId)) setPaperId(project.papers?.[0]?.id || '')
  }, [paperId, project.papers])

  useEffect(() => {
    if (!experimentId && project.experiments?.[0]) setExperimentId(project.experiments[0].id)
    if (experimentId && !project.experiments?.some(item => item.id === experimentId)) setExperimentId(project.experiments?.[0]?.id || '')
  }, [experimentId, project.experiments])

  if (!kind || !availableKinds.length) return null

  const needsPaper = kind === 'paper_summary'
  const needsExperiment = kind === 'experiment_plan' || kind === 'run_result' || kind === 'experiment_synthesis'
  const canSubmit = !busy
    && (kind !== 'idea' || instruction.trim().length >= 5)
    && (!needsPaper || Boolean(paperId))
    && (!needsExperiment || Boolean(experimentId))

  const createProposal = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const optionalInstruction = instruction.trim() ? { instruction: instruction.trim() } : {}
      const payload = kind === 'idea'
        ? { kind, instruction: instruction.trim(), ...(project.session_id ? { session_id: project.session_id } : {}) }
        : kind === 'paper_summary'
          ? { kind, paper_id: paperId, read_scope: readScope, ...optionalInstruction }
          : kind === 'related_work_synthesis'
            ? { kind, paper_ids: [], ...optionalInstruction }
            : kind === 'writing_brief'
              ? { kind, section: writingSection(tab), ...optionalInstruction }
              : {
                kind,
                experiment_id: experimentId,
                track: tab === 'reproduction' ? 'reproductions' : 'method',
                ...(kind === 'experiment_synthesis' ? { related_experiment_ids: [] } : {}),
                ...optionalInstruction,
              }
      const result = await api<{ proposal_id: string }>(`/api/projects/${encodeURIComponent(project.id)}/knowledge/proposals`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      showToast(t('knowledge.proposalCreated', { id: result.proposal_id.slice(0, 8) }))
      setInstruction('')
      await onRefresh()
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="knowledge-draft-controls">
      <summary><Sparkles size={15} />{t('knowledge.createDraft')}</summary>
      <div className="knowledge-draft-body">
        {availableKinds.length > 1 ? (
          <div className="knowledge-segmented" role="group" aria-label={t('knowledge.draftType')}>
            {availableKinds.map(item => (
              <button key={item} type="button" className={kind === item ? 'active' : ''} aria-pressed={kind === item} onClick={() => setKind(item)}>
                {t(`knowledge.kind.${item}`)}
              </button>
            ))}
          </div>
        ) : null}
        {needsPaper ? (
          <div className="knowledge-form-grid two-column">
            <label>
              <span>{t('knowledge.paper')}</span>
              <select value={paperId} onChange={event => setPaperId(event.target.value)}>
                {!project.papers?.length ? <option value="">{t('knowledge.noPapers')}</option> : null}
                {(project.papers || []).map(paper => <option key={paper.id} value={paper.id}>{paper.title}</option>)}
              </select>
            </label>
            <label>
              <span>{t('knowledge.readScope')}</span>
              <select value={readScope} onChange={event => setReadScope(event.target.value as typeof readScope)}>
                <option value="metadata">{t('knowledge.readScope.metadata')}</option>
                <option value="abstract">{t('knowledge.readScope.abstract')}</option>
                <option value="partial">{t('knowledge.readScope.partial')}</option>
                <option value="full_text">{t('knowledge.readScope.fullText')}</option>
              </select>
            </label>
          </div>
        ) : null}
        {needsExperiment ? (
          <label className="knowledge-field">
            <span>{t('knowledge.experiment')}</span>
            <select value={experimentId} onChange={event => setExperimentId(event.target.value)}>
              {!project.experiments?.length ? <option value="">{t('knowledge.noExperiments')}</option> : null}
              {(project.experiments || []).map(experiment => (
                <option key={experiment.id} value={experiment.id}>{experiment.experiment_type} · {experiment.status}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="knowledge-field">
          <span>{kind === 'idea' ? t('knowledge.instructionRequired') : t('knowledge.instruction')}</span>
          <textarea
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            placeholder={t('knowledge.instructionPlaceholder')}
            rows={3}
            maxLength={12_000}
          />
        </label>
        <div className="knowledge-draft-footer">
          <p>{t('knowledge.proposalBoundary')}</p>
          <button className="secondary" type="button" onClick={() => void createProposal()} disabled={!canSubmit}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <FilePlus2 size={15} />}
            {t('knowledge.createProposal')}
          </button>
        </div>
      </div>
    </details>
  )
}

function DocumentMeta({ detail }: { detail: KnowledgeDocumentDetail }) {
  const { t, locale } = useTranslation()
  const dependencies = Array.isArray(detail.parsed.frontmatter.depends_on) ? detail.parsed.frontmatter.depends_on as Array<Record<string, unknown>> : []
  return (
    <aside className="knowledge-document-meta" aria-label={t('knowledge.documentDetails')}>
      <dl>
        <div><dt>{t('knowledge.path')}</dt><dd><code>{detail.row.relative_path}</code></dd></div>
        <div><dt>SHA-256</dt><dd><code title={detail.row.current_sha256}>{compactSha(detail.row.current_sha256)}</code></dd></div>
        <div><dt>{t('knowledge.gitCommit')}</dt><dd><code>{compactSha(detail.row.current_git_commit)}</code>{detail.row.git_dirty ? <Badge status="dirty" /> : null}</dd></div>
        <div><dt>{t('knowledge.indexGeneration')}</dt><dd><code>{compactSha(detail.row.active_index_generation)}</code></dd></div>
        <div><dt>{t('knowledge.updated')}</dt><dd>{formatDateTime(detail.row.updated_at, locale)}</dd></div>
        <div><dt>{t('knowledge.structure')}</dt><dd>{t('knowledge.structureValue', { headings: detail.parsed.headings.length, chunks: detail.parsed.chunks.length })}</dd></div>
        {typeof detail.parsed.frontmatter.read_scope === 'string' ? <div><dt>{t('knowledge.readScope')}</dt><dd>{String(detail.parsed.frontmatter.read_scope)}</dd></div> : null}
      </dl>
      <details>
        <summary><GitBranch size={13} />{t('knowledge.dependencies', { count: dependencies.length })}</summary>
        {dependencies.length ? (
          <ul>
            {dependencies.map((dependency, index) => <li key={`${String(dependency.id)}-${index}`}><code>{String(dependency.id)}</code><span>{String(dependency.relation)} · {String(dependency.impact)}</span></li>)}
          </ul>
        ) : <p className="muted">{t('knowledge.noDependencies')}</p>}
      </details>
    </aside>
  )
}

export function KnowledgeWorkspace({
  project,
  area,
  tab,
  onRefresh,
  onOpenGraph,
  showToast,
}: {
  project: ProjectDetail
  area: ResearchArea
  tab: TabId
  onRefresh: () => Promise<void>
  onOpenGraph: () => void
  showToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const [documents, setDocuments] = useState<KnowledgeDocumentRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KnowledgeDocumentDetail | null>(null)
  const [filter, setFilter] = useState<DocumentFilter>('scope')
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const [editing, setEditing] = useState(false)
  const [draftSource, setDraftSource] = useState('')
  const [editReason, setEditReason] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [busy, setBusy] = useState<'reconcile' | 'index' | 'proposal' | null>(null)

  const currentScope = scopeKey(area, tab)
  const scopedDocuments = useMemo(() => documents.filter(row => Array.isArray(row.metadata.workspace_scopes) && row.metadata.workspace_scopes.includes(currentScope)), [currentScope, documents])
  const visibleDocuments = filter === 'scope' ? scopedDocuments : documents
  const diff = useMemo(() => lineDiff(detail?.source || '', draftSource), [detail?.source, draftSource])

  const loadDocuments = async (preferredId?: string | null) => {
    setLoading(true)
    setFailure('')
    try {
      const result = await api<{ documents: KnowledgeDocumentRow[] }>(`/api/projects/${encodeURIComponent(project.id)}/knowledge/documents`)
      setDocuments(result.documents)
      const candidates = filter === 'scope'
        ? result.documents.filter(row => Array.isArray(row.metadata.workspace_scopes) && row.metadata.workspace_scopes.includes(currentScope))
        : result.documents
      const nextId = preferredId && candidates.some(item => item.document_id === preferredId) ? preferredId : candidates[0]?.document_id || null
      setSelectedId(nextId)
    } catch (error) {
      setFailure(errorMessage(error))
      setDocuments([])
      setSelectedId(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadDocuments() }, [project.id, currentScope, filter])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    api<KnowledgeDocumentDetail>(`/api/projects/${encodeURIComponent(project.id)}/knowledge/documents/${encodeURIComponent(selectedId)}`)
      .then(result => {
        if (cancelled) return
        setDetail(result)
        setDraftSource(result.source)
        setEditing(false)
        setShowDiff(false)
        setEditReason('')
      })
      .catch(error => { if (!cancelled) setFailure(errorMessage(error)) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [project.id, selectedId])

  const reconcile = async () => {
    setBusy('reconcile')
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}/knowledge/reconcile`, { method: 'POST', body: JSON.stringify({ source: 'api' }) })
      await loadDocuments(selectedId)
      showToast(t('knowledge.reconciled'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const indexDocument = async () => {
    if (!detail) return
    setBusy('index')
    try {
      const result = await api<{ generation?: { id?: string } }>(`/api/projects/${encodeURIComponent(project.id)}/knowledge/index`, {
        method: 'POST',
        body: JSON.stringify({ document_id: detail.row.document_id }),
      })
      showToast(t('knowledge.indexQueued', { id: compactSha(result.generation?.id) }))
      await loadDocuments(detail.row.document_id)
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const createManualProposal = async () => {
    if (!detail || !diff.changed || editReason.trim().length < 5) return
    setBusy('proposal')
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${encodeURIComponent(project.id)}/knowledge/manual-proposals`, {
        method: 'POST',
        body: JSON.stringify({
          document_id: detail.row.document_id,
          expected_sha256: detail.row.current_sha256,
          source: draftSource,
          reason: editReason.trim(),
        }),
      })
      showToast(t('knowledge.proposalCreated', { id: result.proposal_id.slice(0, 8) }))
      setEditing(false)
      setShowDiff(false)
      setEditReason('')
      await onRefresh()
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="knowledge-workspace" aria-labelledby="knowledge-workspace-title">
      <header className="knowledge-workspace-head">
        <div className="knowledge-workspace-heading">
          <span className="knowledge-workspace-icon" aria-hidden="true"><BookOpenText size={17} /></span>
          <div>
            <h2 id="knowledge-workspace-title">{t('knowledge.workspaceTitle')}</h2>
            <p>{t('knowledge.workspaceHint')}</p>
          </div>
        </div>
        <div className="knowledge-workspace-tools">
          <span className="knowledge-count">{t('knowledge.documentCount', { count: documents.length })}</span>
          <button className="icon-btn" type="button" onClick={onOpenGraph} title={t('knowledge.openGraph')} aria-label={t('knowledge.openGraph')}>
            <Network size={15} />
          </button>
          <button className="icon-btn" type="button" onClick={() => void reconcile()} disabled={busy === 'reconcile'} title={t('knowledge.reconcile')} aria-label={t('knowledge.reconcile')}>
            <RefreshCw size={15} className={busy === 'reconcile' ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <KnowledgeDraftControls project={project} tab={tab} onRefresh={onRefresh} showToast={showToast} />

      <div className="knowledge-filterbar">
        <div className="knowledge-segmented" role="group" aria-label={t('knowledge.filterLabel')}>
          <button type="button" className={filter === 'scope' ? 'active' : ''} aria-pressed={filter === 'scope'} onClick={() => setFilter('scope')}>
            <Search size={13} />{t('knowledge.currentPage')} <span>{scopedDocuments.length}</span>
          </button>
          <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            <FileText size={13} />{t('knowledge.allDocuments')} <span>{documents.length}</span>
          </button>
        </div>
        <code>{currentScope}</code>
      </div>

      {failure ? <div className="form-error" role="alert">{failure}</div> : null}
      {loading ? <div className="knowledge-loading" role="status"><LoaderCircle size={17} className="spin" />{t('common.loading')}</div> : null}
      {!loading && !visibleDocuments.length ? <EmptyState text={filter === 'scope' ? t('knowledge.emptyScope') : t('knowledge.emptyAll')} /> : null}

      {!loading && visibleDocuments.length ? (
        <div className="knowledge-browser">
          <nav className="knowledge-document-list" aria-label={t('knowledge.documentList')}>
            {visibleDocuments.map(row => (
              <button key={row.document_id} type="button" className={selectedId === row.document_id ? 'active' : ''} aria-current={selectedId === row.document_id ? 'true' : undefined} onClick={() => setSelectedId(row.document_id)}>
                <span className="knowledge-document-list-icon"><FileText size={15} /></span>
                <span className="knowledge-document-list-copy">
                  <strong>{documentTitle(row)}</strong>
                  <small>{row.kind}</small>
                </span>
                <span className={`knowledge-health-dot health-${row.system_health}`} title={statusLabel(row.system_health, t)}>
                  <span className="sr-only">{statusLabel(row.system_health, t)}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="knowledge-document-pane">
            {detailLoading ? <div className="knowledge-loading" role="status"><LoaderCircle size={17} className="spin" />{t('common.loading')}</div> : null}
            {!detailLoading && detail ? (
              <>
                <header className="knowledge-document-head">
                  <div>
                    <div className="knowledge-document-badges"><Badge status={detail.row.author_status} /><Badge status={detail.row.system_health} /></div>
                    <h3>{documentTitle(detail.row)}</h3>
                    <p><code>{detail.row.document_id}</code></p>
                  </div>
                  <div className="knowledge-document-actions">
                    <button className="icon-btn" type="button" onClick={() => void indexDocument()} disabled={busy === 'index'} title={t('knowledge.indexDocument')} aria-label={t('knowledge.indexDocument')}>
                      <RotateCcw size={15} className={busy === 'index' ? 'spin' : ''} />
                    </button>
                    <button className="icon-btn" type="button" onClick={() => { setEditing(true); setViewMode('source') }} title={t('knowledge.edit')} aria-label={t('knowledge.edit')}>
                      <PencilLine size={15} />
                    </button>
                  </div>
                </header>

                <div className="knowledge-document-tabs" role="tablist" aria-label={t('knowledge.viewMode')}>
                  <button type="button" role="tab" aria-selected={viewMode === 'preview'} className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')}><BookOpenText size={14} />{t('knowledge.preview')}</button>
                  <button type="button" role="tab" aria-selected={viewMode === 'source'} className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}><Braces size={14} />{t('knowledge.source')}</button>
                </div>

                {viewMode === 'preview' ? <div className="knowledge-preview"><MarkdownPreview content={detail.parsed.body} /></div> : (
                  <div className="knowledge-source-editor">
                    <textarea aria-label={t('knowledge.source')} value={editing ? draftSource : detail.source} readOnly={!editing} onChange={event => setDraftSource(event.target.value)} spellCheck={false} />
                    {editing ? (
                      <div className="knowledge-edit-controls">
                        <label>
                          <span>{t('knowledge.editReason')}</span>
                          <input value={editReason} onChange={event => setEditReason(event.target.value)} maxLength={2_000} placeholder={t('knowledge.editReasonPlaceholder')} />
                        </label>
                        <div className="button-row">
                          <button className="secondary" type="button" onClick={() => { setDraftSource(detail.source); setEditing(false); setShowDiff(false); setEditReason('') }}><RotateCcw size={14} />{t('common.cancel')}</button>
                          <button className="secondary" type="button" disabled={!diff.changed} onClick={() => setShowDiff(previous => !previous)}><FileDiff size={14} />{showDiff ? t('knowledge.hideDiff') : t('knowledge.reviewDiff')}</button>
                          <button className="approve" type="button" disabled={!diff.changed || editReason.trim().length < 5 || busy === 'proposal'} onClick={() => void createManualProposal()}>
                            {busy === 'proposal' ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{t('knowledge.createProposal')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {editing && showDiff ? (
                  <section className="knowledge-diff" aria-label={t('knowledge.diffTitle')}>
                    <div className="knowledge-diff-head"><FileDiff size={14} /><strong>{t('knowledge.diffTitle')}</strong><span>{t('knowledge.diffBoundary')}</span></div>
                    <pre>{diff.lines.map((line, index) => <span key={`${line.kind}-${line.line}-${index}`} className={`diff-${line.kind}`}><i>{line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '}</i><b>{line.line ?? ''}</b><code>{line.text || ' '}</code></span>)}</pre>
                    {diff.truncated ? <p className="muted">{t('knowledge.diffTruncated')}</p> : null}
                  </section>
                ) : null}

                <DocumentMeta detail={detail} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
