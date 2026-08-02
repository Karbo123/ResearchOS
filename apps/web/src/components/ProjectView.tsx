import { BarChart3, BookOpen, CalendarDays, CheckSquare, FileCheck2, FilePenLine, FileText, FlaskConical, GitBranch, GitCompare, History, Image, Inbox, LayoutDashboard, Library, LineChart, ListChecks, ListTree, MessageCircle, Network, Quote, Search, Stamp, Terminal, Waypoints } from 'lucide-react'
import type { ChatMessage, ConfirmRequest, ProjectDetail, ResearchArea, TabId } from '../types'
import { ProjectChat } from './ProjectChat'
import { OverviewTab } from './tabs/OverviewTab'
import { LiteratureTab } from './tabs/LiteratureTab'
import { PaperTab } from './tabs/PaperTab'
import { ReproductionTab } from './tabs/ReproductionTab'
import { ComparisonTab } from './tabs/ComparisonTab'
import { ResearchStatusTab } from './tabs/ResearchStatusTab'
import { ExperimentsTab } from './tabs/ExperimentsTab'
import { ArtifactsTab } from './tabs/ArtifactsTab'
import { ApprovalsTab } from './tabs/ApprovalsTab'
import { PoliciesTab } from './tabs/PoliciesTab'
import { ReportsTab } from './tabs/ReportsTab'
import { WorkflowStageTab } from './tabs/WorkflowStageTab'
import { WorkspaceContextBar } from './WorkspaceContextBar'
import { useTranslation, type TranslationKey } from '../i18n'

type ProjectTab = { id: TabId; labelKey: TranslationKey; icon: React.ReactNode }
type ProjectGroup = { id: string; labelKey: TranslationKey; icon: React.ReactNode; tabs: ProjectTab[] }
type ProjectArea = { id: ResearchArea; labelKey: TranslationKey; icon: React.ReactNode; groups: ProjectGroup[] }

const REPORT_TABS: TabId[] = ['daily_reports', 'weekly_reports', 'feedback_inbox', 'feedback_audit', 'reports']
const PAPER_TABS: TabId[] = ['paper', 'paper_outline', 'paper_citations', 'paper_figures', 'paper_data', 'paper_compile', 'paper_review']

