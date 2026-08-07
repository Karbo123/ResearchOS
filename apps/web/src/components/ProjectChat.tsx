import { useEffect, useRef, useState } from 'react'
import { BookOpenText, ChevronDown, CircleUserRound, FileText, Loader2, Send, Sparkles, X } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ChatMessage, ContextManifest, ContextManifestSourceRef } from '../types'
import { useTranslation } from '../i18n'
import { VoiceInputButton } from './VoiceInputButton'
import { useComposerTextarea, useVoiceInsertion } from '../hooks/useComposerInput'

function shortHash(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

function sourceIdentity(source: ContextManifestSourceRef): string {
  return source.document_id || (source.entity_type && source.entity_id ? `${source.entity_type}:${source.entity_id}` : source.locator)
}

function ContextSources({ projectId, manifestId }: { projectId: string; manifestId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [manifest, setManifest] = useState<ContextManifest | null>(null)
  const [failure, setFailure] = useState('')

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || manifest || loading) return
    setLoading(true)
    setFailure('')
    try {
      setManifest(await api<ContextManifest>(`/api/projects/${encodeURIComponent(projectId)}/context-manifests/${encodeURIComponent(manifestId)}`))
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const documentCount = manifest
    ? new Set(manifest.source_refs.map(source => source.document_id).filter(Boolean)).size
    : 0

  return (
    <div className="context-sources" data-open={open ? 'true' : 'false'}>
      <button
        className="context-sources-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        {loading ? <Loader2 className="spin" size={13} /> : <BookOpenText size={13} />}
        <span>{t('chat.sources')}</span>
        <ChevronDown className="context-sources-chevron" size={13} />
      </button>
      {open ? (
        <div className="context-sources-panel">
          {failure ? <div className="context-sources-error" role="alert">{failure}</div> : null}
          {loading ? <div className="context-sources-loading" role="status">{t('chat.sourcesLoading')}</div> : null}
          {manifest ? (
            <>
              <div className="context-sources-summary">
                <span>{t('chat.sourcesSummary', { documents: documentCount, sources: manifest.source_refs.length })}</span>
                <span>{t('chat.sourcesTokens', { used: manifest.included_tokens, budget: manifest.token_budget - manifest.output_reserve })}</span>
              </div>
              {manifest.source_refs.length ? (
                <ul className="context-source-list">
                  {manifest.source_refs.map((source, index) => (
                    <li key={`${sourceIdentity(source)}-${source.locator}-${index}`}>
                      <FileText size={14} aria-hidden="true" />
                      <div>
                        <strong>{sourceIdentity(source)}</strong>
                        <span>{source.locator}</span>
                        {source.document_sha256 ? (
                          <code title={source.document_sha256}>{t('chat.sourceVersion', { hash: shortHash(source.document_sha256) })}</code>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <div className="context-sources-empty">{t('chat.sourcesEmpty')}</div>}
              {manifest.excluded.length ? (
                <details className="context-sources-excluded">
                  <summary>{t('chat.sourcesExcluded', { count: manifest.excluded.length })}</summary>
                  <ul>{manifest.excluded.map((item, index) => <li key={`${item.kind}-${item.id || index}`}>{item.reason}</li>)}</ul>
                </details>
              ) : null}
              <div className="context-sources-note">{t('chat.sourcesEvidenceNote')}</div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

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
  contextLabel,
  busy,
  projectId,
  onSend,
  onClose,
  mobileOpen,
}: {
  messages: ChatMessage[]
  contextLabel: string
  busy: boolean
  projectId?: string
  onSend: (message: string) => Promise<void>
  onClose: () => void
  mobileOpen: boolean
}) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const textareaRef = useComposerTextarea(input)
  const voiceInsertion = useVoiceInsertion(textareaRef, setInput)
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
        <h2>{t('chat.titleWithContext', { tab: contextLabel })}</h2>
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
              <div className="avatar" aria-hidden="true">{message.role === 'user' ? <CircleUserRound size={16} /> : <Sparkles size={16} />}</div>
              <div className="message-content">
                <div className="bubble">{message.text}</div>
                {message.meta ? <div className="message-meta">{message.meta}</div> : null}
                {message.role === 'assistant' && message.context_manifest_id && projectId
                  ? <ContextSources projectId={projectId} manifestId={message.context_manifest_id} />
                  : null}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      {busy ? <ProjectProgress /> : null}
      <form className="composer compact" onSubmit={submit} aria-busy={busy}>
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          placeholder={t('chat.placeholder')}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onChange={event => voiceInsertion.setValue(event.target.value)}
          onFocus={voiceInsertion.trackSelection}
          onSelect={voiceInsertion.trackSelection}
          onClick={voiceInsertion.trackSelection}
          onKeyUp={voiceInsertion.trackSelection}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <VoiceInputButton
          disabled={busy}
          projectId={projectId}
          onText={voiceInsertion.handleText}
          onSessionStart={voiceInsertion.reset}
          onSessionEnd={voiceInsertion.reset}
        />
        <button className="send-btn" type="submit" title={t('common.send')} aria-label={t('common.send')} disabled={busy || !input.trim()}>
          <Send size={17} />
        </button>
      </form>
      {input.length === 0 ? (
        <div className="composer-hint" aria-live="polite">
          {t('common.sendShortcutHint')} · {t('voice.shortcutHint')}
        </div>
      ) : null}
    </aside>
  )
}
