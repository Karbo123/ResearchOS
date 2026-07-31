import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, SectionHeading } from '../ui'

export function PoliciesTab({
  project,
  onRefresh,
  showToast,
  onNavigate,
}: {
  project: ProjectDetail
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
  onNavigate: (tab: TabId) => void
}) {
  const [rule, setRule] = useState('')

  const addPolicy = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!rule.trim()) return
    try {
      const result = await api<{ proposal_id: string }>('/api/policies', {
        method: 'POST',
        body: JSON.stringify({ project_id: project.id, rule: rule.trim() }),
      })
      setRule('')
      await onRefresh()
      onNavigate('approvals')
      showToast(`策略提案 ${result.proposal_id.slice(0, 8)} 待审批`)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const enforcement = project.policy_enforcement || {
    status: 'unknown',
    runner_compatible: null,
    minimum_random_seed_count: 1,
    approval: {},
    citation_readiness: {},
  }
  const citation = enforcement.citation_readiness || {}

  return (
    <>
      <form className="policy-form" onSubmit={addPolicy}>
        <input
          value={rule}
          placeholder="新增长期项目策略"
          required
          onChange={event => setRule(event.target.value)}
        />
        <button className="primary" type="submit">
          <ShieldCheck size={16} />
          提出策略
        </button>
      </form>

      <div className="section">
        <SectionHeading title="执行状态" extra={<Badge status={enforcement.status || 'unknown'} />} />
        <div className="data-list">
          <div className="data-row">
            <div>
              <h3>随机种子下限</h3>
              <p>随机实验至少 {Number(enforcement.minimum_random_seed_count || 1)} 个不同种子；计划生成和 Runner 提交双重校验</p>
            </div>
            <Badge status={enforcement.runner_compatible === false ? 'unsupported' : 'enforced'} />
          </div>
          <div className="data-row">
            <div>
              <h3>引用来源与原文证据</h3>
              <p>
                DOI/来源 {Number(citation.records_with_doi_or_source_url || 0)}/{Number(citation.paper_records || 0)} ·
                页码/章节原文证据 {Number(citation.page_or_section_quoted_evidence || 0)} · 元数据标题不计为全文证据
              </p>
            </div>
            <Badge status={citation.quoted_evidence_requirement_satisfied ? 'ready' : 'evidence-required'} />
          </div>
          <div className="data-row">
            <div>
              <h3>人工审批</h3>
              <p>
                高成本操作 {enforcement.approval?.high_cost_actions ? '强制' : '未配置'} ·
                对外操作 {enforcement.approval?.external_actions ? '强制' : '未配置'}
              </p>
            </div>
            <Badge status="enforced" />
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHeading title="生效策略" />
        {project.policies?.length ? (
          <div className="data-list">
            {project.policies.map(policy => (
              <div className="data-row" key={policy.id}>
                <div>
                  <h3>{policy.rule}</h3>
                  <p>
                    {(policy.enforced_requirements || []).join(' · ') || '未识别为可执行约束；保留为人工规则'} ·
                    {policy.rationale || '项目级持久策略'}
                  </p>
                </div>
                <Badge status={policy.recognized ? 'enforced' : 'manual'} />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">尚未配置项目策略。</div>
        )}
      </div>
    </>
  )
}
