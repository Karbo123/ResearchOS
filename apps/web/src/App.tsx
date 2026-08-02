import { useEffect, useRef, useState } from 'react'
import { api, errorMessage, uploadFile } from './api'
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
import { AREA_DEFAULT_TAB, TAB_AREA, normalizeTab, resolveWorkspaceHash, workspaceHash } from './navigation'
import { ModelSettingsModal } from './components/ModelSettingsModal'
import { MemoryGraphModal } from './components/MemoryGraphModal'
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

  const chatBusyRef = useRef(false)
  const projectChatBusyRef = useRef(false)
  const sessionIdRef = useRef<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const writeWorkspaceHash = (id: string, area: ResearchArea, tab: TabId) => {
    const next = workspaceHash(id, area, tab)
    if (window.location.hash !== next) window.history.pushState(null, '', next)
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

  const openProject = async (id: string, options?: { preserveTab?: boolean }) => {
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${id}`)
      if (projectId !== id) {
        setSearchCandidates([])
        setProjectMessages([])
        setMobileChatOpen(false)
      }
      setProjectId(id)
      setProject(detail)
      setActiveSession(detail.session_id || sessionIdRef.current)
      setView('project')
      if (!options?.preserveTab) {
        setActiveArea('overview')
        setActiveTab('overview')
        writeWorkspaceHash(id, 'overview', 'overview')
      }
      await loadProjects()
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const refreshProject = async () => {
    if (projectId) await openProject(projectId, { preserveTab: true })
    else await loadProjects()
  }

  const newProject = () => {
    setProjectId(null)
    setProject(null)
    setActiveSession(null)
    setView('idea')
    setActiveArea('overview')
    setSpec(null)
    setSpecStatus('pending_clarification')
    setMessages([initialMessage])
    setProjectMessages([])
    setQueuedFiles([])
    setThinkingSessions([])
    setClarificationMode('automatic')
    setMobileChatOpen(false)
    window.history.pushState(null, '', '#new')
    void loadProjects()
  }

  useEffect(() => {
    void loadProjects()
    api<{ status: string }>('/api/health')
      .then(() => setHealth('online'))
      .catch(() => setHealth('offline'))

    const restoreWorkspace = () => {
      const hash = resolveWorkspaceHash()
      if (!hash) return
      setActiveArea(hash.area)
      setActiveTab(hash.tab)
      const normalizedHash = workspaceHash(hash.projectId, hash.area, hash.tab)
      if (window.location.hash !== normalizedHash) window.history.replaceState(null, '', normalizedHash)
      if (projectId !== hash.projectId) void openProject(hash.projectId, { preserveTab: true })
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
        throw new Error(body?.message || `HTTP ${response.status}`)
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

      if (streamError) throw new Error(streamError.message || t('app.thinking.requestFailed'))
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
      const result = await api<{ project: { id: string } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionIdRef.current, confirmed: true }),
      })
      showToast(t('app.projectCreated'))
      await openProject(result.project.id)
    } catch (error) {
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
    if (projectId) writeWorkspaceHash(projectId, area, normalizedTab)
  }

  const navigateArea = (area: ResearchArea) => {
    const tab = AREA_DEFAULT_TAB[area]
    setActiveArea(area)
    setActiveTab(tab)
    if (projectId) writeWorkspaceHash(projectId, area, tab)
  }

  return (
    <div className="app-shell">
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
                id: String(projectId || '').slice(0, 8),
              })}
          health={health}
          onRefresh={() => void refreshProject()}
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
      {toast ? <Toast message={toast} /> : null}
    </div>
  )
}
