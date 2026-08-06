import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PenLine, RefreshCw } from 'lucide-react'
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
  fullscreen = false,
  contextTitle,
  onRenameTitle,
}: {
  title: string
  meta: string
  health: 'connecting' | 'online' | 'offline'
  refreshing?: boolean
  onRefresh: () => void
  project?: ProjectDetail | null
  fullscreen?: boolean
  contextTitle?: ReactNode
  onRenameTitle?: (title: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const renameAreaRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const healthLabel = health === 'online' ? t('topbar.connected') : health === 'offline' ? t('topbar.offline') : t('topbar.connecting')
  const isRefreshing = Boolean(project && refreshing)
  const refreshLabel = project ? (isRefreshing ? t('topbar.refreshingProject') : t('topbar.refreshProject')) : t('home.refresh')

  useEffect(() => {
    if (!renaming) return
    setDraftTitle(title)
    requestAnimationFrame(() => renameInputRef.current?.focus())
  }, [renaming, title])

  useEffect(() => {
    if (!renaming) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (renameAreaRef.current && !renameAreaRef.current.contains(event.target as Node)) setRenaming(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [renaming])

  const submitRename = async () => {
    const nextTitle = draftTitle.trim()
    if (saving || !onRenameTitle) return
    if (!nextTitle || nextTitle === title) {
      if (!nextTitle) return
      setRenaming(false)
      return
    }
    setSaving(true)
    try {
      await onRenameTitle(nextTitle)
      setRenaming(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className={`topbar${project ? ' has-project-context' : ''}`}>
      <div className="topbar-main">
        <div className="topbar-title" ref={renameAreaRef}>
          <div className="topbar-title-line">
            <h1 title={fullscreen ? undefined : title}>{fullscreen ? contextTitle : title}</h1>
            {project && !fullscreen ? (
              <div className="topbar-rename-anchor">
                <button
                  className={`icon-btn topbar-rename-trigger${renaming ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setRenaming(current => !current)}
                  title={t('topbar.renameProject')}
                  aria-label={t('topbar.renameProject')}
                  aria-expanded={renaming}
                >
                  <PenLine size={14} strokeWidth={1.8} />
                </button>
                {renaming ? (
                  <form
                    className="topbar-rename-popover"
                    onSubmit={event => {
                      event.preventDefault()
                      void submitRename()
                    }}
                  >
                    <label className="topbar-rename-label" htmlFor="topbar-rename-input">{t('topbar.renameLabel')}</label>
                    <input
                      id="topbar-rename-input"
                      ref={renameInputRef}
                      className="topbar-rename-input"
                      value={draftTitle}
                      disabled={saving}
                      maxLength={240}
                      placeholder={t('topbar.renamePlaceholder')}
                      onChange={event => setDraftTitle(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') setRenaming(false)
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="topbar-rename-actions">
                      <button className="secondary" type="button" disabled={saving} onClick={() => setRenaming(false)}>{t('common.cancel')}</button>
                      <button className="primary" type="submit" disabled={saving || !draftTitle.trim()}>
                        {saving ? t('common.saving') : t('common.save')}
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="muted">{meta}</div>
        </div>
        {project ? (
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
        ) : null}
      </div>
      {project && !fullscreen ? <WorkspaceContextBar project={project} refreshing={refreshing} onRefresh={onRefresh} /> : null}
    </header>
  )
}
