import { useEffect, useState } from 'react'
import {
  History,
  Pin,
  RefreshCw,
  Settings,
} from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation, type Locale, type TranslationKey } from '../i18n'

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380
const MAX_RECENT_PROJECTS = 12
const RECENT_ROW_HEIGHT = 54
const RECENT_ROW_GAP = 8
const RECENT_LIST_OVERHEAD = 204

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export type RecentProjectEntry = { id: string; lastSeenAt: number }

function formatLastSeenAt(
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

function getRecentProjects(projects: ProjectSummary[], recentEntries: RecentProjectEntry[], limit: number) {
  const recentRank = new Map(recentEntries.map((entry, index) => [entry.id, index]))
  const pinned = projects.filter(project => project.pinned)
  const recent = projects
    .filter(project => !project.pinned && recentRank.has(project.id))
    .sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0))
  const fillers = projects.filter(project => !project.pinned && !recentRank.has(project.id))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return [...pinned, ...recent, ...fillers].slice(0, limit)
}

function fitRecentProjectCount(viewportHeight: number) {
  const available = Math.max(0, viewportHeight - RECENT_LIST_OVERHEAD)
  return Math.max(1, Math.min(MAX_RECENT_PROJECTS, Math.floor((available + RECENT_ROW_GAP) / (RECENT_ROW_HEIGHT + RECENT_ROW_GAP))))
}

export type HomeSidebarProps = {
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
}: HomeSidebarProps) {
  const { t, locale } = useTranslation()
  const [resizing, setResizing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [visibleRecentCount, setVisibleRecentCount] = useState(() => fitRecentProjectCount(window.innerHeight))
  const recentEntries = getRecentProjects(projects, recentProjects, visibleRecentCount)
  const lastSeenAtById = new Map(recentProjects.map(entry => [entry.id, entry.lastSeenAt]))
  const healthLabel = health === 'online' ? t('topbar.connected') : health === 'offline' ? t('topbar.offline') : t('topbar.connecting')
  const refreshLabel = refreshing ? t('home.refreshingTooltip') : t('home.refreshTooltip')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const updateFitCount = () => setVisibleRecentCount(fitRecentProjectCount(window.innerHeight))
    updateFitCount()
    window.addEventListener('resize', updateFitCount)
    return () => window.removeEventListener('resize', updateFitCount)
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
                <span className="home-sidebar-project-main">
                  <span className="home-sidebar-project-title">{project.title}</span>
                  {lastSeenAtById.has(project.id) ? (
                    <span className="home-sidebar-project-meta">
                      <History size={11} className="home-sidebar-project-clock" aria-hidden="true" />
                      {formatLastSeenAt(lastSeenAtById.get(project.id) ?? 0, locale, t, now)}
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
