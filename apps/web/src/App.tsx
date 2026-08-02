import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ApiError, api, errorMessage, uploadFile } from './api'
import type {
  ChatMessage,
  ConfirmRequest,
  ProjectDetail,
  ProjectSummary,
  ResearchArea,
  ResearchSpec,
  SearchCandidate,
  TabId,
  ThinkingSession,
  ThinkingStage,
} from './types'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { IdeaView } from './components/IdeaView'
import { ProjectView } from './components/ProjectView'
import { AREA_DEFAULT_TAB, TAB_AREA, normalizeTab, resolveWorkspaceLocation, workspacePath } from './navigation'
import { ModelSettingsModal } from './components/ModelSettingsModal'
import { MemoryGraphModal } from './components/MemoryGraphModal'
import { NotFoundView } from './components/NotFoundView'
import { DeleteProjectDialog } from './components/DeleteProjectDialog'
import { ConfirmDialog, Toast } from './components/ui'
import { useTranslation } from './i18n'

const EMPTY_STAGES: Array<{ key: ThinkingStage['key']; labelKey: 'app.thinking.readingConversation' | 'app.thinking.selectingModel' | 'app.thinking.callingModel' | 'app.thinking.savingResult' }> = [
  { key: 'analyzing_input', labelKey: 'app.thinking.readingConversation' },
  { key: 'selecting_route', labelKey: 'app.thinking.selectingModel' },
  { key: 'calling_llm', labelKey: 'app.thinking.callingModel' },
  { key: 'parsing', labelKey: 'app.thinking.savingResult' },
]

