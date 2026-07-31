import { FlaskConical, Image, LayoutDashboard, Library, MessageCircle, ShieldCheck, Stamp, FileText } from 'lucide-react'
import type { ChatMessage, ConfirmRequest, ProjectDetail, TabId } from '../types'
import { ProjectChat } from './ProjectChat'
import { OverviewTab } from './tabs/OverviewTab'
import { LiteratureTab } from './tabs/LiteratureTab'
import { ExperimentsTab } from './tabs/ExperimentsTab'
import { ArtifactsTab } from './tabs/ArtifactsTab'
import { ApprovalsTab } from './tabs/ApprovalsTab'
import { PoliciesTab } from './tabs/PoliciesTab'
import { ReportsTab } from './tabs/ReportsTab'

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: '概览', icon: <LayoutDashboard size={16} /> },
  { id: 'literature', label: '文献', icon: <Library size={16} /> },
  { id: 'experiments', label: '实验', icon: <FlaskConical size={16} /> },
  { id: 'artifacts', label: '产物', icon: <Image size={16} /> },
  { id: 'approvals', label: '审批', icon: <Stamp size={16} /> },
  { id: 'policies', label: '策略', icon: <ShieldCheck size={16} /> },
  { id: 'reports', label: '报告', icon: <FileText size={16} /> },
]

export function ProjectView({
  project,
  activeTab,
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
  activeTab: TabId
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

  return (
    <section className="project-view">
      <nav className="tabs" aria-label="项目标签页">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="project-layout">
        <div className="tab-content">
          {activeTab === 'overview' ? <OverviewTab {...tabProps} /> : null}
          {activeTab === 'literature' ? <LiteratureTab {...tabProps} searchCandidates={searchCandidates} /> : null}
          {activeTab === 'experiments' ? <ExperimentsTab {...tabProps} /> : null}
          {activeTab === 'artifacts' ? <ArtifactsTab project={project} /> : null}
          {activeTab === 'approvals' ? <ApprovalsTab {...tabProps} /> : null}
          {activeTab === 'policies' ? <PoliciesTab {...tabProps} /> : null}
          {activeTab === 'reports' ? <ReportsTab {...tabProps} /> : null}
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
