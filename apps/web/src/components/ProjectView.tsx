import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FilePenLine, FlaskConical, LayoutDashboard, Library, Maximize2, MessageCircle, Minimize2 } from 'lucide-react'
import type { ChatMessage, ConfirmRequest, ProjectDetail, ResearchArea, TabId } from '../types'
import { ProjectChat } from './ProjectChat'
import { OverviewTab } from './tabs/OverviewTab'
import { LiteratureTab } from './tabs/LiteratureTab'
import { PaperWorkspace } from './tabs/PaperWorkspace'
import { ApprovalsTab } from './tabs/ApprovalsTab'
import { ReportsTab } from './tabs/ReportsTab'
import { WorkflowStageTab } from './tabs/WorkflowStageTab'
import { ExperimentWorkspace } from './tabs/ExperimentWorkspace'
import { ResizableDivider } from './ResizableDivider'
import { useTranslation, type TranslationKey } from '../i18n'
import { WORKSPACE_TAB_META } from '../navigation'

type ProjectTab = { id: TabId }
type ProjectArea = { id: ResearchArea; labelKey: TranslationKey; icon: React.ReactNode; tabs: ProjectTab[] }

function SlidingNav({
  className,
  ariaLabel,
  activeKey,
  measurementKey,
  children,
}: {
  className: string
  ariaLabel: string
  activeKey: string
  measurementKey: string
  children: React.ReactNode
}) {
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return undefined
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('button[data-active="true"]')
      if (!active) return
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth, ready: true })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(nav)
    window.addEventListener('resize', measure)
    nav.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      nav.removeEventListener('scroll', measure)
    }
  }, [activeKey, measurementKey, children])

  return (
    <nav ref={navRef} className={`sliding-nav ${className}`} aria-label={ariaLabel}>
      <span
        className={`sliding-tab-indicator${indicator.ready ? ' ready' : ''}`}
        aria-hidden="true"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {children}
    </nav>
  )
}

const PROJECT_CHAT_MIN_WIDTH = 280
const PROJECT_CHAT_MAX_WIDTH = 520
const PROJECT_CHAT_DEFAULT_WIDTH = 360

const PROJECT_AREAS: ProjectArea[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    icon: <LayoutDashboard size={16} />,
    tabs: [{ id: 'overview' }, { id: 'idea' }, { id: 'approvals' }, { id: 'reports' }],
  },
  {
    id: 'related_work',
    labelKey: 'nav.relatedWork',
    icon: <Library size={16} />,
    tabs: [{ id: 'literature' }, { id: 'visualization' }, { id: 'seed_expansion' }],
  },
  {
    id: 'implementation',
    labelKey: 'nav.implementation',
    icon: <FlaskConical size={16} />,
    tabs: [{ id: 'method' }, { id: 'reproduction' }],
  },
  {
    id: 'paper',
    labelKey: 'nav.paper',
    icon: <FilePenLine size={16} />,
    tabs: [{ id: 'introduction' }, { id: 'paper_related_work' }, { id: 'paper_method' }, { id: 'paper_experiments' }, { id: 'conclusion' }],
  },
]

