import { BarChart3, BookOpen, CalendarDays, CheckSquare, Code2, FileCheck2, FilePenLine, FileText, FlaskConical, GitBranch, GitCompare, History, Image, Inbox, LayoutDashboard, Library, LineChart, ListChecks, ListTree, MessageCircle, Network, Quote, Search, Stamp, Terminal, Waypoints } from 'lucide-react'
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

type ProjectTab = { id: TabId; label: string; icon: React.ReactNode }
type ProjectGroup = { id: string; label: string; icon: React.ReactNode; tabs: ProjectTab[] }

const REPORT_TABS: TabId[] = ['daily_reports', 'weekly_reports', 'feedback_inbox', 'feedback_audit', 'reports']
const PAPER_TABS: TabId[] = ['paper', 'paper_outline', 'paper_citations', 'paper_figures', 'paper_data', 'paper_compile', 'paper_review']

const AREAS: Array<{ id: ResearchArea; label: string; icon: React.ReactNode; groups: ProjectGroup[] }> = [
  {
    id: 'overview',
    label: '项目概述',
    icon: <LayoutDashboard size={16} />,
    groups: [
      { id: 'overview_idea', label: 'Idea 讨论', icon: <MessageCircle size={15} />, tabs: [{ id: 'overview', label: 'Idea 讨论', icon: <MessageCircle size={15} /> }] },
      { id: 'overview_spec', label: '项目规格', icon: <FileText size={15} />, tabs: [{ id: 'overview_spec', label: '项目描述与研究问题', icon: <FileText size={15} /> }] },
      { id: 'overview_innovation', label: '创新与边界', icon: <Search size={15} />, tabs: [{ id: 'overview_innovation', label: '创新点与边界', icon: <Search size={15} /> }] },
      { id: 'overview_progress', label: '进度与待决策', icon: <ListChecks size={15} />, tabs: [{ id: 'overview_progress', label: '进度与待决策', icon: <ListChecks size={15} /> }] },
      { id: 'overview_reports', label: '日报/周报与导师反馈', icon: <CalendarDays size={15} />, tabs: [
        { id: 'daily_reports', label: '日报', icon: <CalendarDays size={15} /> },
        { id: 'weekly_reports', label: '周报', icon: <FileText size={15} /> },
        { id: 'feedback_inbox', label: '导师反馈', icon: <Inbox size={15} /> },
        { id: 'feedback_audit', label: '决策与审计', icon: <CheckSquare size={15} /> },
      ] },
    ],
  },
  {
    id: 'related_work',
    label: '相关工作调研',
    icon: <Library size={16} />,
    groups: [
      { id: 'related_search', label: '种子与文献检索', icon: <BookOpen size={15} />, tabs: [{ id: 'literature', label: '种子与文献检索', icon: <BookOpen size={15} /> }] },
      { id: 'related_status', label: '研究现状与引用图', icon: <Network size={15} />, tabs: [
        { id: 'research_status', label: '研究现状', icon: <Search size={15} /> },
        { id: 'citation_graph', label: '引用图', icon: <Network size={15} /> },
      ] },
    ],
  },
  {
    id: 'implementation',
    label: '实验实现',
    icon: <FlaskConical size={16} />,
    groups: [
      { id: 'implementation_related', label: '相关工作实现', icon: <GitBranch size={15} />, tabs: [
        { id: 'reproduction', label: '代码复现', icon: <GitBranch size={15} /> },
        { id: 'comparison', label: '效果比较', icon: <GitCompare size={15} /> },
      ] },
      { id: 'implementation_method', label: '本方法实现', icon: <Waypoints size={15} />, tabs: [
        { id: 'method_design', label: '方法设计', icon: <Waypoints size={15} /> },
        { id: 'code_workspace', label: '代码工作区', icon: <Terminal size={15} /> },
        { id: 'policies', label: '变更与审批', icon: <Stamp size={15} /> },
        { id: 'approvals', label: 'Git 与备份', icon: <History size={15} /> },
        { id: 'experiments', label: '实验计划与结果', icon: <FlaskConical size={15} /> },
        { id: 'experiment_queue', label: '运行队列', icon: <ListTree size={15} /> },
        { id: 'experiment_metrics', label: '指标统计', icon: <BarChart3 size={15} /> },
        { id: 'artifacts', label: '结果与可视化', icon: <Image size={15} /> },
        { id: 'lineage', label: '实验谱系', icon: <History size={15} /> },
      ] },
    ],
  },
  {
    id: 'paper',
    label: '学术论文撰写',
    icon: <FilePenLine size={16} />,
    groups: [
      { id: 'paper_writing', label: '论文写作与编译', icon: <FilePenLine size={15} />, tabs: [
        { id: 'paper', label: '论文项目', icon: <FilePenLine size={15} /> },
        { id: 'paper_outline', label: '大纲与章节', icon: <ListTree size={15} /> },
        { id: 'paper_citations', label: '引用与 BibTeX', icon: <Quote size={15} /> },
        { id: 'paper_figures', label: '图表选择与插入', icon: <LineChart size={15} /> },
        { id: 'paper_data', label: '实验数据选择与引用', icon: <BarChart3 size={15} /> },
        { id: 'paper_compile', label: 'LaTeX 编译', icon: <FileCheck2 size={15} /> },
        { id: 'paper_review', label: 'PDF 呈现与审阅', icon: <FileText size={15} /> },
      ] },
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
      <nav className="tabs project-areas" aria-label="科研工作区">
        {AREAS.map(area => (
          <button
            key={area.id}
            type="button"
            className={activeArea === area.id ? 'active' : ''}
            aria-current={activeArea === area.id ? 'page' : undefined}
            onClick={() => onAreaChange(area.id)}
          >
            {area.icon}
            {area.label}
          </button>
        ))}
      </nav>
      <nav className="tabs project-subtabs" aria-label="当前工作区页面">
        {area.groups.map(group => (
          <button
            key={group.id}
            type="button"
            className={activeGroup.id === group.id ? 'active' : ''}
            aria-current={activeGroup.id === group.id ? 'page' : undefined}
            onClick={() => onTabChange(group.tabs[0].id)}
          >
            {group.icon}
            {group.label}
          </button>
        ))}
      </nav>
      <div className="project-layout">
        <div className="tab-content">
          <WorkspaceContextBar project={project} />
          {activeGroup.tabs.length > 1 ? (
            <nav className="workflow-local-nav" aria-label={`${activeGroup.label}内部页面`}>
              <span className="workflow-local-label">{activeGroup.label}</span>
              {activeGroup.tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? 'active' : ''}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  onClick={() => onTabChange(tab.id)}
                >
                  {tab.icon}
                  {tab.label}
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
          项目对话
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
