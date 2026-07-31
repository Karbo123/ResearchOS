import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import type { ChatMessage } from '../types'

function ProjectProgress() {
  const [elapsed, setElapsed] = useState(0)
  const [stageIndex, setStageIndex] = useState(0)
  const stages = [
    '正在识别解释、建议或变更意图…',
    '正在检查项目状态与审批边界…',
    '正在组织可审阅的回复…',
    '模型仍在处理，请稍候…',
  ]

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000)
      setElapsed(seconds)
      setStageIndex(Math.min(Math.floor(seconds / 4), stages.length - 1))
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="ai-progress compact" role="status" aria-live="polite">
      <div className="ai-progress-head">
        <span className="thinking-dot" />
        <strong>AI 正在分析</strong>
        <span>{elapsed} 秒</span>
      </div>
      <div className="ai-progress-track"><span /></div>
      <div className="ai-progress-stage">{stages[stageIndex]}</div>
    </div>
  )
}

export function ProjectChat({
  messages,
  busy,
  onSend,
  onClose,
  mobileOpen,
}: {
  messages: ChatMessage[]
  busy: boolean
  onSend: (message: string) => Promise<void>
  onClose: () => void
  mobileOpen: boolean
}) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    void onSend(message)
  }

  return (
    <aside className={`project-chat ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="pane-heading">
        <h2>项目对话</h2>
        <div className="chat-heading-actions">
          <span className="badge live">监督中</span>
          <button className="icon-btn mobile-chat-close" type="button" onClick={onClose} title="关闭项目对话" aria-label="关闭项目对话">
            <X size={17} />
          </button>
        </div>
      </div>
      <div className="messages compact">
        {messages.map(message => {
          if (message.role === 'error') {
            return (
              <div className="request-error" role="alert" key={message.id}>
                <strong>请求失败</strong>
                <span>{message.text}</span>
              </div>
            )
          }
          return (
            <div className={`message ${message.role}`} key={message.id}>
              <div className="avatar">{message.role === 'user' ? 'YOU' : 'AI'}</div>
              <div className="message-content">
                <div className="bubble">{message.text}</div>
                {message.meta ? <div className="message-meta">{message.meta}</div> : null}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      {busy ? <ProjectProgress /> : null}
      <form className="composer compact" onSubmit={submit} aria-busy={busy}>
        <textarea
          value={input}
          rows={2}
          placeholder="解释、建议或明确提出变更"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button className="send-btn" type="submit" title="发送" aria-label="发送" disabled={busy || !input.trim()}>
          <Send size={17} />
        </button>
      </form>
    </aside>
  )
}
