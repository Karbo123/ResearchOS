import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ApiError, api, errorMessage } from './api'
import type {
  ChatMessage,
  ConfirmRequest,
  ProjectDetail,
  ProjectSummary,
  ResearchArea,
  TabId,
} from './types'
import { Sidebar } from './components/Sidebar'
import { HomeSidebar } from './components/HomeSidebar'
import { HomeDrawer } from './components/HomeDrawer'
import { Topbar } from './components/Topbar'
import { HomeDashboard } from './components/HomeDashboard'
import { ProjectView } from './components/ProjectView'
import { ProjectDrawer } from './components/ProjectDrawer'
import { AREA_DEFAULT_TAB, AREA_LABEL_KEYS, normalizeTab, resolveWorkspaceLocation, TAB_AREA, TAB_LABEL_KEYS, WORKSPACE_TAB_META, workspacePath, workspaceScopeKey } from './navigation'
import { ModelSettingsModal } from './components/ModelSettingsModal'
import { MemoryGraphModal } from './components/MemoryGraphModal'
import { NotFoundView } from './components/NotFoundView'
import { DeleteProjectDialog } from './components/DeleteProjectDialog'
import { ConfirmDialog, Toast } from './components/ui'
import { useTranslation } from './i18n'

function nextMessageId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const RECENT_PROJECTS_KEY = 'researchos.recentProjects'

function readRecentProjects(): Array<{ id: string; lastSeenAt: number }> {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_PROJECTS_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value
      .map(item => {
        if (typeof item === 'string') return { id: item, lastSeenAt: Date.now() }
        if (item && typeof item.id === 'string' && typeof item.lastSeenAt === 'number') {
          return { id: item.id, lastSeenAt: item.lastSeenAt }
        }
        if (item && typeof item.id === 'string' && typeof item.openedAt === 'number') {
          return { id: item.id, lastSeenAt: item.openedAt }
        }
        return null
      })
      .filter((item): item is { id: string; lastSeenAt: number } => Boolean(item))
  } catch {
    return []
  }
}

function recordRecentProject(id: string, at = Date.now()) {
  const recent = readRecentProjects().filter(entry => entry.id !== id)
  recent.unshift({ id, lastSeenAt: at })
  const next = recent.slice(0, 12)
  window.localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next))
  return next
}

