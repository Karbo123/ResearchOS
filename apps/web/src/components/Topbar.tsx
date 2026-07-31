import { RefreshCw } from 'lucide-react'

export function Topbar({
  title,
  meta,
  health,
  onRefresh,
}: {
  title: string
  meta: string
  health: 'connecting' | 'online' | 'offline'
  onRefresh: () => void
}) {
  const healthLabel = health === 'online' ? '已连接' : health === 'offline' ? '离线' : '连接中'
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <div className="muted">{meta}</div>
      </div>
      <div className="top-actions">
        <span className={`health ${health === 'online' ? 'ok' : ''}`}>
          <span />
          {healthLabel}
        </span>
        <button className="icon-btn" type="button" onClick={onRefresh} title="刷新" aria-label="刷新">
          <RefreshCw size={17} />
        </button>
      </div>
    </header>
  )
}