const AREAS: ProjectArea[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    icon: <LayoutDashboard size={16} />,
    groups: [
      { id: 'overview_idea', labelKey: 'group.overviewIdea', icon: <MessageCircle size={15} />, tabs: [{ id: 'overview', labelKey: 'tab.overview', icon: <MessageCircle size={15} /> }] },
      { id: 'overview_spec', labelKey: 'group.overviewSpec', icon: <FileText size={15} />, tabs: [{ id: 'overview_spec', labelKey: 'tab.overviewSpec', icon: <FileText size={15} /> }] },
      { id: 'overview_innovation', labelKey: 'group.overviewInnovation', icon: <Search size={15} />, tabs: [{ id: 'overview_innovation', labelKey: 'tab.overviewInnovation', icon: <Search size={15} /> }] },
      { id: 'overview_progress', labelKey: 'group.overviewProgress', icon: <ListChecks size={15} />, tabs: [{ id: 'overview_progress', labelKey: 'tab.overviewProgress', icon: <ListChecks size={15} /> }] },
      { id: 'overview_reports', labelKey: 'group.overviewReports', icon: <CalendarDays size={15} />, tabs: [
        { id: 'daily_reports', labelKey: 'tab.dailyReports', icon: <CalendarDays size={15} /> },
        { id: 'weekly_reports', labelKey: 'tab.weeklyReports', icon: <FileText size={15} /> },
        { id: 'feedback_inbox', labelKey: 'tab.feedbackInbox', icon: <Inbox size={15} /> },
        { id: 'feedback_audit', labelKey: 'tab.feedbackAudit', icon: <CheckSquare size={15} /> },
      ] },
    ],
  },
  {
    id: 'related_work',
    labelKey: 'nav.relatedWork',
    icon: <Library size={16} />,
    groups: [
      { id: 'related_search', labelKey: 'group.relatedSearch', icon: <BookOpen size={15} />, tabs: [{ id: 'literature', labelKey: 'tab.literature', icon: <BookOpen size={15} /> }] },
      { id: 'related_status', labelKey: 'group.relatedStatus', icon: <Network size={15} />, tabs: [
        { id: 'research_status', labelKey: 'tab.researchStatus', icon: <Search size={15} /> },
        { id: 'citation_graph', labelKey: 'tab.citationGraph', icon: <Network size={15} /> },
      ] },
    ],
  },
  {
    id: 'implementation',
    labelKey: 'nav.implementation',
    icon: <FlaskConical size={16} />,
    groups: [
      { id: 'implementation_related', labelKey: 'group.implRelated', icon: <GitBranch size={15} />, tabs: [
        { id: 'reproduction', labelKey: 'tab.reproduction', icon: <GitBranch size={15} /> },
        { id: 'comparison', labelKey: 'tab.comparison', icon: <GitCompare size={15} /> },
      ] },
      { id: 'implementation_method', labelKey: 'group.implMethod', icon: <Waypoints size={15} />, tabs: [
        { id: 'method_design', labelKey: 'tab.methodDesign', icon: <Waypoints size={15} /> },
        { id: 'code_workspace', labelKey: 'tab.codeWorkspace', icon: <Terminal size={15} /> },
        { id: 'policies', labelKey: 'tab.policies', icon: <Stamp size={15} /> },
        { id: 'approvals', labelKey: 'tab.approvals', icon: <History size={15} /> },
        { id: 'experiments', labelKey: 'tab.experiments', icon: <FlaskConical size={15} /> },
        { id: 'experiment_queue', labelKey: 'tab.experimentQueue', icon: <ListTree size={15} /> },
        { id: 'experiment_metrics', labelKey: 'tab.experimentMetrics', icon: <BarChart3 size={15} /> },
        { id: 'artifacts', labelKey: 'tab.artifacts', icon: <Image size={15} /> },
        { id: 'lineage', labelKey: 'tab.lineage', icon: <History size={15} /> },
      ] },
    ],
  },
  {
    id: 'paper',
    labelKey: 'nav.paper',
    icon: <FilePenLine size={16} />,
    groups: [
      { id: 'paper_project', labelKey: 'tab.paperProject', icon: <FilePenLine size={15} />, tabs: [{ id: 'paper', labelKey: 'tab.paperProject', icon: <FilePenLine size={15} /> }] },
      { id: 'paper_outline', labelKey: 'tab.paperOutline', icon: <ListTree size={15} />, tabs: [{ id: 'paper_outline', labelKey: 'tab.paperOutline', icon: <ListTree size={15} /> }] },
      { id: 'paper_citations', labelKey: 'tab.paperCitations', icon: <Quote size={15} />, tabs: [{ id: 'paper_citations', labelKey: 'tab.paperCitations', icon: <Quote size={15} /> }] },
      { id: 'paper_figures', labelKey: 'tab.paperFigures', icon: <LineChart size={15} />, tabs: [{ id: 'paper_figures', labelKey: 'tab.paperFigures', icon: <LineChart size={15} /> }] },
      { id: 'paper_data', labelKey: 'tab.paperData', icon: <BarChart3 size={15} />, tabs: [{ id: 'paper_data', labelKey: 'tab.paperData', icon: <BarChart3 size={15} /> }] },
      { id: 'paper_compile', labelKey: 'tab.paperCompile', icon: <FileCheck2 size={15} />, tabs: [{ id: 'paper_compile', labelKey: 'tab.paperCompile', icon: <FileCheck2 size={15} /> }] },
      { id: 'paper_review', labelKey: 'tab.paperReview', icon: <FileText size={15} />, tabs: [{ id: 'paper_review', labelKey: 'tab.paperReview', icon: <FileText size={15} /> }] },
    ],
  },
]

