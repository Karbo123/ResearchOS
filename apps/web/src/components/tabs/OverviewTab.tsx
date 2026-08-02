import { FileCheck, FilePenLine, Pause, Play, Search, ShieldAlert, Square } from 'lucide-react'
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
  const checkpoints = project.checkpoints || []
  const proposals = project.proposals || []
  const experiments = project.experiments || []
  const timeline = [
    ...checkpoints.map(item => ({ id: `checkpoint-${item.id}`, label: item.stage, detail: `Idea v${item.idea_version ?? project.current_idea_version ?? 1}`, status: item.valid === false ? 'invalidated' : 'recorded', created_at: item.created_at })),
    ...proposals.map(item => ({ id: `proposal-${item.id}`, label: item.summary, detail: item.reason || item.kind, status: item.status, created_at: item.created_at })),
    ...experiments.map(item => ({ id: `experiment-${item.id}`, label: item.experiment_type, detail: item.run_id ? `Run ${item.run_id}` : '尚未分配 Run', status: item.status, created_at: item.created_at })),
  ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 8)
  const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '时间待记录'

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

      <div className="section overview-grid">
        <div className="data-list overview-card">
          <SectionHeading title="项目描述" hint="当前项目规格的可审阅摘要。" />
          <div className="overview-fields">
            <div><span>研究领域</span><strong>{spec?.domain || '尚未确认'}</strong></div>
            <div><span>研究问题</span><strong>{spec?.research_question || '尚未确认'}</strong></div>
            <div><span>假设</span><strong>{spec?.hypotheses?.join('；') || '尚未生成'}</strong></div>
            <div><span>成功标准</span><strong>{spec?.success_criteria?.join('；') || '尚未生成'}</strong></div>
          </div>
        </div>
        <div className="data-list overview-card">
          <SectionHeading title="创新点候选" hint="候选建议需要相关工作证据和导师确认。" />
          {spec?.expected_contributions?.length ? (
            <ul className="candidate-list">
              {spec.expected_contributions.map((item, index) => <li key={`${item}-${index}`}><ShieldAlert size={15} /><span>{item}</span><Badge status="candidate-only" /></li>)}
            </ul>
          ) : <p className="empty-inline">尚未生成创新点候选。</p>}
        </div>
      </div>

      <div className="section">
        <SectionHeading title="研究进度" hint="时间线只汇总已记录的 Proposal、Checkpoint 和实验状态，不代表科学结论。" />
        {timeline.length ? (
          <div className="timeline" role="list">
            {timeline.map(item => (
              <div className="timeline-item" role="listitem" key={item.id}>
                <span className="timeline-dot" />
                <div><strong>{item.label}</strong><p>{item.detail} · {formatTime(item.created_at)}</p></div>
                <Badge status={item.status} />
              </div>
            ))}
          </div>
        ) : <div className="empty">尚无可展示的进度事件。</div>}
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
