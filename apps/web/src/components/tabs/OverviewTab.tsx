import { FileCheck, FilePenLine, Pause, Play, Search, Square } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ConfirmRequest, ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, SectionHeading } from '../ui'

export function OverviewTab({
  project,
  onRefresh,
  showToast,
  onNavigate,
  onRequestConfirm,
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onNavigate: (tab: TabId) => void
  onRequestConfirm: (request: ConfirmRequest) => void
}) {
  const counts = project.counts || {
    papers: project.papers?.length || 0,
    experiments: project.experiments?.length || 0,
    artifacts: project.artifacts?.length || 0,
  }
  const pendingCount = project.proposals?.filter(proposal => proposal.status === 'pending').length || 0
  const spec = project.spec?.idea

  const runSearch = async () => {
    try {
      showToast('正在并行检索多个学术来源与资源注册表…')
      await api('/api/search', { method: 'POST', body: JSON.stringify({ project_id: project.id, limit: 8 }) })
      await onRefresh()
      showToast('检索完成，候选资源已刷新')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const createPaperDraft = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/paper-draft`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(`证据论文草稿 Proposal ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const createCompilePlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/compile-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(`编译计划 ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const changeState = async (action: 'pause' | 'resume' | 'cancel') => {
    const reason = action === 'pause'
      ? 'User paused the project from the Web UI'
      : action === 'resume'
        ? 'User resumed the project from the Web UI'
        : 'User cancelled the project from the Web UI'
    try {
      await api(`/api/projects/${project.id}/state`, { method: 'POST', body: JSON.stringify({ action, reason }) })
      await onRefresh()
      showToast(action === 'pause' ? '项目已暂停' : action === 'resume' ? '项目已恢复' : '项目已取消')
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const isActive = project.status === 'active'
  const executionDisabled = !isActive

  return (
    <>
      <div className="metric-grid">
        <div className="metric"><span>论文</span><strong>{counts.papers ?? 0}</strong></div>
        <div className="metric"><span>实验</span><strong>{counts.experiments ?? 0}</strong></div>
        <div className="metric"><span>产物</span><strong>{counts.artifacts ?? 0}</strong></div>
        <div className="metric"><span>待审批</span><strong>{pendingCount}</strong></div>
      </div>

      <div className="section">
        <SectionHeading
          title="研究规格"
          extra={
            <ButtonRow>
              <button className="secondary" type="button" disabled={executionDisabled} onClick={runSearch}>
                <Search size={15} />
                检索文献
              </button>
              <button className="secondary" type="button" disabled={executionDisabled} onClick={createPaperDraft}>
                <FilePenLine size={15} />
                生成证据论文草稿
              </button>
              <button className="secondary" type="button" disabled={executionDisabled} onClick={createCompilePlan}>
                <FileCheck size={15} />
                编译论文
              </button>
            </ButtonRow>
          }
        />
        <div className="data-list">
          <div className="data-row">
            <div>
              <h3>{spec?.research_question || '尚未生成研究规格'}</h3>
              <p>{spec?.domain} · {(spec?.keywords || []).join(', ')}</p>
            </div>
            <Badge status={project.spec?.feasibility} />
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHeading
          title="项目状态"
          extra={
            project.status === 'active' ? (
              <ButtonRow>
                <button className="secondary" type="button" onClick={() => changeState('pause')}>
                  <Pause size={15} />
                  暂停
                </button>
                <button className="reject" type="button" onClick={() => onRequestConfirm({
                  title: '取消项目',
                  description: '取消项目后不能恢复，确定继续吗？',
                  confirmLabel: '确认取消',
                  onConfirm: () => changeState('cancel'),
                })}>
                  <Square size={15} />
                  取消项目
                </button>
              </ButtonRow>
            ) : project.status === 'paused' ? (
              <ButtonRow>
                <button className="approve" type="button" onClick={() => changeState('resume')}>
                  <Play size={15} />
                  恢复
                </button>
                <button className="reject" type="button" onClick={() => onRequestConfirm({
                  title: '取消项目',
                  description: '取消项目后不能恢复，确定继续吗？',
                  confirmLabel: '确认取消',
                  onConfirm: () => changeState('cancel'),
                })}>
                  <Square size={15} />
                  取消项目
                </button>
              </ButtonRow>
            ) : null
          }
        />
        <div className="data-list">
          <div className="data-row">
            <div>
              <h3>{project.current_stage || 'research'}</h3>
              <p>Idea version {project.current_idea_version ?? 1} · {project.status}</p>
            </div>
            <Badge status={project.status} />
          </div>
        </div>
      </div>
    </>
  )
}
