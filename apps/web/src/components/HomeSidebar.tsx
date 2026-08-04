import { useEffect, useState } from 'react'
import {
  FolderKanban,
  History,
  Pin,
  RefreshCw,
  Settings,
} from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation, type Locale, type TranslationKey } from '../i18n'

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380
const RECENT_PROJECTS_LIMIT = 8

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

type RecentProjectEntry = { id: string; openedAt: number }

function formatOpenedAt(
  timestamp: number,
  locale: Locale,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  now: number,
): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return t('homeSidebar.justNow')
  if (elapsed < 3_600_000) return t('homeSidebar.minutesAgo', { n: Math.floor(elapsed / 60_000) })
  if (elapsed < 86_400_000) return t('homeSidebar.hoursAgo', { n: Math.floor(elapsed / 3_600_000) })
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const localeTag = locale === 'zh-CN' || locale === 'zh-TW' ? 'zh-CN' : locale
  if (elapsed < 172_800_000) {
    const time = new Intl.DateTimeFormat(localeTag, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
    return t('homeSidebar.yesterday', { time })
  }
  if (elapsed < 604_800_000) {
    return t('homeSidebar.daysAgo', { n: Math.floor(elapsed / 86_400_000) })
  }
  try {
    return new Intl.DateTimeFormat(localeTag, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return ''
  }
}

function getRecentProjects(projects: ProjectSummary[], recentEntries: RecentProjectEntry[]) {
  const recentRank = new Map(recentEntries.map((entry, index) => [entry.id, index]))
  const pinned = projects.filter(project => project.pinned)
  const recent = projects
    .filter(project => !project.pinned && recentRank.has(project.id))
    .sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0))
  const fillers = projects.filter(project => !project.pinned && !recentRank.has(project.id))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return [...pinned, ...recent, ...fillers].slice(0, RECENT_PROJECTS_LIMIT)
}

export function HomeSidebar({
  projects,
  health,
  refreshing = false,
  recentProjects,
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
  recentProjects: RecentProjectEntry[]
  onGoHome: () => void
  onOpenProject: (id: string) => void
  onOpenSettings: () => void
  onRefresh: () => void
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { t, locale } = useTranslation()
  const [resizing, setResizing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const recentEntries = getRecentProjects(projects, recentProjects)
  const openedAtById = new Map(recentProjects.map(entry => [entry.id, entry.openedAt]))
  const healthLabel = health === 'online' ? t('topbar.connected') : health === 'offline' ? t('topbar.offline') : t('topbar.connecting')
  const refreshLabel = refreshing ? t('topbar.refreshingProject') : t('home.refresh')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

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
        <div className="home-sidebar-section-label">{t('homeSidebar.recent')}</div>
        {recentEntries.length ? (
          <div className="home-sidebar-quick-list">
            {recentEntries.map(project => (
              <button
                key={project.id}
                type="button"
                className="home-sidebar-project"
                title={project.title}
                onClick={() => onOpenProject(project.id)}
              >
                <span className="home-sidebar-project-icon" aria-hidden="true">
                  <FolderKanban size={16} strokeWidth={1.9} />
                </span>
                <span className="home-sidebar-project-main">
                  <span className="home-sidebar-project-title">{project.title}</span>
                  {openedAtById.has(project.id) ? (
                    <span className="home-sidebar-project-meta">
                      <History size={11} className="home-sidebar-project-clock" aria-hidden="true" />
                      {formatOpenedAt(openedAtById.get(project.id) ?? 0, locale, t, now)}
                    </span>
                  ) : null}
                </span>
                {project.pinned ? <Pin size={11} className="home-sidebar-project-pin" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="home-sidebar-empty">{t('homeSidebar.noRecentProjects')}</div>
        )}
      </div>

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

      <button className="side-settings" type="button" onClick={onOpenSettings} title={t('sidebar.settings')}>
        <Settings size={17} />
        <span>{t('sidebar.settings')}</span>
      </button>
    </aside>
  )
}
