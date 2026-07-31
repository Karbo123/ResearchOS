import { useEffect, useRef, useState } from 'react'
import { Paperclip, Send } from 'lucide-react'
import type { ChatMessage, ResearchSpec, ThinkingSession } from '../types'
import { SpecPane } from './SpecPane'
import { ThinkingSessions } from './ThinkingSessions'

const IDEA_PROGRESS_STAGES = [
  '正在理解研究目标与已有线索…',
  '正在选择成本合适的模型层级…',
  '正在更新 ResearchIdea 草稿…',
  '正在检查风险、假设与待确认事项…',
  '模型仍在处理，请稍候…',
]

function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === 'error') {
    return (
      <div className="request-error" role="alert">
        <strong>请求失败</strong>
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
  const [elapsed, setElapsed] = useState(0)
  const stages = project
    ? ['正在识别解释、建议或变更意图…', '正在检查项目状态与审批边界…', '正在组织可审阅的回复…', '模型仍在处理，请稍候…']
    : IDEA_PROGRESS_STAGES
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
        <strong>AI 正在分析</strong>
        <span>{elapsed} 秒</span>
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
          <label className="mode-switch" htmlFor="clarificationMode" title="切换 Idea 澄清深度">
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
              <strong>{automatic ? '全自动模式' : '详细模式'}</strong>
              <small id="clarificationModeHint">{automatic ? '少量关键追问' : '全面了解需求'}</small>
            </span>
          </label>
        </div>
        <form className="composer" onSubmit={handleSubmit} aria-busy={chatBusy}>
          <label className="attach-btn" title="添加材料">
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
            placeholder="输入研究 Idea 或回答澄清问题"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="send-btn" type="submit" title="发送" aria-label="发送" disabled={chatBusy || !input.trim()}>
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
