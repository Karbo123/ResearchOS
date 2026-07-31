import { Check } from 'lucide-react'
import type { ResearchSpec } from '../types'

function FieldList({ label, values }: { label: string; values?: string[] }) {
  return (
    <div className="spec-group">
      <label>{label}</label>
      {values && values.length ? (
        <ul>
          {values.map((value, index) => <li key={index}>{value}</li>)}
        </ul>
      ) : (
        <div>未指定</div>
      )}
    </div>
  )
}

function FieldText({ label, value }: { label: string; value?: string }) {
  return (
    <div className="spec-group">
      <label>{label}</label>
      <div>{value || '未指定'}</div>
    </div>
  )
}

export function SpecPane({
  spec,
  status,
  onConfirm,
}: {
  spec: ResearchSpec | null
  status: string
  onConfirm: () => void
}) {
  const idea = spec?.idea
  return (
    <div className="spec-pane-content">
      <div className="pane-heading">
        <h2>ResearchIdea / ProjectSpec</h2>
        <span className={`badge ${status === '待确认' ? 'pending' : 'neutral'}`}>{status}</span>
      </div>
      {spec && idea ? (
        <>
          <FieldText label="Title" value={idea.title} />
          <FieldText label="Research question" value={idea.research_question} />
          <FieldText label="Domain" value={idea.domain} />
          <FieldList label="Hypotheses" values={idea.hypotheses} />
          <FieldList label="Contributions" values={idea.expected_contributions} />
          <FieldList label="Success criteria" values={idea.success_criteria} />
          <FieldList label="Target venues" values={idea.target_venues} />
          <FieldList label="Risks" values={idea.risks} />
          <FieldList label="Open questions" values={idea.open_questions} />
          <FieldText label="Feasibility" value={spec.feasibility} />
          <FieldList label="Feasibility notes" values={spec.feasibility_notes} />
          <FieldList label="Candidate modifications" values={spec.candidate_modifications} />
          <FieldList label="Approvals" values={spec.required_approvals} />
          <button className="primary full" type="button" onClick={onConfirm}>
            <Check size={17} />
            确认并创建项目
          </button>
        </>
      ) : (
        <div className="spec-empty">规格将在澄清完成后生成。</div>
      )}
    </div>
  )
}
