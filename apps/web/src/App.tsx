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
import { Topbar } from './components/Topbar'
import { HomeDashboard } from './components/HomeDashboard'
import { ProjectView } from './components/ProjectView'
import { ProjectDrawer } from './components/ProjectDrawer'
import { AREA_DEFAULT_TAB, normalizeTab, resolveWorkspaceLocation, TAB_AREA, workspacePath } from './navigation'
import { ModelSettingsModal } from './components/ModelSettingsModal'
import { MemoryGraphModal } from './components/MemoryGraphModal'
import { NotFoundView } from './components/NotFoundView'
import { DeleteProjectDialog } from './components/DeleteProjectDialog'
import { ConfirmDialog, Toast } from './components/ui'
import { useTranslation } from './i18n'

function nextMessageId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
  const [projectMessages, setProjectMessages] = useState<ChatMessage[]>([])
  const [projectChatBusy, setProjectChatBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false)
  const [projectRefreshing, setProjectRefreshing] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('researchos.sidebarWidth'))
    return Number.isFinite(stored) ? Math.min(380, Math.max(220, stored)) : 276
  })

  const projectChatBusyRef = useRef(false)
  const sessionIdRef = useRef<string | null>(null)
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

  const setActiveSession = (id: string | null) => {
    sessionIdRef.current = id
    setSessionId(id)
  }

  const goHome = (replace = false) => {
    setProjectId(null)
    setProject(null)
    setActiveSession(null)
    setView('home')
    setActiveArea('overview')
    setActiveTab('overview')
    setProjectMessages([])
    setMobileChatOpen(false)
    setProjectDrawerOpen(false)
    setNotFoundPath(null)
    if (replace) window.history.replaceState(null, '', '/')
    else window.history.pushState(null, '', '/')
    void loadProjects()
  }

  const openProject = async (reference: string, options?: { preserveTab?: boolean; route?: { area: ResearchArea; tab: TabId } }) => {
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(reference)}`)
      if (projectId !== detail.id) {
        setProjectMessages([])
        setMobileChatOpen(false)
      }
      setProjectId(detail.id)
      setProject(detail)
      setActiveSession(detail.session_id || sessionIdRef.current)
      setView('project')
      setProjectDrawerOpen(false)
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
      const updated = await api<Pick<ProjectSummary, 'pinned' | 'sidebar_order'>>(`/api/projects/${target.id}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !target.pinned }),
      })
      setProjects(current => current.map(project => project.id === target.id ? { ...project, ...updated } : project))
      showToast(t(target.pinned ? 'app.projectUnpinned' : 'app.projectPinned'))
    } catch (error) {
      setProjects(previousProjects)
      showToast(errorMessage(error))
    } finally {
      pinningProjectIdsRef.current.delete(target.id)
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
    projectChatBusyRef.current = true
    setProjectChatBusy(true)
    setProjectMessages(previous => [
      ...previous,
      { id: nextMessageId(), role: 'user', text: message },
    ])
    try {
      const result = await api<Record<string, any>>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionIdRef.current, project_id: project.id, message }),
      })
      const routeMeta = result.model
        ? `${result.model_tier || 'adaptive'} · ${result.model} · reasoning ${result.reasoning_effort || 'default'}`
        : ''
      setProjectMessages(previous => [
        ...previous,
        { id: nextMessageId(), role: 'assistant', text: result.reply || '', meta: routeMeta || undefined },
      ])
      if (result.action_required) {
        await refreshProject()
        setActiveTab('approvals')
      }
    } catch (error) {
      const message = errorMessage(error)
      setProjectMessages(previous => [...previous, { id: nextMessageId(), role: 'error', text: message }])
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
    window.addEventListener('popstate', restoreWorkspace)
    window.addEventListener('hashchange', restoreWorkspace)
    return () => {
      window.removeEventListener('popstate', restoreWorkspace)
      window.removeEventListener('hashchange', restoreWorkspace)
    }
  }, [])

  useEffect(() => {
    if (!projectDrawerOpen || view !== 'project') return
    const closeDrawer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.project-drawer-region')) {
        setProjectDrawerOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeDrawer, true)
    return () => document.removeEventListener('pointerdown', closeDrawer, true)
  }, [projectDrawerOpen, view])

  if (notFoundPath) {
    return <NotFoundView key={notFoundPath} path={notFoundPath} onGoHome={() => goHome(true)} />
  }

  return (
    <div className={`app-shell${view === 'project' ? ' project-mode' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
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
        <Sidebar
          projects={projects}
          activeProjectId={projectId}
          onNewProject={() => goHome()}
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
      )}
      <main className="workspace">
        <Topbar
          title={view === 'project' ? project?.title || t('app.researchProject') : t('home.title')}
          meta={view === 'project'
            ? t('app.projectMeta', {
                stage: project?.current_stage === 'initialized'
                  ? t('overview.stageInitialized')
                  : project?.current_stage || t('overview.stageUnknown'),
                version: project?.current_idea_version ?? 1,
                id: project?.slug || String(projectId || '').slice(0, 8),
              })
            : t('home.meta', { count: projects.length })}
          health={health}
          refreshing={projectRefreshing}
          onRefresh={() => void refreshProject()}
          project={view === 'project' ? project : null}
        />
        {view === 'project' ? (
          project ? (
            <ProjectView
              project={project}
              activeArea={activeArea}
              activeTab={activeTab}
              onAreaChange={navigateArea}
              onTabChange={navigateTab}
              onRefresh={refreshProject}
              showToast={showToast}
              onRequestConfirm={requestConfirm}
              searchCandidates={[]}
              chatMessages={projectMessages}
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
