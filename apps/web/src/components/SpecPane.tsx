import { Check } from 'lucide-react'
import type { ResearchSpec } from '../types'
import { useTranslation } from '../i18n'

function FieldList({ label, values }: { label: string; values?: string[] }) {
  const { t } = useTranslation()
  return (
    <div className="spec-group">
      <label>{label}</label>
      {values && values.length ? (
        <ul>
          {values.map((value, index) => <li key={index}>{value}</li>)}
        </ul>
      ) : (
        <div>{t('spec.unset')}</div>
      )}
    </div>
  )
}

function FieldText({ label, value }: { label: string; value?: string }) {
  const { t } = useTranslation()
  return (
    <div className="spec-group">
      <label>{label}</label>
      <div>{value || t('spec.unset')}</div>
    </div>
  )
}

export function SpecPane({
  spec,
  status,
  projectSlug,
  onProjectSlugChange,
  onConfirm,
}: {
  spec: ResearchSpec | null
  status: string
  projectSlug: string
  onProjectSlugChange: (value: string) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const idea = spec?.idea
  const statusLabel = status === 'pending_clarification' ? t('common.pendingClarify') : status === 'pending_confirmation' ? t('common.pendingConfirm') : status
  return (
    <div className="spec-pane-content">
      <div className="pane-heading">
        <h2>{t('spec.title')}</h2>
        <span className={`badge ${status === 'pending_confirmation' ? 'pending' : 'neutral'}`}>{statusLabel}</span>
      </div>
      {spec && idea ? (
        <>
          <FieldText label={t('spec.titleField')} value={idea.title} />
          <FieldText label={t('spec.researchQuestion')} value={idea.research_question} />
          <FieldText label={t('spec.domain')} value={idea.domain} />
          <FieldList label={t('spec.hypotheses')} values={idea.hypotheses} />
          <FieldList label={t('spec.contributions')} values={idea.expected_contributions} />
          <FieldList label={t('spec.successCriteria')} values={idea.success_criteria} />
          <FieldList label={t('spec.targetVenues')} values={idea.target_venues} />
          <FieldList label={t('spec.risks')} values={idea.risks} />
          <FieldList label={t('spec.openQuestions')} values={idea.open_questions} />
          <FieldText label={t('spec.feasibility')} value={spec.feasibility} />
          <FieldList label={t('spec.feasibilityNotes')} values={spec.feasibility_notes} />
          <FieldList label={t('spec.candidateModifications')} values={spec.candidate_modifications} />
          <FieldList label={t('spec.approvals')} values={spec.required_approvals} />
          <div className="spec-group">
            <label htmlFor="projectSlug">{t('spec.projectSlug')}</label>
            <input
              id="projectSlug"
              value={projectSlug}
              maxLength={120}
              placeholder={t('spec.projectSlugPlaceholder')}
              aria-describedby="projectSlugHint"
              onChange={event => onProjectSlugChange(event.target.value)}
            />
            <small id="projectSlugHint">{t('spec.projectSlugHint')}</small>
          </div>
          <button className="primary full" type="button" onClick={onConfirm}>
            <Check size={17} />
            {t('spec.confirmCreate')}
          </button>
        </>
      ) : (
        <div className="spec-empty">{t('spec.empty')}</div>
      )}
    </div>
  )
}
