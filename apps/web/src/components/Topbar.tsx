import { RefreshCw } from 'lucide-react'
import { useTranslation } from '../i18n'
import type { ProjectDetail } from '../types'
import { WorkspaceContextBar } from './WorkspaceContextBar'

export function Topbar({
  title,
  meta,
  health,
  refreshing = false,
  onRefresh,
  project,
}: {
  title: string
  meta: string
  health: 'connecting' | 'online' | 'offline'
  refreshing?: boolean
  onRefresh: () => void
  project?: ProjectDetail | null
}) {
  const { t } = useTranslation()
  const healthLabel = health === 'online' ? t('topbar.connected') : health === 'offline' ? t('topbar.offline') : t('topbar.connecting')
  const isRefreshing = Boolean(project && refreshing)
  const refreshLabel = project ? (isRefreshing ? t('topbar.refreshingProject') : t('topbar.refreshProject')) : t('home.refresh')

  return (
    <header className={`topbar${project ? ' has-project-context' : ''}`}>
      <div className="topbar-main">
        <div className="topbar-title">
          <h1 title={title}>{title}</h1>
          <div className="muted">{meta}</div>
        </div>
        <div className="top-actions">
          <span className={`health ${health === 'online' ? 'ok' : ''}`}>
            <span />
            {healthLabel}
          </span>
          <button
            className={`icon-btn refresh-btn${isRefreshing ? ' is-refreshing' : ''}`}
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      {project ? <WorkspaceContextBar project={project} /> : null}
    </header>
  )
}
