import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Folder,
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

const SLUG_PATTERN = /^([a-z]{2,32})-([a-z]{2,32})-([a-z0-9]{4})$/
const PROJECT_LONG_PRESS_MS = 420
const PROJECT_DRAG_THRESHOLD = 8

function isValidProjectSlug(value: string): boolean {
  const match = SLUG_PATTERN.exec(value)
  return Boolean(match && match[1] !== match[2])
}

type ProjectPointerState = {
  projectId: string
  pointerId: number
  row: HTMLElement
  startX: number
  startY: number
  timer: number
  dragging: boolean
  changed: boolean
}

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

function reorderProjectPreview(projects: ProjectSummary[], draggedId: string, targetId: string, insertBefore: boolean) {
  const draggedIndex = projects.findIndex(project => project.id === draggedId)
  const targetIndex = projects.findIndex(project => project.id === targetId)
  if (draggedIndex < 0 || targetIndex < 0 || draggedId === targetId) return projects
  const dragged = projects[draggedIndex]
  const target = projects[targetIndex]
  if (dragged.pinned !== target.pinned) return projects
  const remaining = projects.filter(project => project.id !== draggedId)
  const nextTargetIndex = remaining.findIndex(project => project.id === targetId)
  const insertIndex = nextTargetIndex + (insertBefore ? 0 : 1)
  remaining.splice(insertIndex, 0, dragged)
  return remaining
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
  const [dragPreviewProjects, setDragPreviewProjects] = useState<ProjectSummary[] | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  const dragStateRef = useRef<ProjectPointerState | null>(null)
  const dragPreviewRef = useRef<ProjectSummary[] | null>(null)
  const suppressProjectClickRef = useRef(false)
  const homeRowsRef = useRef<HTMLDivElement | null>(null)
  const dragStartPositionsRef = useRef<Map<string, number> | null>(null)
  const rowAnimationsRef = useRef<Animation[]>([])
  const pendingReorderRef = useRef(false)
  const visibleProjects = dragPreviewProjects || projects

  const captureRowPositions = () => {
    const container = homeRowsRef.current
    if (!container) return
    const positions = new Map<string, number>()
    for (const row of Array.from(container.querySelectorAll<HTMLElement>('[data-project-id]'))) {
      const id = row.dataset.projectId
      if (id) positions.set(id, row.getBoundingClientRect().top)
    }
    dragStartPositionsRef.current = positions
  }

  useLayoutEffect(() => {
    const container = homeRowsRef.current
    if (!container) return
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-project-id]'))
    const nextPositions = new Map<string, number>()
    for (const row of rows) {
      const id = row.dataset.projectId
      if (id) nextPositions.set(id, row.getBoundingClientRect().top)
    }
    const previousPositions = dragStartPositionsRef.current
    const movedRows = previousPositions && previousPositions.size
      ? rows.filter(row => {
          const id = row.dataset.projectId
          if (!id) return false
          const from = previousPositions.get(id)
          const to = nextPositions.get(id) ?? row.getBoundingClientRect().top
          return from !== undefined && Math.abs(from - to) >= 0.5
        })
      : []
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !movedRows.length) return
    for (const animation of rowAnimationsRef.current) animation.cancel()
    rowAnimationsRef.current = []
    for (const row of movedRows) {
      const id = row.dataset.projectId
      if (!id) continue
      const from = previousPositions.get(id)
      const to = nextPositions.get(id) ?? row.getBoundingClientRect().top
      if (from === undefined || Math.abs(from - to) < 0.5) continue
      const delta = from - to
      const animation = row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0px)' }],
        { duration: 560, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'none' },
      )
      animation.addEventListener('finish', () => {
        const index = rowAnimationsRef.current.indexOf(animation)
        if (index >= 0) rowAnimationsRef.current.splice(index, 1)
      }, { once: true })
      rowAnimationsRef.current.push(animation)
    }
    dragStartPositionsRef.current = null
  }, [visibleProjects])

  useEffect(() => () => {
    for (const animation of rowAnimationsRef.current) animation.cancel()
  }, [])

  useEffect(() => {
    if (!pendingReorderRef.current) return
    if (projects !== dragPreviewProjects) {
      pendingReorderRef.current = false
      dragPreviewRef.current = null
      setDragPreviewProjects(null)
    }
  }, [projects, dragPreviewProjects])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const normalizedSlug = slug.trim().toLocaleLowerCase('en-US')
    if (!normalizedSlug || !isValidProjectSlug(normalizedSlug)) {
      setFormError(t('home.slugInvalid'))
      return
    }
    if (projects.some(project => project.slug === normalizedSlug || project.id === normalizedSlug)) {
      setFormError(t('home.slugConflict'))
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

  const clearProjectPointerListeners = () => {
    window.removeEventListener('pointermove', handleProjectPointerMove)
    window.removeEventListener('pointerup', handleProjectPointerUp)
    window.removeEventListener('pointercancel', handleProjectPointerCancel)
  }

  const finishProjectPointer = (commit: boolean) => {
    const state = dragStateRef.current
    if (!state) return
    window.clearTimeout(state.timer)
    clearProjectPointerListeners()
    if (state.row.hasPointerCapture?.(state.pointerId)) state.row.releasePointerCapture?.(state.pointerId)
    dragStateRef.current = null
    const preview = dragPreviewRef.current
    const wasDragging = state.dragging
    const shouldCommit = commit && wasDragging && state.changed && preview
    setDraggingId(null)
    setDragOverId(null)
    if (shouldCommit) {
      pendingReorderRef.current = true
    } else {
      setDragPreviewProjects(null)
      dragPreviewRef.current = null
    }
    if (!wasDragging) return
    if (commit) {
      suppressProjectClickRef.current = true
      window.requestAnimationFrame(() => { suppressProjectClickRef.current = false })
    }
    if (!shouldCommit || !preview) return
    const dragged = preview.find(project => project.id === state.projectId)
    if (!dragged) return
    const projectIds = preview.filter(project => project.pinned === dragged.pinned).map(project => project.id)
    setReorderBusy(true)
    void onReorderProjects(projectIds).finally(() => setReorderBusy(false))
  }

  const handleProjectPointerMove = (event: globalThis.PointerEvent) => {
    const state = dragStateRef.current
    if (!state || event.pointerId !== state.pointerId) return
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (!state.dragging) {
      if (distance > PROJECT_DRAG_THRESHOLD) finishProjectPointer(false)
      return
    }
    event.preventDefault()
    const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-project-id]')
    const targetId = targetElement?.dataset.projectId
    if (!targetId || targetId === state.projectId) {
      setDragOverId(null)
      return
    }
    const current = dragPreviewRef.current || projects
    const dragged = current.find(project => project.id === state.projectId)
    const target = current.find(project => project.id === targetId)
    if (!dragged || !target || dragged.pinned !== target.pinned) {
      setDragOverId(null)
      return
    }
    const bounds = targetElement?.getBoundingClientRect()
    const next = reorderProjectPreview(current, state.projectId, targetId, !bounds || event.clientY < bounds.top + bounds.height / 2)
    if (next === current || next.map(project => project.id).join('|') === current.map(project => project.id).join('|')) {
      setDragOverId(targetId)
      return
    }
    state.changed = true
    captureRowPositions()
    dragPreviewRef.current = next
    setDragPreviewProjects(next)
    setDragOverId(targetId)
  }

  const handleProjectPointerUp = (event: globalThis.PointerEvent) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    finishProjectPointer(true)
  }

  const handleProjectPointerCancel = (event: globalThis.PointerEvent) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return
    finishProjectPointer(false)
  }

  const handleProjectPointerDown = (event: React.PointerEvent<HTMLElement>, project: ProjectSummary) => {
    if (event.button !== 0 || reorderBusy || dragStateRef.current) return
    const state: ProjectPointerState = {
      projectId: project.id,
      pointerId: event.pointerId,
      row: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
      dragging: false,
      changed: false,
    }
    dragStateRef.current = state
    state.timer = window.setTimeout(() => {
      if (dragStateRef.current !== state) return
      state.dragging = true
      state.row.setPointerCapture?.(state.pointerId)
      captureRowPositions()
      const preview = projects.slice()
      dragPreviewRef.current = preview
      setDragPreviewProjects(preview)
      setDraggingId(state.projectId)
      setDragOverId(state.projectId)
    }, PROJECT_LONG_PRESS_MS)
    window.addEventListener('pointermove', handleProjectPointerMove, { passive: false })
    window.addEventListener('pointerup', handleProjectPointerUp, { once: true })
    window.addEventListener('pointercancel', handleProjectPointerCancel, { once: true })
  }

  useEffect(() => () => {
    const state = dragStateRef.current
    if (state) window.clearTimeout(state.timer)
    clearProjectPointerListeners()
  }, [])

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
          <h1 className="home-eyebrow">{t('home.eyebrow')}</h1>
          <p className="home-description">{t('home.description')}</p>
        </div>
        <div className="home-hero-actions">
          {!creating && projects.length > 0 ? (
            <button className="primary home-create-toggle" type="button" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              {t('home.newProject')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="home-summary" aria-label={t('home.summary')}>
        <div className="home-summary-item">
          <span className="home-summary-icon home-summary-icon-blue">
            <Folder size={17} aria-hidden="true" />
          </span>
          <strong>{projects.length}</strong>
          <span>{t('home.totalProjects')}</span>
        </div>
        <div className="home-summary-item">
          <span className="home-summary-icon home-summary-icon-green">
            <FlaskConical size={17} aria-hidden="true" />
          </span>
          <strong>{totalRunning}</strong>
          <span>{t('home.runningExperiments')}</span>
        </div>
        <div className="home-summary-item">
          <span className="home-summary-icon home-summary-icon-amber">
            <ClipboardCheck size={17} aria-hidden="true" />
          </span>
          <strong>{totalPendingApprovals}</strong>
          <span>{t('home.pendingApprovals')}</span>
        </div>
        <div className="home-summary-item">
          <span className="home-summary-icon home-summary-icon-indigo">
            <FileText size={17} aria-hidden="true" />
          </span>
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
            <span className="project-table-col-drag" aria-hidden="true" />
            <span className="project-table-col-main">{t('home.project')}</span>
            <div className="project-table-col-stats">
              <span>{t('home.experiments')}</span>
              <span>{t('home.approvals')}</span>
              <span>{t('home.literature')}</span>
              <span>{t('home.paper')}</span>
            </div>
            <span className="project-table-col-updated">{t('home.updated')}</span>
            <span className="project-table-col-actions">{t('home.actions')}</span>
          </div>
          <div className="home-project-rows" ref={homeRowsRef} aria-label={t('sidebar.projects')}>
            {visibleProjects.map(project => {
              const running = project.experiment_running ?? 0
              const completed = project.experiment_completed ?? 0
              return (
                <article
                  key={project.id}
                  data-project-id={project.id}
                  className={`home-project-row${draggingId === project.id ? ' is-dragging' : ''}`}
                  data-drag-over={dragOverId === project.id && draggingId !== project.id ? 'true' : 'false'}
                  onPointerDown={event => handleProjectPointerDown(event, project)}
                >
                  <div className="home-project-drag" aria-hidden="true">
                    <GripVertical size={15} />
                  </div>
                  <button
                    className="home-project-main"
                    type="button"
                    title={project.title}
                    onClick={event => {
                      if (suppressProjectClickRef.current) {
                        event.preventDefault()
                        suppressProjectClickRef.current = false
                        return
                      }
                      onOpenProject(project.id)
                    }}
                  >
                    <span className="home-project-title-line">
                      <strong title={project.title}>{project.title}</strong>
                    </span>
                    <code className="home-project-slug" title={project.slug}>{project.slug}</code>
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
                  <div className="home-project-actions" onPointerDown={event => event.stopPropagation()}>
                    <button
                      className={`home-action home-pin-action${project.pinned ? ' is-pinned' : ''}`}
                      type="button"
                      aria-label={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                      title={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                      aria-pressed={project.pinned === true}
                      onClick={() => {
                        captureRowPositions()
                        void onPinProject(project)
                      }}
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
                    onPointerDown={event => event.stopPropagation()}
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
