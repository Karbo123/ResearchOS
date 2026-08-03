import { ApiError } from './http.js'

export const SPEC_FIELDS = [
  'title',
  'research_question',
  'domain',
  'keywords',
  'hypotheses',
  'expected_contributions',
  'success_criteria',
  'target_venues',
  'available_data',
  'constraints',
  'risks',
  'open_questions',
  'ethics_and_compliance',
  'feasibility',
  'feasibility_notes',
  'required_approvals',
  'candidate_modifications',
] as const

export const CORE_SPEC_FIELDS = ['research_question', 'domain', 'available_data', 'ethics_and_compliance'] as const

export type SpecFieldName = (typeof SPEC_FIELDS)[number]
export type SpecFieldStatusKind = 'user_confirmed' | 'model_candidate' | 'unresolved'
export type SpecFieldSource = 'user_revision' | 'project_spec' | 'model_draft'

export type IdeaVersionLike = {
  version?: unknown
  spec?: Record<string, unknown> | null
  change_reason?: unknown
  created_at?: unknown
}

export type SpecFieldStatusEntry = {
  status: SpecFieldStatusKind
  source: SpecFieldSource
  version: number
  confirmed_at?: string | null
  changed_from_version?: number | null
  change_reason?: string | null
}

export type SpecFieldStatus = Record<string, SpecFieldStatusEntry>

function specIdea(spec: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return (spec?.idea && typeof spec.idea === 'object' ? spec.idea : {}) as Record<string, unknown>
}

function specFieldValue(spec: Record<string, unknown> | null | undefined, field: string): unknown {
  if (!spec) return undefined
  const idea = specIdea(spec)
  if (field in idea) return idea[field]
  return spec[field]
}

function hasValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(item => typeof item === 'string' && item.trim().length > 0)
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function revisedField(version: IdeaVersionLike): string | null {
  const reason = typeof version.change_reason === 'string' ? version.change_reason : ''
  const match = reason.match(/^Approved revision of\s+([A-Za-z0-9_]+)$/)
  if (match) return match[1]!
  return null
}

function fieldRevisionMap(versions: IdeaVersionLike[]): Map<string, SpecFieldStatusEntry> {
  const ordered = [...versions].sort((left, right) => (Number(left.version) || 0) - (Number(right.version) || 0))
  const map = new Map<string, SpecFieldStatusEntry>()
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index]!
    const previous = ordered[index - 1]!
    const currentVersion = Number(current.version) || 0
    const previousVersion = Number(previous.version) || 0
    const parsed = revisedField(current)
    if (parsed) {
      map.set(parsed, {
        status: 'user_confirmed',
        source: 'user_revision',
        version: currentVersion,
        confirmed_at: typeof current.created_at === 'string' ? current.created_at : null,
        changed_from_version: previousVersion,
        change_reason: typeof current.change_reason === 'string' ? current.change_reason : null,
      })
      continue
    }
    const currentIdea = specIdea(current.spec)
    const previousIdea = specIdea(previous.spec)
    for (const field of SPEC_FIELDS) {
      if (hasValue(specFieldValue(previous.spec, field)) && JSON.stringify(specFieldValue(previous.spec, field)) !== JSON.stringify(specFieldValue(current.spec, field))) {
        map.set(field, {
          status: 'user_confirmed',
          source: 'user_revision',
          version: currentVersion,
          confirmed_at: typeof current.created_at === 'string' ? current.created_at : null,
          changed_from_version: previousVersion,
          change_reason: typeof current.change_reason === 'string' ? current.change_reason : null,
        })
      }
    }
  }
  return map
}

export function specFieldStatus(spec: Record<string, unknown> | null | undefined, versions: IdeaVersionLike[]): SpecFieldStatus {
  const idea = specIdea(spec)
  const ordered = [...versions].sort((left, right) => (Number(left.version) || 0) - (Number(right.version) || 0))
  const first = ordered[0]
  const firstIdea = specIdea(first?.spec)
  const firstVersion = Number(first?.version) || 1
  const userProvidedInitialSpec = SPEC_FIELDS.some(field => field !== 'title' && hasValue(specFieldValue(first?.spec, field)))
  const revisions = fieldRevisionMap(ordered)
  const entries: SpecFieldStatus = {}
  for (const field of SPEC_FIELDS) {
    const value = specFieldValue(spec, field)
    const revision = revisions.get(field)
    if (!hasValue(value)) {
      entries[field] = { status: 'unresolved', source: 'model_draft', version: firstVersion, confirmed_at: null, changed_from_version: null, change_reason: null }
      continue
    }
    if (revision) {
      entries[field] = revision
      continue
    }
    if (userProvidedInitialSpec && hasValue(specFieldValue(first?.spec, field))) {
      entries[field] = {
        status: 'user_confirmed',
        source: 'project_spec',
        version: firstVersion,
        confirmed_at: typeof first?.created_at === 'string' ? first.created_at : null,
        changed_from_version: null,
        change_reason: null,
      }
      continue
    }
    entries[field] = {
      status: 'model_candidate',
      source: 'model_draft',
      version: Number(ordered.find(version => hasValue(specFieldValue(version.spec, field)))?.version) || firstVersion,
      confirmed_at: null,
      changed_from_version: null,
      change_reason: null,
    }
  }
  return entries
}

export function unconfirmedCoreFields(status: SpecFieldStatus): string[] {
  return CORE_SPEC_FIELDS.filter(field => status[field]?.status !== 'user_confirmed')
}

export function requireConfirmedSpecFields(projectId: string, spec: Record<string, unknown> | null | undefined, versions: IdeaVersionLike[]) {
  const status = specFieldStatus(spec, versions)
  const blocked = unconfirmedCoreFields(status)
  if (blocked.length) {
    throw new ApiError(409, 'spec_field_unconfirmed', `以下核心规格字段尚未由用户确认，无法执行下游动作：${blocked.join('、')}。请在项目对话中确认这些字段。`, { project_id: projectId, blocked_fields: blocked })
  }
  return status
}
