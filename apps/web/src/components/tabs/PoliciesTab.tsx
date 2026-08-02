import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, TabId } from '../../types'
import { Badge, ButtonRow, SectionHeading } from '../ui'
import { useTranslation } from '../../i18n'

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
  const { t } = useTranslation()
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
      showToast(t('policies.toast', { id: result.proposal_id.slice(0, 8) }))
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
          placeholder={t('policies.placeholder')}
          required
          onChange={event => setRule(event.target.value)}
        />
        <button className="primary" type="submit">
          <ShieldCheck size={16} />
          {t('policies.propose')}
        </button>
      </form>

      <div className="section">
        <SectionHeading title={t('policies.executionStatus')} extra={<Badge status={enforcement.status || 'unknown'} />} />
        <div className="data-list">
          <div className="data-row">
            <div>
              <h3>{t('policies.seedTitle')}</h3>
              <p>{t('policies.seedText', { count: Number(enforcement.minimum_random_seed_count || 1) })}</p>
            </div>
            <Badge status={enforcement.runner_compatible === false ? 'unsupported' : 'enforced'} />
          </div>
          <div className="data-row">
            <div>
              <h3>{t('policies.citationTitle')}</h3>
              <p>
                {t('policies.citationCount', { value: Number(citation.records_with_doi_or_source_url || 0), total: Number(citation.paper_records || 0) })} ·
                {t('policies.quotedCount', { count: Number(citation.page_or_section_quoted_evidence || 0) })} · {t('policies.metadataNotFulltext')}
              </p>
            </div>
            <Badge status={citation.quoted_evidence_requirement_satisfied ? 'ready' : 'evidence-required'} />
          </div>
          <div className="data-row">
            <div>
              <h3>{t('policies.approvalTitle')}</h3>
              <p>
                {t('policies.highCost')} {enforcement.approval?.high_cost_actions ? t('policies.forced') : t('policies.notConfigured')} ·
                {t('policies.externalActions')} {enforcement.approval?.external_actions ? t('policies.forced') : t('policies.notConfigured')}
              </p>
            </div>
            <Badge status="enforced" />
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHeading title={t('policies.activeTitle')} />
        {project.policies?.length ? (
          <div className="data-list">
            {project.policies.map(policy => (
              <div className="data-row" key={policy.id}>
                <div>
                  <h3>{policy.rule}</h3>
                  <p>
                    {(policy.enforced_requirements || []).join(' · ') || t('policies.notRecognized')} ·
                    {policy.rationale || t('policies.projectPolicy')}
                  </p>
                </div>
                <Badge status={policy.recognized ? 'enforced' : 'manual'} />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">{t('policies.empty')}</div>
        )}
      </div>
    </>
  )
}
