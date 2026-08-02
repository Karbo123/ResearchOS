import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import type { ChatMessage } from '../types'
import { useTranslation } from '../i18n'

function ProjectProgress() {
  const { t } = useTranslation()
  const [elapsed, setElapsed] = useState(0)
  const [stageIndex, setStageIndex] = useState(0)
  const stages = [t('idea.stage.identifyIntent'), t('idea.stage.checkBoundaries'), t('idea.stage.organizeReply'), t('idea.stage.stillWorking')]

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
        <strong>{t('idea.progressTitle')}</strong>
        <span>{elapsed} {t('common.seconds')}</span>
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
  const { t } = useTranslation()
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
        <h2>{t('chat.title')}</h2>
        <div className="chat-heading-actions">
          <span className="badge live">{t('chat.monitoring')}</span>
          <button className="icon-btn mobile-chat-close" type="button" onClick={onClose} title={t('chat.closeTitle')} aria-label={t('chat.closeTitle')}>
            <X size={17} />
          </button>
        </div>
      </div>
      <div className="messages compact">
        {messages.map(message => {
          if (message.role === 'error') {
            return (
              <div className="request-error" role="alert" key={message.id}>
                <strong>{t('idea.errorTitle')}</strong>
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
          placeholder={t('chat.placeholder')}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button className="send-btn" type="submit" title={t('common.send')} aria-label={t('common.send')} disabled={busy || !input.trim()}>
          <Send size={17} />
        </button>
      </form>
    </aside>
  )
}