export function App() {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [view, setView] = useState<'home' | 'project'>('home')
  const [activeArea, setActiveArea] = useState<ResearchArea>('overview')
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [health, setHealth] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [toast, setToast] = useState<string | null>(null)
  const [projectMessages, setProjectMessages] = useState<Record<string, ChatMessage[]>>({})
  const [projectChatBusy, setProjectChatBusy] = useState(false)
  const [sessionIdsByScope, setSessionIdsByScope] = useState<Record<string, string | null>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [contentFullscreen, setContentFullscreen] = useState(false)
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false)
  const [homeDrawerOpen, setHomeDrawerOpen] = useState(false)
  const [projectRefreshing, setProjectRefreshing] = useState(false)
  const [recentProjects, setRecentProjects] = useState<Array<{ id: string; lastSeenAt: number }>>(() => readRecentProjects())
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('researchos.sidebarWidth'))
    return Number.isFinite(stored) ? Math.min(380, Math.max(220, stored)) : 276
  })

  const projectChatBusyRef = useRef(false)
  const loadedChatScopesRef = useRef<Set<string>>(new Set())
  const activeProjectIdRef = useRef<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const pinningProjectIdsRef = useRef<Set<string>>(new Set())
  const projectsRef = useRef<ProjectSummary[]>([])

  useEffect(() => {
    window.localStorage.setItem('researchos.sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

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
    setHomeLoading(true)
    setHomeError(null)
    try {
      setProjects(await api<ProjectSummary[]>('/api/projects'))
    } catch (error) {
      const message = errorMessage(error)
      setHomeError(message)
      showToast(message)
    } finally {
      setHomeLoading(false)
    }
  }

  const recordLeaveCurrentProject = () => {
    const currentId = activeProjectIdRef.current
    if (!currentId) return
    setRecentProjects(recordRecentProject(currentId, Date.now()))
  }

  const goHome = (replace = false) => {
    recordLeaveCurrentProject()
    setProjectId(null)
    setProject(null)
    activeProjectIdRef.current = null
    setView('home')
    setActiveArea('overview')
    setActiveTab('overview')
    setContentFullscreen(false)
    setProjectMessages({})
    setSessionIdsByScope({})
    loadedChatScopesRef.current.clear()
    setMobileChatOpen(false)
    setProjectDrawerOpen(false)
    setHomeDrawerOpen(false)
    setNotFoundPath(null)
    if (replace) window.history.replaceState(null, '', '/')
    else window.history.pushState(null, '', '/')
    void loadProjects()
  }

  const openProject = async (reference: string, options?: { preserveTab?: boolean; route?: { area: ResearchArea; tab: TabId } }) => {
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(reference)}`)
      if (projectId !== detail.id) {
        recordLeaveCurrentProject()
      }
      if (projectId !== detail.id) {
        setProjectMessages({})
        setSessionIdsByScope({})
        loadedChatScopesRef.current.clear()
        setMobileChatOpen(false)
      }
      setProjectId(detail.id)
      activeProjectIdRef.current = detail.id
      setProject(detail)
      setView('project')
      setContentFullscreen(false)
      setProjectDrawerOpen(false)
      setHomeDrawerOpen(false)
      if (!options?.preserveTab) {
        setActiveArea('overview')
        setActiveTab('overview')
        writeWorkspacePath(detail.slug || detail.id, 'overview', 'overview')
      } else if (options.route) {
        writeWorkspacePath(detail.slug || detail.id, options.route.area, options.route.tab, true)
      }
      void loadProjects()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setNotFoundPath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
        return
      }
      showToast(errorMessage(error))
    }
  }

  const refreshProject = async () => {
    if (projectRefreshing) return
    setProjectRefreshing(true)
    try {
      if (projectId) await openProject(projectId, { preserveTab: true })
      else await loadProjects()
    } finally {
      setProjectRefreshing(false)
    }
  }

  const createProject = async (slug: string, title: string) => {
    const result = await api<{ project: { id: string; slug: string } }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ slug, title }),
    })
    showToast(t('app.projectCreated'))
    await openProject(result.project.id)
  }

  const deleteProject = async (confirmation: string) => {
    const target = deleteProjectTarget
    if (!target || deleteBusy) return
    setDeleteBusy(true)
    try {
      const current = await api<Pick<ProjectDetail, 'id' | 'title'>>(`/api/projects/${encodeURIComponent(target.id)}`)
      await api(`/api/projects/${target.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ project_title: current.title, confirmation }),
      })
      setDeleteProjectTarget(null)
      setProjects(previous => previous.filter(project => project.id !== target.id))
      if (target.id === projectId) goHome(true)
      else await loadProjects()
      showToast(t('app.projectDeleted'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const pinProject = async (target: ProjectSummary) => {
    if (pinningProjectIdsRef.current.has(target.id)) return
    pinningProjectIdsRef.current.add(target.id)
    const previousProjects = projectsRef.current
    const desiredPinned = !target.pinned
    const applyPinned = (current: ProjectSummary[], projectId: string, pinned: boolean, sidebarOrder?: number) => {
      const currentProject = current.find(project => project.id === projectId)
      if (!currentProject) return current
      const changed = { ...currentProject, pinned, sidebar_order: sidebarOrder ?? -1 }
      const pinnedProjects = current.filter(project => project.pinned && project.id !== projectId)
      const unpinnedProjects = current.filter(project => !project.pinned && project.id !== projectId)
      return pinned ? [...pinnedProjects, changed, ...unpinnedProjects] : [...pinnedProjects, ...unpinnedProjects, changed]
    }
    setProjects(current => applyPinned(current, target.id, desiredPinned))
    try {
      await api(`/api/projects/${target.id}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !target.pinned }),
      })
      showToast(t(target.pinned ? 'app.projectUnpinned' : 'app.projectPinned'))
    } catch (error) {
      setProjects(previousProjects)
      showToast(errorMessage(error))
    } finally {
      pinningProjectIdsRef.current.delete(target.id)
    }
  }

  const renameProject = async (nextTitle: string) => {
    if (!project) return
    const title = nextTitle.trim()
    if (!title) return
    try {
      const result = await api<{ id: string; slug: string; title: string }>(`/api/projects/${encodeURIComponent(project.id)}/title`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      setProject(current => current && current.id === result.id ? { ...current, title: result.title } : current)
      setProjects(current => current.map(item => item.id === result.id ? { ...item, title: result.title } : item))
      showToast(t('app.projectRenamed'))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const requestDeleteProject = (target: ProjectSummary) => {
    setDeleteProjectTarget(projects.find(project => project.id === target.id) || target)
  }

  const reorderProjects = async (projectIds: string[]) => {
    const previousProjects = projectsRef.current
    const applyOrder = (current: ProjectSummary[], ids: string[]) => {
      const movedIds = new Set(ids)
      const moved = ids
        .map(id => current.find(project => project.id === id))
        .filter((project): project is ProjectSummary => Boolean(project))
      if (moved.length !== ids.length) return current
      const pinned = moved[0]?.pinned ?? false
      if (pinned) return [...moved, ...current.filter(project => !movedIds.has(project.id))]
      const pinnedProjects = current.filter(project => project.pinned)
      const unpinnedRest = current.filter(project => !project.pinned && !movedIds.has(project.id))
      return [...pinnedProjects, ...moved, ...unpinnedRest]
    }
    setProjects(current => applyOrder(current, projectIds))
    try {
      await api('/api/projects/order', {
        method: 'PATCH',
        body: JSON.stringify({ project_ids: projectIds }),
      })
      showToast(t('app.projectOrderUpdated'))
    } catch (error) {
      setProjects(previousProjects)
      showToast(errorMessage(error))
    }
  }

  const sendProjectChat = async (message: string) => {
    if (projectChatBusyRef.current || !project) return
    const scope = workspaceScopeKey(activeArea, activeTab)
    projectChatBusyRef.current = true
    setProjectChatBusy(true)
    setProjectMessages(previous => ({
      ...previous,
      [scope]: [...(previous[scope] || []), { id: nextMessageId(), role: 'user', text: message }],
    }))
    try {
      const result = await api<Record<string, any>>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          session_id: sessionIdsByScope[scope] ?? null,
          project_id: project.id,
          message,
          workspace_area: activeArea,
          workspace_tab: activeTab,
          workspace_label: t(TAB_LABEL_KEYS[activeTab]),
        }),
      })
      const routeMeta = result.model
        ? `${result.model_tier || 'adaptive'} · ${result.model} · reasoning ${result.reasoning_effort || 'default'}`
        : ''
      setSessionIdsByScope(previous => ({ ...previous, [scope]: result.session_id || previous[scope] || null }))
      setProjectMessages(previous => ({
        ...previous,
        [scope]: [...(previous[scope] || []), {
          id: nextMessageId(),
          role: 'assistant',
          text: result.reply || '',
          meta: routeMeta || undefined,
          context_manifest_id: typeof result.context_manifest_id === 'string' ? result.context_manifest_id : undefined,
          context_status: result.context_status,
        }],
      }))
      if (result.action_required) {
        await refreshProject()
        setActiveTab('approvals')
      }
    } catch (error) {
      const message = errorMessage(error)
      setProjectMessages(previous => ({
        ...previous,
        [scope]: [...(previous[scope] || []), { id: nextMessageId(), role: 'error', text: message }],
      }))
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
          recordLeaveCurrentProject()
          activeProjectIdRef.current = null
          setHomeDrawerOpen(false)
          setNotFoundPath(null)
          setView('home')
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
    const recordPageClose = () => {
      if (activeProjectIdRef.current) {
        recordRecentProject(activeProjectIdRef.current, Date.now())
      }
    }
    window.addEventListener('pagehide', recordPageClose)
    window.addEventListener('beforeunload', recordPageClose)
    window.addEventListener('popstate', restoreWorkspace)
    window.addEventListener('hashchange', restoreWorkspace)
    return () => {
      window.removeEventListener('pagehide', recordPageClose)
      window.removeEventListener('beforeunload', recordPageClose)
      window.removeEventListener('popstate', restoreWorkspace)
      window.removeEventListener('hashchange', restoreWorkspace)
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    const scope = workspaceScopeKey(activeArea, activeTab)
    if (loadedChatScopesRef.current.has(scope)) return
    loadedChatScopesRef.current.add(scope)
    let cancelled = false
    api<{ session_id: string | null; messages: ChatMessage[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/chat-session?area=${encodeURIComponent(activeArea)}&tab=${encodeURIComponent(activeTab)}`,
    )
      .then(result => {
        if (cancelled) return
        setSessionIdsByScope(previous => (
          previous[scope] ? previous : { ...previous, [scope]: result.session_id }
        ))
        setProjectMessages(previous => (
          previous[scope]?.length ? previous : { ...previous, [scope]: result.messages }
        ))
      })
      .catch(() => {
        if (!cancelled) loadedChatScopesRef.current.delete(scope)
      })
    return () => { cancelled = true }
  }, [projectId, activeArea, activeTab])

  useEffect(() => {
    if (!projectDrawerOpen || view !== 'project') return
    const closeDrawer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.project-drawer-region')) {
        setProjectDrawerOpen(false)
      }
    }
    const closeDrawerOnFocus = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.project-drawer-region')) {
        setProjectDrawerOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeDrawer, true)
    document.addEventListener('focusin', closeDrawerOnFocus, true)
    return () => {
      document.removeEventListener('pointerdown', closeDrawer, true)
      document.removeEventListener('focusin', closeDrawerOnFocus, true)
    }
  }, [projectDrawerOpen, view])

  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 761px)')
    const closeOnDesktop = () => {
      if (desktopMedia.matches) setHomeDrawerOpen(false)
    }
    desktopMedia.addEventListener('change', closeOnDesktop)
    return () => desktopMedia.removeEventListener('change', closeOnDesktop)
  }, [])

  if (notFoundPath) {
    return <NotFoundView key={notFoundPath} path={notFoundPath} onGoHome={() => goHome(true)} />
  }

  return (
    <div className={`app-shell${view === 'project' ? ' project-mode' : ''}${contentFullscreen ? ' content-fullscreen' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      {view === 'project' ? (
        <ProjectDrawer
          open={projectDrawerOpen}
          drawerWidth={sidebarWidth}
          onOpenChange={setProjectDrawerOpen}
          projects={projects}
          activeProjectId={projectId}
          onNewProject={() => goHome()}
          onOpenProject={id => {
            setProjectDrawerOpen(false)
            void openProject(id)
          }}
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
      ) : (
        <>
          <HomeSidebar
            projects={projects}
            health={health}
            refreshing={projectRefreshing}
            recentProjects={recentProjects}
            onGoHome={() => goHome()}
            onOpenProject={id => void openProject(id)}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefresh={() => void refreshProject()}
            sidebarWidth={sidebarWidth}
            onSidebarWidthChange={updateSidebarWidth}
          />
          <HomeDrawer
            open={homeDrawerOpen}
            drawerWidth={sidebarWidth}
            onOpenChange={setHomeDrawerOpen}
            projects={projects}
            health={health}
            refreshing={projectRefreshing}
            recentProjects={recentProjects}
            onGoHome={() => goHome()}
            onOpenProject={id => void openProject(id)}
            onOpenSettings={() => {
              setHomeDrawerOpen(false)
              setSettingsOpen(true)
            }}
            onRefresh={() => void refreshProject()}
            sidebarWidth={sidebarWidth}
            onSidebarWidthChange={updateSidebarWidth}
          />
        </>
      )}
      <main className="workspace">
        {view === 'project' ? (
          <Topbar
            title={project?.title || t('app.researchProject')}
            meta={t('app.projectMeta', {
              stage: project?.current_stage === 'initialized'
                ? t('overview.stageInitialized')
                : project?.current_stage || t('overview.stageUnknown'),
              version: project?.current_idea_version ?? 1,
              id: project?.slug || String(projectId || '').slice(0, 8),
            })}
            health={health}
            refreshing={projectRefreshing}
            onRefresh={() => void refreshProject()}
            project={project}
            fullscreen={contentFullscreen}
            onRenameTitle={renameProject}
            contextTitle={(
              <span className="topbar-context-breadcrumb">
                <span className="topbar-context-area">{t(AREA_LABEL_KEYS[activeArea])}</span>
                <span className="topbar-context-separator" aria-hidden="true">/</span>
                <span className="topbar-context-tab">
                  {WORKSPACE_TAB_META[activeTab].icon}
                  {t(WORKSPACE_TAB_META[activeTab].labelKey)}
                </span>
              </span>
            )}
          />
        ) : null}
        {view === 'project' ? (
          project ? (
            <ProjectView
              project={project}
              activeArea={activeArea}
              activeTab={activeTab}
              fullscreen={contentFullscreen}
              onToggleFullscreen={() => {
                setContentFullscreen(previous => !previous)
                setMobileChatOpen(false)
                setProjectDrawerOpen(false)
              }}
              onAreaChange={navigateArea}
              onTabChange={navigateTab}
              onRefresh={refreshProject}
              showToast={showToast}
              onRequestConfirm={requestConfirm}
              searchCandidates={[]}
              chatMessages={projectMessages[workspaceScopeKey(activeArea, activeTab)] || []}
              chatContextLabel={t(TAB_LABEL_KEYS[activeTab])}
              chatBusy={projectChatBusy}
              onSendProjectChat={sendProjectChat}
              mobileChatOpen={mobileChatOpen}
              onToggleMobileChat={setMobileChatOpen}
            />
          ) : (
            <div className="loading-view"><div className="empty">{t('common.loadingProject')}</div></div>
          )
        ) : (
          <HomeDashboard
            projects={projects}
            loading={homeLoading}
            error={homeError}
            onRetry={() => void loadProjects()}
            onOpenProject={id => void openProject(id)}
            onCreateProject={createProject}
            onPinProject={pinProject}
            onDeleteProject={requestDeleteProject}
            onReorderProjects={reorderProjects}
          />
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