export function ProjectView({
  project,
  activeArea,
  activeTab,
  onAreaChange,
  onTabChange,
  onRefresh,
  showToast,
  onRequestConfirm,
  searchCandidates,
  chatMessages,
  chatBusy,
  onSendProjectChat,
  mobileChatOpen,
  onToggleMobileChat,
}: {
  project: ProjectDetail
  activeArea: ResearchArea
  activeTab: TabId
  onAreaChange: (area: ResearchArea) => void
  onTabChange: (tab: TabId) => void
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onRequestConfirm: (request: ConfirmRequest) => void
  searchCandidates: Array<Record<string, any>>
  chatMessages: ChatMessage[]
  chatBusy: boolean
  onSendProjectChat: (message: string) => Promise<void>
  mobileChatOpen: boolean
  onToggleMobileChat: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const tabProps = {
    project,
    onRefresh,
    showToast,
    onNavigate: onTabChange,
    onRequestConfirm,
  }
  const area = AREAS.find(item => item.id === activeArea) || AREAS[0]
  const activeGroup = area.groups.find(group => group.tabs.some(tab => tab.id === activeTab)) || area.groups[0]

  return (
    <section className="project-view">
      <nav className="tabs project-areas" aria-label={t('nav.workspaceArea')}>
        {AREAS.map(area => (
          <button
            key={area.id}
            type="button"
            className={activeArea === area.id ? 'active' : ''}
            aria-current={activeArea === area.id ? 'page' : undefined}
            onClick={() => onAreaChange(area.id)}
          >
            {area.icon}
            {t(area.labelKey)}
          </button>
        ))}
      </nav>
      <nav className="tabs project-subtabs" aria-label={t('nav.currentWorkspace')}>
        {area.groups.map(group => (
          <button
            key={group.id}
            type="button"
            className={activeGroup.id === group.id ? 'active' : ''}
            aria-current={activeGroup.id === group.id ? 'page' : undefined}
            onClick={() => onTabChange(group.tabs[0].id)}
          >
            {group.icon}
            {t(group.labelKey)}
          </button>
        ))}
      </nav>
      <div className="project-layout">
        <div className="tab-content">
          <WorkspaceContextBar project={project} />
          {activeGroup.tabs.length > 1 ? (
            <nav className="workflow-local-nav" aria-label={`${t(activeGroup.labelKey)} · ${t('common.innerPages')}`}>
              <span className="workflow-local-label">{t(activeGroup.labelKey)}</span>
              {activeGroup.tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? 'active' : ''}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  onClick={() => onTabChange(tab.id)}
                >
                  {tab.icon}
                  {t(tab.labelKey)}
                </button>
              ))}
            </nav>
          ) : null}
          {activeTab === 'overview' || activeTab === 'overview_spec' ? <OverviewTab {...tabProps} /> : null}
          {activeTab === 'overview_innovation' ? <ResearchStatusTab project={project} showToast={showToast} /> : null}
          {activeTab === 'overview_progress' ? <WorkflowStageTab project={project} tab={activeTab} /> : null}
          {activeTab === 'literature' ? <LiteratureTab {...tabProps} searchCandidates={searchCandidates} /> : null}
          {activeTab === 'research_status' ? <ResearchStatusTab project={project} showToast={showToast} /> : null}
          {activeTab === 'citation_graph' ? <WorkflowStageTab project={project} tab={activeTab} /> : null}
          {activeTab === 'reproduction' ? <ReproductionTab project={project} onNavigate={onTabChange} onRefresh={onRefresh} showToast={showToast} /> : null}
          {activeTab === 'comparison' ? <ComparisonTab project={project} onRefresh={onRefresh} showToast={showToast} /> : null}
          {activeTab === 'method_design' || activeTab === 'code_workspace' ? <WorkflowStageTab project={project} tab={activeTab} /> : null}
          {activeTab === 'policies' ? <PoliciesTab {...tabProps} /> : null}
          {activeTab === 'approvals' ? <ApprovalsTab {...tabProps} /> : null}
          {activeTab === 'experiments' ? <ExperimentsTab {...tabProps} /> : null}
          {activeTab === 'experiment_queue' || activeTab === 'experiment_metrics' || activeTab === 'lineage' ? <WorkflowStageTab project={project} tab={activeTab} /> : null}
          {activeTab === 'artifacts' ? <ArtifactsTab project={project} /> : null}
          {REPORT_TABS.includes(activeTab) ? <ReportsTab {...tabProps} tab={activeTab} /> : null}
          {PAPER_TABS.includes(activeTab) ? <PaperTab project={project} tab={activeTab} onNavigate={onTabChange} onRefresh={onRefresh} showToast={showToast} /> : null}
        </div>
        <button
          className="secondary mobile-chat-toggle"
          type="button"
          onClick={() => onToggleMobileChat(true)}
        >
          <MessageCircle size={16} />
          {t('projectChat')}
        </button>
        <ProjectChat
          messages={chatMessages}
          busy={chatBusy}
          onSend={onSendProjectChat}
          onClose={() => onToggleMobileChat(false)}
          mobileOpen={mobileChatOpen}
        />
      </div>
    </section>
  )
}
