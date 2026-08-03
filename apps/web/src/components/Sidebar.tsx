import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pin, PinOff, Settings, Share2, Trash2, Workflow } from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380
const PROJECT_LONG_PRESS_MS = 420
const PROJECT_DRAG_THRESHOLD = 8

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
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

type ProjectPointerState = {
  projectId: string
  pointerId: number
  button: HTMLButtonElement
  startX: number
  startY: number
  timer: number
  dragging: boolean
  changed: boolean
}

export function Sidebar({
  projects,
  activeProjectId,
  onNewProject,
  onOpenProject,
  onOpenMemory,
  onOpenSettings,
  onDeleteProject,
  onPinProject,
  onReorderProjects,
  sidebarWidth,
  onSidebarWidthChange,
}: {
  projects: ProjectSummary[]
  activeProjectId: string | null
  onNewProject: () => void
  onOpenProject: (id: string) => void
  onOpenMemory: () => void
  onOpenSettings: () => void
  onDeleteProject: (project: ProjectSummary) => void
  onPinProject: (project: ProjectSummary) => void
  onReorderProjects: (projectIds: string[]) => Promise<void>
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { t } = useTranslation()
  const [resizing, setResizing] = useState(false)
  const resizeFrame = useRef<number | null>(null)
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null)
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null)
  const [dragPreviewProjects, setDragPreviewProjects] = useState<ProjectSummary[] | null>(null)
  const [projectOrderBusy, setProjectOrderBusy] = useState(false)
  const dragStateRef = useRef<ProjectPointerState | null>(null)
  const dragPreviewRef = useRef<ProjectSummary[] | null>(null)
  const suppressProjectClickRef = useRef(false)
  const projectListRef = useRef<HTMLElement | null>(null)
  const rowPositionsRef = useRef<Map<string, number> | null>(null)

  useLayoutEffect(() => {
    const container = projectListRef.current
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
            row.style.transition = 'transform .5s var(--spring)'
            row.style.transform = ''
            row.style.willChange = ''
            window.setTimeout(() => {
              row.style.transition = ''
            }, 560)
          })
        }
      })
      rowPositionsRef.current = nextPositions
      return () => window.cancelAnimationFrame(frame)
    }
    rowPositionsRef.current = nextPositions
  }, [projects])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 760px)').matches) return
    event.preventDefault()
    const handle = event.currentTarget
    const shell = handle.closest<HTMLElement>('.app-shell')
    if (!shell) return
    const startX = event.clientX
    const startWidth = sidebarWidth
    let pendingWidth = startWidth
    setResizing(true)
    shell.classList.add('is-resizing')
    handle.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault()
      pendingWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX)
      if (resizeFrame.current !== null) return
      resizeFrame.current = window.requestAnimationFrame(() => {
        shell.style.setProperty('--sidebar-width', `${pendingWidth}px`)
        resizeFrame.current = null
      })
    }
    const stop = () => {
      if (resizeFrame.current !== null) {
        window.cancelAnimationFrame(resizeFrame.current)
        resizeFrame.current = null
      }
      shell.style.setProperty('--sidebar-width', `${pendingWidth}px`)
      onSidebarWidthChange(pendingWidth)
      shell.classList.remove('is-resizing')
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      handle.releasePointerCapture?.(event.pointerId)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      onSidebarWidthChange(clampSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 10 : -10)))
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onSidebarWidthChange(SIDEBAR_MIN_WIDTH)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onSidebarWidthChange(SIDEBAR_MAX_WIDTH)
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
    if (state.button.hasPointerCapture?.(state.pointerId)) state.button.releasePointerCapture?.(state.pointerId)
    dragStateRef.current = null
    const preview = dragPreviewRef.current
    const wasDragging = state.dragging
    const shouldCommit = commit && wasDragging && state.changed && preview
    setDraggingProjectId(null)
    setDragOverProjectId(null)
    setDragPreviewProjects(null)
    dragPreviewRef.current = null
    if (!wasDragging) return
    if (commit) {
      suppressProjectClickRef.current = true
      window.requestAnimationFrame(() => { suppressProjectClickRef.current = false })
    }
    if (!shouldCommit || !preview) return
    const dragged = preview.find(project => project.id === state.projectId)
    if (!dragged) return
    const projectIds = preview.filter(project => project.pinned === dragged.pinned).map(project => project.id)
    setProjectOrderBusy(true)
    void onReorderProjects(projectIds).finally(() => setProjectOrderBusy(false))
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
      setDragOverProjectId(null)
      return
    }
    const current = dragPreviewRef.current || projects
    const dragged = current.find(project => project.id === state.projectId)
    const target = current.find(project => project.id === targetId)
    if (!dragged || !target || dragged.pinned !== target.pinned) {
      setDragOverProjectId(null)
      return
    }
    const bounds = targetElement?.getBoundingClientRect()
    const next = reorderProjectPreview(current, state.projectId, targetId, !bounds || event.clientY < bounds.top + bounds.height / 2)
    if (next === current || next.map(project => project.id).join('|') === current.map(project => project.id).join('|')) {
      setDragOverProjectId(targetId)
      return
    }
    state.changed = true
    dragPreviewRef.current = next
    setDragPreviewProjects(next)
    setDragOverProjectId(targetId)
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

  const handleProjectPointerDown = (event: React.PointerEvent<HTMLButtonElement>, project: ProjectSummary) => {
    if (event.button !== 0 || projectOrderBusy || dragStateRef.current) return
    const state: ProjectPointerState = {
      projectId: project.id,
      pointerId: event.pointerId,
      button: event.currentTarget,
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
      state.button.setPointerCapture?.(state.pointerId)
      const preview = projects.slice()
      dragPreviewRef.current = preview
      setDragPreviewProjects(preview)
      setDraggingProjectId(state.projectId)
      setDragOverProjectId(state.projectId)
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

  const visibleProjects = dragPreviewProjects || projects

  return (
    <aside className="sidebar">
      <div
        className={`sidebar-resizer${resizing ? ' is-resizing' : ''}`}
        role="separator"
        tabIndex={0}
        aria-label={t('sidebar.resize')}
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        onPointerDown={startResize}
        onKeyDown={resizeByKeyboard}
      />
      <button className="brand" type="button" onClick={onNewProject} aria-label={t('sidebar.goHome')} title={t('sidebar.goHome')}>
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <span>Research OS</span>
      </button>
      <div className="side-label">{t('sidebar.projects')}</div>
      <nav className="project-list" ref={projectListRef} aria-label={t('sidebar.projects')}>
        {visibleProjects.length ? (
          visibleProjects.map(project => {
            return (
              <div
                key={project.id}
                className={`project-row${draggingProjectId === project.id ? ' is-dragging' : ''}`}
                data-project-id={project.id}
                data-dragging={draggingProjectId === project.id ? 'true' : 'false'}
                data-drop-target={dragOverProjectId === project.id && draggingProjectId !== project.id ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className={`project-main-button${project.id === activeProjectId ? ' active' : ''}`}
                  aria-current={project.id === activeProjectId ? 'page' : undefined}
                  aria-grabbed={draggingProjectId === project.id ? true : undefined}
                  title={project.title}
                  onPointerDown={event => handleProjectPointerDown(event, project)}
                  onClick={event => {
                    if (suppressProjectClickRef.current) {
                      event.preventDefault()
                      suppressProjectClickRef.current = false
                      return
                    }
                    onOpenProject(project.id)
                  }}
                >
                  <span className="project-title-text">{project.title}</span>
                </button>
                <div className="project-actions" onPointerDown={event => event.stopPropagation()}>
                  <div className="project-actions-track">
                    <button
                      type="button"
                      className={`project-action project-pin${project.pinned ? ' pinned' : ''}`}
                      aria-label={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                      title={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                      aria-pressed={project.pinned === true}
                      tabIndex={0}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation()
                        onPinProject(project)
                      }}
                    >
                      {project.pinned ? <PinOff size={15} strokeWidth={2.2} /> : <Pin size={15} strokeWidth={2.2} />}
                    </button>
                    <button
                      type="button"
                      className="project-action project-delete"
                      aria-label={t('sidebar.deleteProjectAction', { title: project.title })}
                      title={t('sidebar.deleteProjectAction', { title: project.title })}
                      tabIndex={0}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation()
                        onDeleteProject(project)
                      }}
                    >
                      <Trash2 size={15} strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="muted" style={{ padding: '4px 10px' }}>{t('sidebar.noProjects')}</div>
        )}
      </nav>
      <div className="service-links">
        <a href="/api/mastra/open" target="_blank" rel="noreferrer" title={t('sidebar.mastraWorkflows')}>
          <Workflow size={17} />
          {t('sidebar.mastraWorkflows')}
        </a>
        <button className="side-service" type="button" onClick={onOpenMemory} title={t('sidebar.memoryGraph')}>
          <Share2 size={17} />
          <span>{t('sidebar.memoryGraph')}</span>
        </button>
      </div>
      <button className="side-settings" type="button" onClick={onOpenSettings} title={t('sidebar.settings')}>
        <Settings size={17} />
        <span>{t('sidebar.settings')}</span>
      </button>
    </aside>
  )
}