function nextMessageId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function App() {
  const { t, locale } = useTranslation()
  const initialMessage: ChatMessage = {
    id: 'initial-assistant',
    role: 'assistant',
    text: t('app.initialMessage'),
  }
  useEffect(() => {
    setMessages(current => current.map(message => (
      message.id === 'initial-assistant' ? { ...message, text: t('app.initialMessage') } : message
    )))
  }, [locale])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [view, setView] = useState<'idea' | 'project'>('idea')
  const [activeArea, setActiveArea] = useState<ResearchArea>('overview')
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [health, setHealth] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [toast, setToast] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage])
  const [projectMessages, setProjectMessages] = useState<ChatMessage[]>([])
  const [spec, setSpec] = useState<ResearchSpec | null>(null)
  const [projectSlug, setProjectSlug] = useState('')
  const [specStatus, setSpecStatus] = useState('pending_clarification')
  const [chatBusy, setChatBusy] = useState(false)
  const [projectChatBusy, setProjectChatBusy] = useState(false)
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [clarificationMode, setClarificationMode] = useState<'automatic' | 'detailed'>('automatic')
  const [thinkingSessions, setThinkingSessions] = useState<ThinkingSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [searchCandidates, setSearchCandidates] = useState<SearchCandidate[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null)
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('researchos.sidebarWidth'))
    return Number.isFinite(stored) ? Math.min(380, Math.max(220, stored)) : 276
  })

  const chatBusyRef = useRef(false)
  const projectChatBusyRef = useRef(false)
  const sessionIdRef = useRef<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    window.localStorage.setItem('researchos.sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  const updateSidebarWidth = (width: number) => setSidebarWidth(Math.min(380, Math.max(220, Math.round(width))))

  const writeWorkspacePath = (slug: string, area: ResearchArea, tab: TabId, replace = false) => {
    const next = workspacePath(slug, area, tab)
    if (window.location.pathname !== next || window.location.hash) {
      if (replace) window.history.replaceState(null, '', next)
      else window.history.pushState(null, '', next)
    }
  }

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200)
  }

  const loadProjects = async () => {
    try {
      const list = await api<ProjectSummary[]>('/api/projects')
      setProjects(list)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const setActiveSession = (id: string | null) => {
    sessionIdRef.current = id
    setSessionId(id)
  }

  const openProject = async (reference: string, options?: { preserveTab?: boolean; route?: { area: ResearchArea; tab: TabId } }) => {
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(reference)}`)
      if (projectId !== detail.id) {
        setSearchCandidates([])
        setProjectMessages([])
        setMobileChatOpen(false)
      }
      setProjectId(detail.id)
      setProject(detail)
      setActiveSession(detail.session_id || sessionIdRef.current)
      setView('project')
      if (!options?.preserveTab) {
        setActiveArea('overview')
        setActiveTab('overview')
        writeWorkspacePath(detail.slug || detail.id, 'overview', 'overview')
      } else if (options.route) {
        writeWorkspacePath(detail.slug || detail.id, options.route.area, options.route.tab, true)
      }
      await loadProjects()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setNotFoundPath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
        return
      }
      showToast(errorMessage(error))
    }
  }

  const refreshProject = async () => {
    if (projectId) await openProject(projectId, { preserveTab: true })
    else await loadProjects()
  }

  const newProject = (options?: { replace?: boolean }) => {
    setProjectId(null)
    setProject(null)
    setActiveSession(null)
    setView('idea')
    setActiveArea('overview')
    setSpec(null)
    setProjectSlug('')
    setSpecStatus('pending_clarification')
    setMessages([initialMessage])
    setProjectMessages([])
    setQueuedFiles([])
    setThinkingSessions([])
    setClarificationMode('automatic')
    setMobileChatOpen(false)
    setNotFoundPath(null)
    if (options?.replace) window.history.replaceState(null, '', '/new')
    else window.history.pushState(null, '', '/new')
    void loadProjects()
  }

  useEffect(() => {
    void loadProjects()
    api<{ status: string }>('/api/health')
      .then(() => setHealth('online'))
      .catch(() => setHealth('offline'))

    const restoreWorkspace = () => {
      const location = resolveWorkspaceLocation(window.location.pathname, window.location.hash)
      if (!location) {
        const isHome = (window.location.pathname === '/' || window.location.pathname === '/new' || window.location.pathname === '/new/') && !window.location.hash
        if (isHome) {
          setNotFoundPath(null)
          return
        }
        setNotFoundPath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
        return
      }
      setNotFoundPath(null)
      setActiveArea(location.area)
      setActiveTab(location.tab)
      void openProject(location.projectRef, { preserveTab: true, route: { area: location.area, tab: location.tab } })
    }
    restoreWorkspace()
    window.addEventListener('popstate', restoreWorkspace)
    window.addEventListener('hashchange', restoreWorkspace)
    return () => {
      window.removeEventListener('popstate', restoreWorkspace)
      window.removeEventListener('hashchange', restoreWorkspace)
    }
  }, [])

  const setThinkingStage = (session: ThinkingSession, key: ThinkingStage['key'], state: ThinkingStage['state'], label?: string, detail?: string) => {
    return {
      ...session,
      stages: session.stages.map(stage => {
        if (stage.key !== key) return stage
        if (state === 'active' && stage.state === 'done') return stage
        return {
          ...stage,
          state,
          label: label ?? stage.label,
          detail: detail ?? stage.detail,
        }
      }),
    }
  }

  const startThinkingSession = (): string => {
    const id = `ts-${Date.now()}`
    const time = new Date().toLocaleTimeString(locale === 'zh-CN' || locale === 'zh-TW' ? 'zh-CN' : locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setThinkingSessions(previous => [
      ...previous.map(item => ({ ...item, collapsed: true })),
      {
        id,
        time,
        modelLabel: t('app.thinking.modelRouting'),
        status: 'running',
        collapsed: false,
        stages: EMPTY_STAGES.map(stage => ({ key: stage.key, label: t(stage.labelKey), detail: t('common.waiting'), state: 'pending' as const })),
      },
    ])
    return id
  }

  const applyThinkingEvent = (sessionIdToUpdate: string, event: string, data: Record<string, any>) => {
    setThinkingSessions(previous => previous.map(session => {
      if (session.id !== sessionIdToUpdate) return session
      let next = session
      const patchStage = (key: ThinkingStage['key'], state: ThinkingStage['state'], label?: string, detail?: string) => {
        next = setThinkingStage(next, key, state, label, detail)
      }
      if (event === 'stage') {
        if (data.stage === 'model_request') {
          patchStage('analyzing_input', 'done')
          patchStage('calling_llm', 'active', t('app.thinking.callingModel'), t('app.thinking.waitingResponse'))
        } else {
          patchStage('parsing', 'active', t('app.thinking.savingResult'), data.detail || data.stage || '')
        }
      } else if (event === 'model_route') {
        next = {
          ...next,
          modelLabel: `${data.tier} · ${data.model} · reasoning ${data.reasoning_effort}`,
        }
        patchStage('analyzing_input', 'done')
        patchStage('selecting_route', 'done', t('app.thinking.selectingModel'), `${data.tier} → ${data.model}`)
        patchStage('calling_llm', 'active', t('app.thinking.callingModel'), t('app.thinking.waitingResponse'))
      } else if (event === 'progress') {
        const map: Record<string, { key: ThinkingStage['key']; labelKey: 'app.thinking.preparingRequest' | 'app.thinking.callingModel' | 'app.thinking.savingResult' }> = {
          preparing_request: { key: 'analyzing_input', labelKey: 'app.thinking.preparingRequest' },
          calling_model: { key: 'calling_llm', labelKey: 'app.thinking.callingModel' },
          saving_result: { key: 'parsing', labelKey: 'app.thinking.savingResult' },
        }
        const target = map[data.stage] || { key: 'parsing' as const, labelKey: 'app.thinking.savingResult' as const }
        patchStage(target.key, 'active', t(target.labelKey), data.detail || '')
      } else if (event === 'result') {
        patchStage('calling_llm', 'done')
        patchStage('parsing', 'done', t('app.thinking.saveComplete'), t('app.thinking.assumptionsRecorded', { count: (data.assumptions || []).length }))
        next = { ...next, status: 'done' }
      } else if (event === 'error') {
        patchStage('calling_llm', 'done', t('app.thinking.requestFailed'), data.message || '')
        next = { ...next, status: 'failed' }
      }
      return next
    }))
  }

  const toggleThinkingSession = (id: string) => {
    setThinkingSessions(previous => previous.map(session => session.id === id ? { ...session, collapsed: !session.collapsed } : session))
  }

  const addMessage = (list: ChatMessage[], role: ChatMessage['role'], text: string, meta = '') => [
    ...list,
    { id: nextMessageId(), role, text, meta: meta || undefined },
  ]

  const sendChat = async (message: string) => {
    if (chatBusyRef.current) return
    chatBusyRef.current = true
    setChatBusy(true)
    setMessages(previous => addMessage(previous, 'user', message))
    const thinkingId = startThinkingSession()
    applyThinkingEvent(thinkingId, 'stage', { stage: 'preparing_request', detail: t('app.thinking.messageLength', { count: message.length }) })

    try {
      let currentSessionId = sessionIdRef.current
      if (queuedFiles.length) {
        if (!currentSessionId) {
          currentSessionId = crypto.randomUUID()
          setActiveSession(currentSessionId)
        }
        applyThinkingEvent(thinkingId, 'stage', { stage: 'uploading', detail: t('app.thinking.uploadingFiles', { count: queuedFiles.length }) })
        for (const file of queuedFiles) await uploadFile(currentSessionId, file)
        setQueuedFiles([])
      }

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: currentSessionId,
          message,
          attachments: [],
          clarification_mode: clarificationMode,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new ApiError(typeof body?.code === 'string' ? body.code : 'chat_request_failed', body?.message || `HTTP ${response.status}`)
      }
      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let result: Record<string, any> | null = null
      let streamError: Record<string, any> | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        let currentEvent = ''
        let currentData = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7)
            currentData = ''
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6)
          } else if (line === '' && currentEvent) {
            try {
              const parsed = JSON.parse(currentData)
              applyThinkingEvent(thinkingId, currentEvent, parsed)
              if (currentEvent === 'result') result = parsed
              if (currentEvent === 'error') streamError = parsed
            } catch {
              // Ignore malformed individual SSE frames; the next frame still flows.
            }
            currentEvent = ''
            currentData = ''
          }
        }
      }

      if (streamError) throw new ApiError(typeof streamError.code === 'string' ? streamError.code : 'chat_stream_failed', streamError.message || t('app.thinking.requestFailed'))
      if (result) {
        setActiveSession(result.session_id || currentSessionId)
        const routeMeta = result.model
          ? `${result.model_tier || 'adaptive'} · ${result.model} · reasoning ${result.reasoning_effort || 'default'}`
          : ''
        setMessages(previous => addMessage(
          previous,
          'assistant',
          result.reply || '',
          `${clarificationMode === 'automatic' ? t('app.mode.automatic') : t('app.mode.detailed')}${routeMeta ? ` · ${routeMeta}` : ''}`,
        ))
        if (result.spec) {
          setSpec(result.spec)
          setSpecStatus('pending_confirmation')
        }
      }
    } catch (error) {
      const message = errorMessage(error)
      setMessages(previous => addMessage(previous, 'error', message))
      showToast(message)
    } finally {
      chatBusyRef.current = false
      setChatBusy(false)
    }
  }

  const confirmProject = async () => {
    if (!sessionIdRef.current) return
    try {
      const result = await api<{ project: { id: string; slug: string } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionIdRef.current, confirmed: true, slug: projectSlug.trim() || null }),
      })
      showToast(t('app.projectCreated'))
      await openProject(result.project.id)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const deleteProject = async (confirmation: string) => {
    const target = deleteProjectTarget
    if (!target || deleteBusy) return
    setDeleteBusy(true)
    try {
      // Pinning reorders the sidebar and can leave an open dialog holding an old
      // list snapshot. Read the current project title before the strict delete
      // request so the confirmation always matches the server's current row.
      const current = await api<Pick<ProjectDetail, 'id' | 'title'>>(`/api/projects/${encodeURIComponent(target.id)}`)
      await api(`/api/projects/${target.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ project_title: current.title, confirmation }),
      })
      setDeleteProjectTarget(null)
      setProjects(previous => previous.filter(project => project.id !== target.id))
      if (target.id === projectId) newProject({ replace: true })
      else await loadProjects()
      showToast(t('app.projectDeleted'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const pinProject = async (target: ProjectSummary) => {
    try {
      await api<ProjectSummary>(`/api/projects/${target.id}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !target.pinned }),
      })
      await loadProjects()
      showToast(t(target.pinned ? 'app.projectUnpinned' : 'app.projectPinned'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const requestDeleteProject = (target: ProjectSummary) => {
    const current = projects.find(project => project.id === target.id)
    setDeleteProjectTarget(current || target)
  }

  const reorderProjects = async (projectIds: string[]) => {
    try {
      await api('/api/projects/order', {
        method: 'PATCH',
        body: JSON.stringify({ project_ids: projectIds }),
      })
      await loadProjects()
      showToast(t('app.projectOrderUpdated'))
    } catch (error) {
      await loadProjects()
      showToast(errorMessage(error))
    }
  }

  const sendProjectChat = async (message: string) => {
    if (projectChatBusyRef.current || !project) return
    projectChatBusyRef.current = true
    setProjectChatBusy(true)
    setProjectMessages(previous => addMessage(previous, 'user', message))
    try {
      const result = await api<Record<string, any>>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionIdRef.current, project_id: project.id, message }),
      })
      const routeMeta = result.model
        ? `${result.model_tier || 'adaptive'} · ${result.model} · reasoning ${result.reasoning_effort || 'default'}`
        : ''
      setProjectMessages(previous => addMessage(previous, 'assistant', result.reply || '', routeMeta))
      if (result.action_required) {
        await refreshProject()
        setActiveTab('approvals')
      }
    } catch (error) {
      const message = errorMessage(error)
      setProjectMessages(previous => addMessage(previous, 'error', message))
      showToast(message)
    } finally {
      projectChatBusyRef.current = false
      setProjectChatBusy(false)
    }
  }

  const requestConfirm = (request: ConfirmRequest) => setConfirm(request)

  const navigateTab = (tab: TabId) => {
    const normalizedTab = normalizeTab(tab)
    setActiveTab(normalizedTab)
    const area = TAB_AREA[normalizedTab]
    setActiveArea(area)
    const slug = project?.slug || projectId
    if (slug) writeWorkspacePath(slug, area, normalizedTab)
  }

  const navigateArea = (area: ResearchArea) => {
    const tab = AREA_DEFAULT_TAB[area]
    setActiveArea(area)
    setActiveTab(tab)
    const slug = project?.slug || projectId
    if (slug) writeWorkspacePath(slug, area, tab)
  }

  if (notFoundPath) {
    return <NotFoundView key={notFoundPath} path={notFoundPath} onGoHome={() => newProject({ replace: true })} />
  }

  return (
    <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        projects={projects}
        activeProjectId={projectId}
        onNewProject={newProject}
        onOpenProject={id => void openProject(id)}
        onOpenMemory={() => {
          if (!projectId) showToast(t('app.openProjectFirst'))
          else setMemoryOpen(true)
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onDeleteProject={requestDeleteProject}
        onPinProject={project => void pinProject(project)}
        onReorderProjects={reorderProjects}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={updateSidebarWidth}
      />
      <main className="workspace">
        <Topbar
          title={view === 'idea' ? t('app.newProject') : project?.title || t('app.researchProject')}
          meta={view === 'idea'
            ? t('app.ideaMeta')
            : t('app.projectMeta', {
                stage: project?.current_stage === 'initialized'
                  ? t('overview.stageInitialized')
                  : project?.current_stage || t('overview.stageUnknown'),
                version: project?.current_idea_version ?? 1,
                id: project?.slug || String(projectId || '').slice(0, 8),
              })}
          health={health}
          onRefresh={() => void refreshProject()}
          project={view === 'project' ? project : null}
        />
        {view === 'idea' ? (
          <IdeaView
            messages={messages}
            onSendChat={sendChat}
            chatBusy={chatBusy}
            clarificationMode={clarificationMode}
            onClarificationModeChange={setClarificationMode}
            queuedFiles={queuedFiles}
            onFilesChange={setQueuedFiles}
            spec={spec}
            specStatus={specStatus}
            projectSlug={projectSlug}
            onProjectSlugChange={setProjectSlug}
            onConfirmProject={() => void confirmProject()}
            thinkingSessions={thinkingSessions}
            onToggleThinking={toggleThinkingSession}
          />
        ) : project ? (
          <ProjectView
            project={project}
            activeArea={activeArea}
            activeTab={activeTab}
            onAreaChange={navigateArea}
            onTabChange={navigateTab}
            onRefresh={refreshProject}
            showToast={showToast}
            onRequestConfirm={requestConfirm}
            searchCandidates={searchCandidates}
            chatMessages={projectMessages}
            chatBusy={projectChatBusy}
            onSendProjectChat={sendProjectChat}
            mobileChatOpen={mobileChatOpen}
            onToggleMobileChat={setMobileChatOpen}
          />
        ) : (
          <div className="loading-view"><div className="empty">{t('common.loadingProject')}</div></div>
        )}
      </main>
      <ModelSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} projectId={projectId} />
      <MemoryGraphModal
        open={memoryOpen}
        projectId={projectId}
        onClose={() => setMemoryOpen(false)}
        showToast={showToast}
      />
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => {
            const action = confirm.onConfirm
            setConfirm(null)
            void action()
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {deleteProjectTarget ? (
        <DeleteProjectDialog
          key={deleteProjectTarget.id}
          project={deleteProjectTarget}
          busy={deleteBusy}
          onClose={() => setDeleteProjectTarget(null)}
          onConfirm={confirmation => void deleteProject(confirmation)}
        />
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </div>
  )
}
