import { useRef, useState } from 'react'
import { Plus, Settings, Share2, Trash2, Workflow } from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export function Sidebar({
  projects,
  activeProjectId,
  onNewProject,
  onOpenProject,
  onOpenMemory,
  onOpenSettings,
  onDeleteProject,
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
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { t } = useTranslation()
  const [visibleActions, setVisibleActions] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, number>())
  const [resizing, setResizing] = useState(false)
  const resizeFrame = useRef<number | null>(null)

  const startProjectHover = (projectId: string) => {
    const currentTimer = timers.current.get(projectId)
    if (currentTimer !== undefined) window.clearTimeout(currentTimer)
    const timer = window.setTimeout(() => {
      setVisibleActions(current => new Set(current).add(projectId))
      timers.current.delete(projectId)
    }, 3000)
    timers.current.set(projectId, timer)
  }

  const stopProjectHover = (projectId: string) => {
    const timer = timers.current.get(projectId)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(projectId)
    setVisibleActions(current => {
      if (!current.has(projectId)) return current
      const next = new Set(current)
      next.delete(projectId)
      return next
    })
  }

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
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <span>Research OS</span>
      </div>
      <button className="primary full" type="button" onClick={onNewProject}>
        <Plus size={17} />
        {t('sidebar.newProject')}
      </button>
      <div className="side-label">{t('sidebar.projects')}</div>
      <nav className="project-list" aria-label={t('sidebar.projects')}>
        {projects.length ? (
          projects.map(project => {
            const actionsVisible = visibleActions.has(project.id)
            return (
              <div
                key={project.id}
                className={`project-row${actionsVisible ? ' actions-visible' : ''}`}
                onMouseEnter={() => startProjectHover(project.id)}
                onMouseLeave={() => stopProjectHover(project.id)}
                onFocus={() => setVisibleActions(current => new Set(current).add(project.id))}
                onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stopProjectHover(project.id)
                }}
              >
                <button
                  type="button"
                  className={`project-main-button${project.id === activeProjectId ? ' active' : ''}`}
                  aria-current={project.id === activeProjectId ? 'page' : undefined}
                  title={project.title}
                  onClick={() => onOpenProject(project.id)}
                >
                  {project.title}
                </button>
                <button
                  type="button"
                  className={`project-more${actionsVisible ? ' visible' : ''}`}
                  aria-label={t('sidebar.deleteProjectAction', { title: project.title })}
                  title={t('sidebar.deleteProjectAction', { title: project.title })}
                  tabIndex={actionsVisible ? 0 : -1}
                  onClick={event => {
                    event.stopPropagation()
                    onDeleteProject(project)
                  }}
                >
                  <Trash2 size={16} strokeWidth={2.2} />
                </button>
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
      <button className="side-settings" type="button" onClick={onOpenSettings} title={t('sidebar.modelSettings')}>
        <Settings size={17} />
        <span>{t('sidebar.modelSettings')}</span>
      </button>
    </aside>
  )
}
