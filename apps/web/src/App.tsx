import { useEffect, useRef, useState } from 'react'
import { api, errorMessage, uploadFile } from './api'
import type {
  ChatMessage,
  ConfirmRequest,
  ProjectDetail,
  ProjectSummary,
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
import { ModelSettingsModal } from './components/ModelSettingsModal'
import { MemoryGraphModal } from './components/MemoryGraphModal'
import { ConfirmDialog, Toast } from './components/ui'

const INITIAL_MESSAGE: ChatMessage = {
  id: 'initial-assistant',
  role: 'assistant',
  text: '请直接描述你的研究 Idea。我会自适应分析目标与已有线索，说明推断和风险，只追问真正影响方案的未知信息。',
}

const EMPTY_STAGES: ThinkingStage[] = [
  { key: 'analyzing_input', label: '读取对话', detail: '等待中…', state: 'pending' },
  { key: 'selecting_route', label: '选择模型', detail: '等待中…', state: 'pending' },
  { key: 'calling_llm', label: '调用模型', detail: '等待中…', state: 'pending' },
  { key: 'parsing', label: '保存结果', detail: '等待中…', state: 'pending' },
]

function nextMessageId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [view, setView] = useState<'idea' | 'project'>('idea')
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [health, setHealth] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [toast, setToast] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [projectMessages, setProjectMessages] = useState<ChatMessage[]>([])
  const [spec, setSpec] = useState<ResearchSpec | null>(null)
  const [specStatus, setSpecStatus] = useState('待澄清')
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
      if (projectId !== id) setSearchCandidates([])
      setProjectId(id)
      setProject(detail)
      setActiveSession(detail.session_id || sessionIdRef.current)
      setView('project')
      if (!options?.preserveTab) setActiveTab('overview')
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
    setSpec(null)
    setSpecStatus('待澄清')
    setMessages([INITIAL_MESSAGE])
    setQueuedFiles([])
    setThinkingSessions([])
    setClarificationMode('automatic')
    setMobileChatOpen(false)
    void loadProjects()
  }

  useEffect(() => {
    void loadProjects()
    api<{ status: string }>('/api/health')
      .then(() => setHealth('online'))
      .catch(() => setHealth('offline'))
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
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setThinkingSessions(previous => [
      ...previous.map(item => ({ ...item, collapsed: true })),
      {
        id,
        time,
        modelLabel: '模型路由',
        status: 'running',
        collapsed: false,
        stages: EMPTY_STAGES.map(stage => ({ ...stage })),
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
          patchStage('calling_llm', 'active', '调用模型', '等待模型响应…')
        } else {
          patchStage('parsing', 'active', '保存结果', data.detail || data.stage || '')
        }
      } else if (event === 'model_route') {
        next = {
          ...next,
          modelLabel: `${data.tier} · ${data.model} · reasoning ${data.reasoning_effort}`,
        }
        patchStage('analyzing_input', 'done')
        patchStage('selecting_route', 'done', '选择模型', `${data.tier} → ${data.model}`)
        patchStage('calling_llm', 'active', '调用模型', '等待模型响应…')
      } else if (event === 'progress') {
        const map: Record<string, { key: ThinkingStage['key']; label: string }> = {
          preparing_request: { key: 'analyzing_input', label: '准备请求' },
          calling_model: { key: 'calling_llm', label: '调用模型' },
          saving_result: { key: 'parsing', label: '保存结果' },
        }
        const target = map[data.stage] || { key: 'parsing' as const, label: data.stage || '保存结果' }
        patchStage(target.key, 'active', target.label, data.detail || '')
      } else if (event === 'result') {
        patchStage('calling_llm', 'done')
        patchStage('parsing', 'done', '保存完成', `${(data.assumptions || []).length} 个已记录假设`)
        next = { ...next, status: 'done' }
      } else if (event === 'error') {
        patchStage('calling_llm', 'done', '请求失败', data.message || '')
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
    applyThinkingEvent(thinkingId, 'stage', { stage: 'preparing_request', detail: `消息长度 ${message.length} 字符` })

    try {
      let currentSessionId = sessionIdRef.current
      if (queuedFiles.length) {
        if (!currentSessionId) {
          currentSessionId = crypto.randomUUID()
          setActiveSession(currentSessionId)
        }
        applyThinkingEvent(thinkingId, 'stage', { stage: 'uploading', detail: `${queuedFiles.length} 个文件` })
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

      if (streamError) throw new Error(streamError.message || '模型请求失败')
      if (result) {
        setActiveSession(result.session_id || currentSessionId)
        const routeMeta = result.model
          ? `${result.model_tier || 'adaptive'} · ${result.model} · reasoning ${result.reasoning_effort || 'default'}`
          : ''
        setMessages(previous => addMessage(
          previous,
          'assistant',
          result.reply || '',
          `${clarificationMode === 'automatic' ? '全自动模式' : '详细模式'}${routeMeta ? ` · ${routeMeta}` : ''}`,
        ))
        if (result.spec) {
          setSpec(result.spec)
          setSpecStatus('待确认')
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
      showToast('项目已创建')
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

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        activeProjectId={projectId}
        onNewProject={newProject}
        onOpenProject={id => void openProject(id)}
        onOpenMemory={() => {
          if (!projectId) showToast('请先打开一个研究项目。')
          else setMemoryOpen(true)
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace">
        <Topbar
          title={view === 'idea' ? '新研究项目' : project?.title || '研究项目'}
          meta={view === 'idea'
            ? 'Idea clarification'
            : `${project?.current_stage || 'research'} · v${project?.current_idea_version ?? 1} · ${String(projectId || '').slice(0, 8)}`}
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
            activeTab={activeTab}
            onTabChange={setActiveTab}
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
          <div className="loading-view"><div className="empty">正在加载项目…</div></div>
        )}
      </main>
      <ModelSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
