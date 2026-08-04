import { useState } from 'react'
import {
  FlaskConical,
  FolderKanban,
  Pin,
  RefreshCw,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380
const QUICK_ACCESS_LIMIT = 5

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function getQuickAccessProjects(projects: ProjectSummary[], recentIds: string[]) {
  const recentRank = new Map(recentIds.map((id, index) => [id, index]))
  const pinned = projects.filter(project => project.pinned)
  const recent = projects
    .filter(project => !project.pinned && recentRank.has(project.id))
    .sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0))
  const fillers = projects.filter(project => !project.pinned && !recentRank.has(project.id))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return [...pinned, ...recent, ...fillers].slice(0, QUICK_ACCESS_LIMIT)
}

export function HomeSidebar({
  projects,
  health,
  refreshing = false,
  recentProjectIds,
  onGoHome,
  onOpenProject,
  onOpenSettings,
  onRefresh,
  sidebarWidth,
  onSidebarWidthChange,
}: {
  projects: ProjectSummary[]
  health: 'connecting' | 'online' | 'offline'
  refreshing?: boolean
  recentProjectIds: string[]
  onGoHome: () => void
  onOpenProject: (id: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { t } = useTranslation()
  const [resizing, setResizing] = useState(false)
  const quickProjects = getQuickAccessProjects(projects, recentProjectIds)
  const running = projects.reduce((sum, project) => sum + (project.experiment_running ?? 0), 0)
  const pending = projects.reduce((sum, project) => sum + (project.pending_approvals ?? 0), 0)
  const healthLabel = health === 'online' ? t('topbar.connected') : health === 'offline' ? t('topbar.offline') : t('topbar.connecting')
  const refreshLabel = refreshing ? t('topbar.refreshingProject') : t('home.refresh')

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
      shell.style.setProperty('--sidebar-width', `${pendingWidth}px`)
    }
    const stop = () => {
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
    <aside className="sidebar home-sidebar">
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
      <button className="brand home-sidebar-brand" type="button" onClick={onGoHome} aria-label={t('sidebar.goHome')} title={t('sidebar.goHome')}>
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <span>Research OS</span>
      </button>

      <div className="home-sidebar-section">
        <div className="home-sidebar-section-label">{t('homeSidebar.quickAccess')}</div>
        {quickProjects.length ? (
          <div className="home-sidebar-quick-list">
            {quickProjects.map(project => (
              <button
                key={project.id}
                type="button"
                className="home-sidebar-project"
                title={project.title}
                onClick={() => onOpenProject(project.id)}
              >
                <span className="home-sidebar-project-title">{project.title}</span>
                {project.pinned ? <Pin size={11} className="home-sidebar-project-pin" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="home-sidebar-empty">{t('homeSidebar.noQuickProjects')}</div>
        )}
      </div>

      <div className="home-sidebar-system">
        <div className="home-sidebar-section-label">{t('homeSidebar.system')}</div>
        <div className="home-sidebar-system-row">
          <span className={`home-sidebar-health${health === 'online' ? ' is-ok' : health === 'offline' ? ' is-offline' : ''}`}>
            <span className="home-sidebar-health-dot" aria-hidden="true" />
            {healthLabel}
          </span>
          <button
            className={`icon-btn refresh-btn home-sidebar-refresh${refreshing ? ' is-refreshing' : ''}`}
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="home-sidebar-stats">
          <div className="home-sidebar-stat">
            <FolderKanban size={14} aria-hidden="true" />
            <strong>{projects.length}</strong>
            <small>{t('homeSidebar.totalProjects')}</small>
          </div>
          <div className="home-sidebar-stat">
            <FlaskConical size={14} aria-hidden="true" />
            <strong>{running}</strong>
            <small>{t('homeSidebar.runningExperiments')}</small>
          </div>
          <div className="home-sidebar-stat">
            <ShieldCheck size={14} aria-hidden="true" />
            <strong>{pending}</strong>
            <small>{t('homeSidebar.pendingApprovals')}</small>
          </div>
        </div>
      </div>

      <button className="side-settings" type="button" onClick={onOpenSettings} title={t('sidebar.settings')}>
        <Settings size={17} />
        <span>{t('sidebar.settings')}</span>
      </button>
    </aside>
  )
}
