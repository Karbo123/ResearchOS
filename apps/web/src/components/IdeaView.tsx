import { useEffect, useRef, useState } from 'react'
import { Paperclip, Send } from 'lucide-react'
import type { ChatMessage, ResearchSpec, ThinkingSession } from '../types'
import { SpecPane } from './SpecPane'
import { ThinkingSessions } from './ThinkingSessions'
import { useTranslation } from '../i18n'

const IDEA_PROGRESS_STAGE_KEYS = [
  'idea.stage.understand',
  'idea.stage.selectModel',
  'idea.stage.updateDraft',
  'idea.stage.checkRisks',
  'idea.stage.stillWorking',
]

function MessageItem({ message }: { message: ChatMessage }) {
  const { t } = useTranslation()
  if (message.role === 'error') {
    return (
      <div className="request-error" role="alert">
        <strong>{t('idea.errorTitle')}</strong>
        <span>{message.text}</span>
      </div>
    )
  }
  return (
    <div className={`message ${message.role}`}>
      <div className="avatar">{message.role === 'user' ? 'YOU' : 'AI'}</div>
      <div className="message-content">
        <div className="bubble">{message.text}</div>
        {message.meta ? <div className="message-meta">{message.meta}</div> : null}
      </div>
    </div>
  )
}

function AiProgress({ project = false }: { project?: boolean }) {
  const { t } = useTranslation()
  const [elapsed, setElapsed] = useState(0)
  const stageKeys = project
    ? ['idea.stage.identifyIntent', 'idea.stage.checkBoundaries', 'idea.stage.organizeReply', 'idea.stage.stillWorking']
    : IDEA_PROGRESS_STAGE_KEYS
  const stages = stageKeys.map(key => t(key as Parameters<typeof t>[0]))
  const [stageIndex, setStageIndex] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000)
      setElapsed(seconds)
      setStageIndex(Math.min(Math.floor(seconds / 4), stages.length - 1))
    }, 500)
    return () => window.clearInterval(timer)
  }, [stages.length])

  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <div className="ai-progress-head">
        <span className="thinking-dot" />
        <strong>{t('idea.progressTitle')}</strong>
        <span>{elapsed} {t('common.seconds')}</span>
      </div>
      <div className="ai-progress-track">
        <span />
      </div>
      <div className="ai-progress-stage">{stages[stageIndex]}</div>
    </div>
  )
}

export function IdeaView({
  messages,
  onSendChat,
  chatBusy,
  clarificationMode,
  onClarificationModeChange,
  queuedFiles,
  onFilesChange,
  spec,
  specStatus,
  onConfirmProject,
  thinkingSessions,
  onToggleThinking,
}: {
  messages: ChatMessage[]
  onSendChat: (message: string) => Promise<void>
  chatBusy: boolean
  clarificationMode: 'automatic' | 'detailed'
  onClarificationModeChange: (mode: 'automatic' | 'detailed') => void
  queuedFiles: File[]
  onFilesChange: (files: File[]) => void
  spec: ResearchSpec | null
  specStatus: string
  onConfirmProject: () => void
  thinkingSessions: ThinkingSession[]
  onToggleThinking: (id: string) => void
}) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, chatBusy])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const message = input.trim()
    if (!message || chatBusy) return
    setInput('')
    void onSendChat(message)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const automatic = clarificationMode === 'automatic'

  return (
    <section className="new-view">
      <div className="chat-pane">
        <div className="messages">
          {messages.map(message => <MessageItem key={message.id} message={message} />)}
          <div ref={messagesEndRef} />
        </div>
        {chatBusy ? <AiProgress /> : null}
        <div className="clarification-mode-bar">
          <label className="mode-switch" htmlFor="clarificationMode" title={t('idea.toggleDepthTitle')}>
            <input
              id="clarificationMode"
              type="checkbox"
              role="switch"
              aria-describedby="clarificationModeHint"
              checked={automatic}
              disabled={chatBusy}
              onChange={event => onClarificationModeChange(event.target.checked ? 'automatic' : 'detailed')}
            />
            <span className="switch-track" aria-hidden="true"><span /></span>
            <span className="mode-copy">
              <strong>{automatic ? t('app.mode.automatic') : t('app.mode.detailed')}</strong>
              <small id="clarificationModeHint">{automatic ? t('idea.modeHint.automatic') : t('idea.modeHint.detailed')}</small>
            </span>
          </label>
        </div>
        <form className="composer" onSubmit={handleSubmit} aria-busy={chatBusy}>
          <label className="attach-btn" title={t('idea.attachTitle')}>
            <Paperclip size={17} />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={chatBusy}
              onChange={event => {
                const files = event.currentTarget.files
                onFilesChange(files ? Array.from(files) : [])
                event.target.value = ''
              }}
            />
          </label>
          <textarea
            value={input}
            rows={2}
            placeholder={t('idea.placeholder')}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="send-btn" type="submit" title={t('common.send')} aria-label={t('common.send')} disabled={chatBusy || !input.trim()}>
            <Send size={17} />
          </button>
        </form>
        {queuedFiles.length ? (
          <div className="file-queue">{queuedFiles.map(file => file.name).join(' · ')}</div>
        ) : null}
      </div>
      <div className="spec-pane">
        <SpecPane spec={spec} status={specStatus} onConfirm={onConfirmProject} />
        <ThinkingSessions sessions={thinkingSessions} onToggle={onToggleThinking} />
      </div>
    </section>
  )
}
