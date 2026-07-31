import { ChevronDown } from 'lucide-react'
import type { ThinkingSession } from '../types'

export function ThinkingSessions({
  sessions,
  onToggle,
}: {
  sessions: ThinkingSession[]
  onToggle: (id: string) => void
}) {
  if (!sessions.length) return null
  return (
    <div className="ai-thinking">
      <div className="pane-heading" style={{ marginTop: 24 }}>
        <h2>AI 请求状态</h2>
      </div>
      <div className="thinking-sessions">
        {sessions.map(session => (
          <div key={session.id} className={`thinking-session ${session.collapsed ? 'collapsed' : ''}`}>
            <button
              className="thinking-session-header"
              type="button"
              onClick={() => onToggle(session.id)}
              aria-expanded={!session.collapsed}
            >
              <ChevronDown className="toggle-icon" size={16} />
              <span className="session-model">{session.modelLabel}</span>
              <span className={`session-status ${session.status}`}>
                {session.status === 'running' ? '处理中' : session.status === 'done' ? '已完成' : '失败'}
              </span>
              <span className="session-time">{session.time}</span>
            </button>
            <div className="thinking-session-body">
              <div className="thinking-stages">
                {session.stages.map(stage => (
                  <div key={stage.key} className={`thinking-stage ${stage.state}`}>
                    <span className="stage-icon" />
                    <div>
                      <span className="stage-label">{stage.label}</span>
                      <span className="stage-detail">{stage.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