export function ProjectView({
  project,
  activeArea,
  activeTab,
  fullscreen,
  onToggleFullscreen,
  onAreaChange,
  onTabChange,
  onRefresh,
  showToast,
  onRequestConfirm,
  searchCandidates,
  chatMessages,
  chatContextLabel,
  chatBusy,
  onSendProjectChat,
  mobileChatOpen,
  onToggleMobileChat,
}: {
  project: ProjectDetail
  activeArea: ResearchArea
  activeTab: TabId
  fullscreen: boolean
  onToggleFullscreen: () => void
  onAreaChange: (area: ResearchArea) => void
  onTabChange: (tab: TabId) => void
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onRequestConfirm: (request: ConfirmRequest) => void
  searchCandidates: Array<Record<string, any>>
  chatMessages: ChatMessage[]
  chatContextLabel: string
  chatBusy: boolean
  onSendProjectChat: (message: string) => Promise<void>
  mobileChatOpen: boolean
  onToggleMobileChat: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [projectChatWidth, setProjectChatWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('researchos.projectChatWidth'))
    return Number.isFinite(stored) ? Math.min(PROJECT_CHAT_MAX_WIDTH, Math.max(PROJECT_CHAT_MIN_WIDTH, stored)) : PROJECT_CHAT_DEFAULT_WIDTH
  })
  const projectLayoutRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    window.localStorage.setItem('researchos.projectChatWidth', String(projectChatWidth))
  }, [projectChatWidth])
  const tabProps = {
    project,
    onRefresh,
    showToast,
    onNavigate: onTabChange,
    onRequestConfirm,
  }
  const area = PROJECT_AREAS.find(item => item.id === activeArea) || PROJECT_AREAS[0]

  return (
    <section className="project-view">
      <SlidingNav className="tabs project-areas" ariaLabel={t('nav.workspaceArea')} activeKey={activeArea} measurementKey={t('nav.workspaceArea')}>
        {PROJECT_AREAS.map(item => (
          <button
            key={item.id}
            type="button"
            className={activeArea === item.id ? 'active' : ''}
            data-active={activeArea === item.id ? 'true' : 'false'}
            aria-current={activeArea === item.id ? 'page' : undefined}
            onClick={() => onAreaChange(item.id)}
          >
            {item.icon}
            {t(item.labelKey)}
          </button>
        ))}
      </SlidingNav>
      <SlidingNav className="tabs project-subtabs" ariaLabel={t('nav.currentWorkspace')} activeKey={activeTab} measurementKey={t('nav.currentWorkspace')}>
        {area.tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            data-active={activeTab === tab.id ? 'true' : 'false'}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => onTabChange(tab.id)}
          >
            {WORKSPACE_TAB_META[tab.id].icon}
            {t(WORKSPACE_TAB_META[tab.id].labelKey)}
          </button>
        ))}
      </SlidingNav>
      <div
        ref={projectLayoutRef}
        className="project-layout"
        style={{ '--project-chat-width': `${projectChatWidth}px` } as React.CSSProperties}
      >
        <div className="tab-content">
          <button
            className={`icon-btn tab-fullscreen-toggle${fullscreen ? ' is-active' : ''}`}
            type="button"
            onClick={onToggleFullscreen}
            title={t(fullscreen ? 'layout.fullscreenExit' : 'layout.fullscreenEnter')}
            aria-label={t(fullscreen ? 'layout.fullscreenExit' : 'layout.fullscreenEnter')}
            aria-pressed={fullscreen}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {activeTab === 'overview' || activeTab === 'idea' ? <OverviewTab {...tabProps} tab={activeTab} /> : null}
          {activeTab === 'approvals' ? <ApprovalsTab {...tabProps} /> : null}
          {activeTab === 'reports' ? <ReportsTab {...tabProps} /> : null}
          {activeTab === 'literature' || activeTab === 'seed_expansion' ? <LiteratureTab {...tabProps} searchCandidates={searchCandidates} tab={activeTab === 'seed_expansion' ? 'seed_expansion' : 'literature'} /> : null}
          {activeTab === 'visualization' ? <WorkflowStageTab project={project} tab={activeTab} /> : null}
          {activeTab === 'method' || activeTab === 'reproduction' ? <ExperimentWorkspace project={project} mode={activeTab === 'method' ? 'method' : 'reproduction'} onNavigate={onTabChange} onRefresh={onRefresh} showToast={showToast} /> : null}
          {['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'].includes(activeTab)
            ? <PaperWorkspace project={project} tab={activeTab} onNavigate={onTabChange} onRefresh={onRefresh} showToast={showToast} />
            : null}
        </div>
        <button
          className="secondary mobile-chat-toggle"
          type="button"
          onClick={() => onToggleMobileChat(true)}
        >
          <MessageCircle size={16} />
          {t('projectChat')}
        </button>
        <ResizableDivider
          value={projectChatWidth}
          min={PROJECT_CHAT_MIN_WIDTH}
          max={PROJECT_CHAT_MAX_WIDTH}
          ariaLabel={t('layout.resizeProjectChat')}
          increaseDirection="left"
          disabledMediaQuery="(max-width: 1050px)"
          className="project-chat-resizer"
          onPreview={width => projectLayoutRef.current?.style.setProperty('--project-chat-width', `${width}px`)}
          onCommit={setProjectChatWidth}
        />
        <ProjectChat
          messages={chatMessages}
          contextLabel={chatContextLabel}
          busy={chatBusy}
          projectId={project.id}
          onSend={onSendProjectChat}
          onClose={() => onToggleMobileChat(false)}
          mobileOpen={mobileChatOpen}
        />
      </div>
    </section>
  )
}
