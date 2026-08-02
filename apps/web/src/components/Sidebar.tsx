import { useEffect, useRef, useState } from 'react'
import { Pin, PinOff, Plus, Settings, Share2, Trash2, Workflow } from 'lucide-react'
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
  onPinProject,
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
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { t } = useTranslation()
  const [actionReveal, setActionReveal] = useState<Map<string, 'hidden' | 'partial' | 'full'>>(new Map())
  const timers = useRef(new Map<string, { full?: number }>())
  const actionElements = useRef(new Map<string, HTMLDivElement>())
  const actionFrames = useRef(new Map<string, number>())
  const actionProgress = useRef(new Map<string, number>())
  const [resizing, setResizing] = useState(false)
  const resizeFrame = useRef<number | null>(null)

  const setActionVisual = (projectId: string, progress: number) => {
    const value = Math.min(1, Math.max(0, progress))
    const element = actionElements.current.get(projectId)
    if (element) {
      element.style.opacity = String(value)
      element.style.transform = `translate(${48 * (1 - value)}px, -50%) scale(${0.92 + value * 0.08})`
    }
    actionProgress.current.set(projectId, value)
  }

  const cancelActionFrame = (projectId: string) => {
    const frame = actionFrames.current.get(projectId)
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    actionFrames.current.delete(projectId)
  }

  const animateProjectActionsIn = (projectId: string) => {
    cancelActionFrame(projectId)
    setActionVisual(projectId, 0)
    const startedAt = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / 3000)
      const progress = elapsed < 0.3
        ? elapsed / 0.3 * 0.03
        : 0.03 + (1 - Math.pow(1 - (elapsed - 0.3) / 0.7, 3)) * 0.97
      setActionVisual(projectId, progress)
      if (elapsed < 1) actionFrames.current.set(projectId, window.requestAnimationFrame(tick))
      else {
        actionFrames.current.delete(projectId)
        setActionReveal(current => {
          const next = new Map(current)
          next.set(projectId, 'full')
          return next
        })
      }
    }
    actionFrames.current.set(projectId, window.requestAnimationFrame(tick))
  }

  const animateProjectActionsOut = (projectId: string) => {
    cancelActionFrame(projectId)
    const initial = actionProgress.current.get(projectId) || 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / 360)
      const eased = 1 - Math.pow(1 - elapsed, 3)
      setActionVisual(projectId, initial * (1 - eased))
      if (elapsed < 1) actionFrames.current.set(projectId, window.requestAnimationFrame(tick))
      else {
        actionFrames.current.delete(projectId)
        setActionVisual(projectId, 0)
      }
    }
    actionFrames.current.set(projectId, window.requestAnimationFrame(tick))
  }

  useEffect(() => () => {
    actionFrames.current.forEach(frame => window.cancelAnimationFrame(frame))
    timers.current.forEach(timer => {
      if (timer.full !== undefined) window.clearTimeout(timer.full)
    })
  }, [])

  const startProjectHover = (projectId: string) => {
    const currentTimers = timers.current.get(projectId)
    if (currentTimers?.full !== undefined) window.clearTimeout(currentTimers.full)
    setActionReveal(current => {
      const next = new Map(current)
      next.set(projectId, 'partial')
      return next
    })
    animateProjectActionsIn(projectId)
    const full = window.setTimeout(() => {
      setActionReveal(current => {
        const next = new Map(current)
        next.set(projectId, 'full')
        return next
      })
      timers.current.delete(projectId)
    }, 3000)
    timers.current.set(projectId, { full })
  }

  const stopProjectHover = (projectId: string) => {
    const currentTimers = timers.current.get(projectId)
    if (currentTimers?.full !== undefined) window.clearTimeout(currentTimers.full)
    timers.current.delete(projectId)
    animateProjectActionsOut(projectId)
    setActionReveal(current => {
      if (!current.has(projectId)) return current
      const next = new Map(current)
      next.set(projectId, 'hidden')
      return next
    })
  }

  const revealProjectActions = (projectId: string) => {
    const currentTimers = timers.current.get(projectId)
    if (currentTimers?.full !== undefined) window.clearTimeout(currentTimers.full)
    timers.current.delete(projectId)
    cancelActionFrame(projectId)
    setActionVisual(projectId, 1)
    setActionReveal(current => {
      const next = new Map(current)
      next.set(projectId, 'full')
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
      <button className="brand" type="button" onClick={onNewProject} aria-label={t('sidebar.goHome')} title={t('sidebar.goHome')}>
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <span>Research OS</span>
      </button>
      <button className="primary full" type="button" onClick={onNewProject}>
        <Plus size={17} />
        {t('sidebar.newProject')}
      </button>
      <div className="side-label">{t('sidebar.projects')}</div>
      <nav className="project-list" aria-label={t('sidebar.projects')}>
        {projects.length ? (
          projects.map(project => {
            const reveal = actionReveal.get(project.id) || 'hidden'
            const actionsVisible = reveal !== 'hidden'
            return (
              <div
                key={project.id}
                className={`project-row project-actions-${reveal}`}
                onMouseEnter={() => startProjectHover(project.id)}
                onMouseLeave={() => stopProjectHover(project.id)}
                onFocus={event => {
                  if ((event.target as HTMLElement).matches(':focus-visible')) revealProjectActions(project.id)
                }}
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
                  <span className="project-title-text">{project.title}</span>
                  {project.pinned ? <Pin className="project-pinned-indicator" size={13} strokeWidth={2.2} aria-hidden="true" /> : null}
                </button>
                <div
                  ref={element => {
                    if (element) actionElements.current.set(project.id, element)
                    else actionElements.current.delete(project.id)
                  }}
                  className={`project-actions${actionsVisible ? ' visible' : ''}`}
                  aria-hidden={!actionsVisible}
                >
                  <button
                    type="button"
                    className={`project-action project-pin${project.pinned ? ' pinned' : ''}`}
                    aria-label={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                    title={t(project.pinned ? 'sidebar.unpinProjectAction' : 'sidebar.pinProjectAction', { title: project.title })}
                    aria-pressed={project.pinned === true}
                    tabIndex={reveal === 'full' ? 0 : -1}
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
                    tabIndex={reveal === 'full' ? 0 : -1}
                    onClick={event => {
                      event.stopPropagation()
                      onDeleteProject(project)
                    }}
                  >
                    <Trash2 size={15} strokeWidth={2.2} />
                  </button>
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
      <button className="side-settings" type="button" onClick={onOpenSettings} title={t('sidebar.modelSettings')}>
        <Settings size={17} />
        <span>{t('sidebar.modelSettings')}</span>
      </button>
    </aside>
  )
}
