import { useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  ClipboardCheck,
  FileText,
  FlaskConical,
  FolderPlus,
  GripVertical,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'
import { errorMessage } from '../api'

const SLUG_PATTERN = /^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/

function formatUpdatedAt(value: string | undefined, locale: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  } catch {
    return date.toLocaleDateString()
  }
}

function reorderWithinPinnedGroup(projects: ProjectSummary[], projectId: string, direction: -1 | 1): string[] {
  const target = projects.find(project => project.id === projectId)
  if (!target) return []
  const group = projects.filter(project => project.pinned === target.pinned)
  const from = group.findIndex(project => project.id === projectId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= group.length) return []
  const next = group.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map(project => project.id)
}

export function HomeDashboard({
  projects,
  loading,
  error,
  onRetry,
  onOpenProject,
  onCreateProject,
  onPinProject,
  onDeleteProject,
  onReorderProjects,
}: {
  projects: ProjectSummary[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenProject: (id: string) => void
  onCreateProject: (slug: string, title: string) => Promise<void>
  onPinProject: (project: ProjectSummary) => Promise<void>
  onDeleteProject: (project: ProjectSummary) => void
  onReorderProjects: (projectIds: string[]) => Promise<void>
}) {
  const { t, locale } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragSourceRef = useRef<string | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  const homeRowsRef = useRef<HTMLDivElement | null>(null)
  const rowPositionsRef = useRef<Map<string, number> | null>(null)

  useLayoutEffect(() => {
    const container = homeRowsRef.current
    if (!container) return
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-project-id]'))
    const nextPositions = new Map<string, number>()
    for (const row of rows) {
      const id = row.dataset.projectId
      if (id) nextPositions.set(id, row.getBoundingClientRect().top)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rowPositionsRef.current = nextPositions
      return
    }
    const previousPositions = rowPositionsRef.current
    if (previousPositions && previousPositions.size) {
      const frame = window.requestAnimationFrame(() => {
        for (const row of rows) {
          const id = row.dataset.projectId
          if (!id) continue
          const from = previousPositions.get(id)
          const to = row.getBoundingClientRect().top
          if (from === undefined || Math.abs(from - to) < 0.5) continue
          row.style.transition = 'none'
          row.style.transform = `translateY(${from - to}px)`
          row.style.willChange = 'transform'
          window.requestAnimationFrame(() => {
            row.style.transition = 'transform .56s var(--spring)'
            row.style.transform = ''
            row.style.willChange = ''
            window.setTimeout(() => {
              row.style.transition = ''
            }, 620)
          })
        }
      })
      rowPositionsRef.current = nextPositions
      return () => window.cancelAnimationFrame(frame)
    }
    rowPositionsRef.current = nextPositions
  }, [projects])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const normalizedSlug = slug.trim().toLocaleLowerCase('en-US')
    if (!normalizedSlug || !SLUG_PATTERN.test(normalizedSlug)) {
      setFormError(t('home.slugHint'))
      return
    }
    if (!title.trim()) {
      setFormError(t('home.titleRequired'))
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      await onCreateProject(normalizedSlug, title.trim())
      setTitle('')
      setSlug('')
      setCreating(false)
    } catch (createError) {
      setFormError(errorMessage(createError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDrop = (event: React.DragEvent, targetId: string) => {
    event.preventDefault()
    const sourceId = dragSourceRef.current
    dragSourceRef.current = null
    setDraggingId(null)
    setDragOverId(null)
    if (!sourceId || sourceId === targetId || reorderBusy) return
    const source = projects.find(project => project.id === sourceId)
    const target = projects.find(project => project.id === targetId)
    if (!source || !target || source.pinned !== target.pinned) return
    const group = projects.filter(project => project.pinned === source.pinned)
    const sourceIndex = group.findIndex(project => project.id === sourceId)
    const targetIndex = group.findIndex(project => project.id === targetId)
    const next = group.slice()
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    setReorderBusy(true)
    void onReorderProjects(next.map(project => project.id)).finally(() => setReorderBusy(false))
  }

  const moveByKeyboard = async (projectId: string, direction: -1 | 1) => {
    if (reorderBusy) return
    const ids = reorderWithinPinnedGroup(projects, projectId, direction)
    if (!ids.length) return
    setReorderBusy(true)
    try {
      await onReorderProjects(ids)
    } finally {
      setReorderBusy(false)
    }
  }

  const totalRunning = projects.reduce((sum, project) => sum + (project.experiment_running ?? 0), 0)
  const totalPendingApprovals = projects.reduce((sum, project) => sum + (project.pending_approvals ?? 0), 0)
  const totalPapers = projects.reduce((sum, project) => sum + (project.paper_count ?? 0), 0)

  return (
    <section className="home-dashboard" aria-busy={loading}>
      <div className="home-hero">
        <div>
          <p className="home-eyebrow">{t('home.eyebrow')}</p>
          <h2>{t('home.title')}</h2>
          <p className="home-description">{t('home.description')}</p>
        </div>
        <div className="home-hero-actions">
          {!creating ? (
            <button className="primary home-create-toggle" type="button" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              {t('home.newProject')}
            </button>
          ) : null}
          <button className="secondary home-refresh" type="button" onClick={onRetry} aria-label={t('home.retry')} title={t('home.retry')}>
            <RefreshCw size={15} aria-hidden="true" />
            {t('home.refresh')}
          </button>
        </div>
      </div>

      <div className="home-summary" aria-label={t('home.summary')}>
        <div className="home-summary-item">
          <strong>{projects.length}</strong>
          <span>{t('home.totalProjects')}</span>
        </div>
        <div className="home-summary-item">
          <strong>{totalRunning}</strong>
          <span>{t('home.runningExperiments')}</span>
        </div>
        <div className="home-summary-item">
          <strong>{totalPendingApprovals}</strong>
          <span>{t('home.pendingApprovals')}</span>
        </div>
        <div className="home-summary-item">
          <strong>{totalPapers}</strong>
          <span>{t('home.totalPapers')}</span>
        </div>
      </div>

      {creating ? (
        <form className="create-project-panel" onSubmit={handleCreate} aria-busy={submitting}>
          <div className="create-project-heading">
            <FolderPlus size={18} aria-hidden="true" />
            <div>
              <h3>{t('home.createTitle')}</h3>
              <p>{t('home.createDescription')}</p>
            </div>
          </div>
          <div className="create-project-fields">
            <label>
              <span>{t('home.titleLabel')}</span>
              <input
                className="home-input"
                value={title}
                maxLength={240}
                placeholder={t('home.titlePlaceholder')}
                autoComplete="off"
                onChange={event => setTitle(event.target.value)}
              />
            </label>
            <label>
              <span>{t('home.slugLabel')}</span>
              <input
                className="home-input home-slug-input"
                value={slug}
                maxLength={120}
                placeholder={t('home.slugPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                onChange={event => setSlug(event.target.value)}
              />
              <small>{t('home.slugHint')}</small>
            </label>
          </div>
          {formError ? <p className="form-error home-form-error" role="alert">{formError}</p> : null}
          <div className="create-project-actions">
            <button className="secondary" type="button" onClick={() => setCreating(false)} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button className="primary" type="submit" disabled={submitting || !title.trim() || !slug.trim()}>
              {t('home.createProject')}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="home-panel home-loading" aria-label={t('home.loading')}>
          <span className="home-skeleton home-skeleton-title" />
          <span className="home-skeleton home-skeleton-line" />
          <span className="home-skeleton home-skeleton-line" />
          <span className="home-skeleton home-skeleton-line" />
        </div>
      ) : error ? (
        <div className="home-panel home-error" role="alert">
          <RefreshCw size={22} aria-hidden="true" />
          <h3>{t('home.loadFailed')}</h3>
          <p>{error}</p>
          <button className="secondary" type="button" onClick={onRetry}>
            {t('home.retry')}
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="home-panel home-empty">
          <FolderPlus size={28} aria-hidden="true" />
          <h3>{t('home.noProjectsTitle')}</h3>
          <p>{t('home.noProjectsDescription')}</p>
          <button className="primary" type="button" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            {t('home.newProject')}
          </button>
        </div>
      ) : (
        <div className="home-panel project-list-panel">
          <div className="project-table-header" aria-hidden="true">
            <span>{t('home.project')}</span>
            <span>{t('home.experiments')}</span>
            <span>{t('home.approvals')}</span>
            <span>{t('home.literature')}</span>
            <span>{t('home.paper')}</span>
            <span>{t('home.updated')}</span>
            <span>{t('home.actions')}</span>
          </div>
          <div className="home-project-rows" ref={homeRowsRef} aria-label={t('sidebar.projects')}>
            {projects.map(project => {
              const running = project.experiment_running ?? 0
              const completed = project.experiment_completed ?? 0
              return (
                <article
                  key={project.id}
                  data-project-id={project.id}
                  className={`home-project-row${draggingId === project.id ? ' is-dragging' : ''}`}
                  data-drag-over={dragOverId === project.id && draggingId !== project.id ? 'true' : 'false'}
                  draggable={!reorderBusy}
                  onDragStart={event => {
                    dragSourceRef.current = project.id
                    setDraggingId(project.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={event => {
                    event.preventDefault()
                    if (dragOverId !== project.id) setDragOverId(project.id)
                  }}
                  onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverId(null)
                  }}
                  onDrop={event => handleDrop(event, project.id)}
                  onDragEnd={() => {
                    dragSourceRef.current = null
                    setDraggingId(null)
                    setDragOverId(null)
                  }}
                >
                  <div className="home-project-drag" aria-hidden="true">
                    <GripVertical size={15} />
                  </div>
                  <button
                    className="home-project-main"
                    type="button"
                    title={project.title}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span className="home-project-title-line">
                      <strong>{project.title}</strong>
                    </span>
                    <code className="home-project-slug">{project.slug}</code>
                    <span className={`home-status-badge status-${project.status || 'active'}`}>
                      {project.status === 'paused' ? t('home.statusPaused') : project.status === 'cancelled' ? t('home.statusCancelled') : t('home.statusActive')}
                    </span>
                  </button>
                  <div className="home-project-stats" aria-label={t('home.projectStats')}>
                    <div className="home-project-stat">
                      <FlaskConical size={14} aria-hidden="true" />
                      <strong>{project.experiment_total ?? 0}</strong>
                      <small>{running} {t('home.running')} · {completed} {t('home.completed')}</small>
                    </div>
                    <div className="home-project-stat">
                      <ClipboardCheck size={14} aria-hidden="true" />
                      <strong>{project.pending_approvals ?? 0}</strong>
                      <small>{t('home.pending')}</small>
                    </div>
                    <div className="home-project-stat">
                      <BookOpen size={14} aria-hidden="true" />
                      <strong>{project.related_work_count ?? 0}</strong>
                      <small>{t('home.candidates')}</small>
                    </div>
                    <div className="home-project-stat">
                      <FileText size={14} aria-hidden="true" />
                      <strong>{project.paper_count ?? 0}</strong>
                      <small>{t('home.documents')}</small>
                    </div>
                  </div>
                  <time className="home-project-updated" dateTime={project.updated_at}>
                    {formatUpdatedAt(project.updated_at, locale)}
                  </time>
                  <div className="home-project-actions">
                    <button
                      className={`home-action home-pin-action${project.pinned ? ' is-pinned' : ''}`}
                      type="button"
                      aria-label={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                      title={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                      aria-pressed={project.pinned === true}
                      onClick={() => void onPinProject(project)}
                    >
                      {project.pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
                    </button>
                    <button
                      className="home-action home-delete-action"
                      type="button"
                      aria-label={t('sidebar.deleteProjectAction', { title: project.title })}
                      title={t('sidebar.deleteProjectAction', { title: project.title })}
                      onClick={() => onDeleteProject(project)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                    <button
                      className="home-action home-open-action"
                      type="button"
                      aria-label={t('home.openProject', { title: project.title })}
                      title={t('home.openProject', { title: project.title })}
                      onClick={() => onOpenProject(project.id)}
                    >
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    className="home-reorder-handle"
                    type="button"
                    aria-label={t('home.reorderProject', { title: project.title })}
                    title={t('home.reorderProject', { title: project.title })}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    onKeyDown={event => {
                      if (event.key === 'ArrowUp' && (event.altKey || event.ctrlKey)) {
                        event.preventDefault()
                        void moveByKeyboard(project.id, -1)
                      }
                      if (event.key === 'ArrowDown' && (event.altKey || event.ctrlKey)) {
                        event.preventDefault()
                        void moveByKeyboard(project.id, 1)
                      }
                    }}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </button>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
