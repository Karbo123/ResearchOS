export type TierId = 'simple' | 'medium' | 'complex'

export type ReasoningEffort = 'low' | 'medium' | 'high'

export type TabId =
  | 'overview'
  | 'literature'
  | 'experiments'
  | 'artifacts'
  | 'approvals'
  | 'policies'
  | 'reports'

export type ProjectStateAction = 'pause' | 'resume' | 'cancel'

export interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
}

export interface ProjectSummary {
  id: string
  title: string
  status?: string
}

export interface IdeaSpec {
  title?: string
  research_question?: string
  domain?: string
  keywords?: string[]
  hypotheses?: string[]
  expected_contributions?: string[]
  success_criteria?: string[]
  target_venues?: string[]
  risks?: string[]
  open_questions?: string[]
}

export interface ResearchSpec {
  idea: IdeaSpec
  feasibility?: string
  feasibility_notes?: string[]
  required_approvals?: string[]
  candidate_modifications?: string[]
  policies?: unknown[]
}

export interface ModelTierSettings {
  model?: string
  url?: string
  key_configured?: boolean
  reasoning_effort?: ReasoningEffort
  sources?: {
    url?: 'runtime_override' | 'env_default'
    key?: 'runtime_override' | 'env_default'
  }
}

export interface ModelSettingsResponse {
  tiers: Record<TierId, ModelTierSettings>
}

export interface SupermemoryEmbeddingStatus {
  provider: string
  model: string
  dimensions: number
  base_url: string | null
  key_configured: boolean
  remote_embedding_supported: boolean
  current_build_behavior: string
}

export interface MemoryStatusResponse {
  enabled: boolean
  key_configured: boolean
  auth_mode: 'explicit_key' | 'localhost_auto_auth' | 'required'
  base_url: string
  scope: string
  embedding?: SupermemoryEmbeddingStatus
}

export interface ModelSettingsFormValues {
  model: string
  url: string
  key: string
  reasoning_effort: ReasoningEffort
}

export interface ProjectDetail {
  id: string
  slug?: string
  title: string
  status: string
  current_stage?: string
  current_idea_version?: number
  session_id?: string | null
  spec?: ResearchSpec | null
  papers?: Paper[]
  evidence?: Evidence[]
  repositories?: Repository[]
  proposals?: Proposal[]
  experiments?: Experiment[]
  artifacts?: Artifact[]
  policies?: Policy[]
  reports?: Report[]
  checkpoints?: Checkpoint[]
  claim_reviews?: ClaimReview[]
  counts?: {
    papers?: number
    experiments?: number
    artifacts?: number
  }
  policy_enforcement?: PolicyEnforcement
}

export interface Evidence {
  id: string
  claim?: string
  quote?: string
  locator?: string | null
  source_url?: string
  metadata?: Record<string, unknown>
}

export interface ClaimReview {
  id: string
  claim: string
  evidence_ids: string[]
  status: 'pending' | 'accepted' | 'rejected'
  reviewer?: string | null
  decision_comment?: string | null
  evidence_status: 'page_quote_requires_claim_review'
  created_at?: string
  decided_at?: string | null
}

export interface Paper {
  id: string
  title: string
  year?: number | null
  venue?: string
  source_provider?: string
  source_url?: string
  doi?: string | null
  pdf_url?: string | null
  verified?: boolean
  fulltext_evidence_count?: number
  code_repositories?: Repository[]
  bibtex?: string
}

export interface Repository {
  id: string
  paper_id?: string | null
  source_url: string
  license_spdx?: string | null
  commit_or_tag?: string | null
  verified_official?: boolean
  metadata?: Record<string, any>
  retrieved_at?: string
}

export interface Proposal {
  id: string
  kind: string
  status: string
  summary: string
  reason?: string
  diff?: string
  impact?: Record<string, any>
  payload?: Record<string, any>
  estimated_cost_usd?: number
}

export interface Experiment {
  id: string
  experiment_type: string
  status: string
  proposal_id?: string
  config?: Record<string, unknown>
  metrics?: Record<string, number>
  run_id?: string
  error?: string | null
  created_at?: string
  finished_at?: string | null
}

export interface Artifact {
  id: string
  name: string
  kind?: string
  experiment_id?: string | null
  mime_type?: string
  sha256?: string
  metadata?: Record<string, unknown>
  valid?: boolean
  experiment_status?: string | null
  run_id?: string | null
  experiment_finished_at?: string | null
  preview_url?: string
  download_url?: string
  url?: string
}

export interface Policy {
  id: string
  rule: string
  enforced_requirements?: string[]
  rationale?: string
  recognized?: boolean
}

export interface Report {
  id: string
  period: string
  content: string
  created_at?: string
}

export interface Checkpoint {
  id: string
  stage: string
  idea_version?: number
  state?: Record<string, any>
}

export interface PolicyEnforcement {
  status?: string
  runner_compatible?: boolean | null
  minimum_random_seed_count?: number
  citation_readiness?: {
    records_with_doi_or_source_url?: number
    paper_records?: number
    page_or_section_quoted_evidence?: number
    quoted_evidence_requirement_satisfied?: boolean
  }
  approval?: {
    high_cost_actions?: boolean
    external_actions?: boolean
  }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  meta?: string
}

export interface ThinkingStage {
  key: 'analyzing_input' | 'selecting_route' | 'calling_llm' | 'parsing'
  label: string
  detail: string
  state: 'pending' | 'active' | 'done'
}

export interface ThinkingSession {
  id: string
  time: string
  modelLabel: string
  status: 'running' | 'done' | 'failed'
  collapsed: boolean
  stages: ThinkingStage[]
}

export interface SearchCandidate {
  url?: string
  name?: string
  title?: string
  snippet?: string
  resource_type?: string
  provider?: string
  compliance?: {
    robots_status?: string
    terms_url?: string
  }
}

export interface NoveltyAnalysis {
  assessment?: string
  summary?: string
  claim_gate?: string
  research_gap_candidates?: Array<Record<string, any>>
  duplicate_candidates?: Array<Record<string, any>>
}

export interface MaterialSearchResponse {
  total_matches?: number
  next_offset?: number | null
  results?: Array<{
    name?: string
    kind?: string
    parse_status?: string
    sha256?: string
    snippet?: string
    similarity?: number | null
    source_type?: string | null
    source_id?: string | null
    uploaded_file_id?: string | null
    locator?: string | null
  }>
}

export interface DiagnosticsReport {
  run_count?: number
  proposal_id?: string
  metrics?: Record<string, { count: number; mean: number; population_std?: number; std?: number; min: number; max: number }>
  failures?: Array<{ experiment_id: string; status: string; error_code: string }>
  suggestions?: Array<{ title: string; reason: string; evidence_experiment_ids?: string[] }>
}

export interface MemoryGraphNode {
  id: string
  label: string
  kind: string
  metadata?: Record<string, unknown>
}

export interface MemoryGraphEdge {
  id: string
  source: string
  target: string
  relation: string
}

export interface MemoryGraphResponse {
  project_id: string
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
}

export interface MemorySearchResult {
  id?: unknown
  memory?: unknown
  similarity?: unknown
  metadata?: Record<string, any>
  source_type?: string | null
  source_id?: string | null
  artifact_id?: string | null
  evidence_status?: string | null
}

export interface MemorySearchResponse {
  project_id: string
  query: string
  total: number
  results: MemorySearchResult[]
}

export type ArtifactPreview =
  | { type: 'image' }
  | {
      type: 'point_cloud'
      format: string
      points: number[][]
      source_point_count?: number
      sampled?: boolean
      faces?: number[][]
    }
  | {
      type: 'timeseries'
      points: Array<
        Record<string, number | string | undefined> & {
          step: number
          seed?: number | string | null
          loss?: number
          accuracy?: number
          validation_loss?: number
          validation_accuracy?: number
          learning_rate?: number
        }
      >
      point_count?: number
      sampled?: boolean
      seeds?: number[]
      units?: string[]
      experiment_status?: string | null
    }
  | { type: 'video'; download_url: string }
  | { type: 'json'; value: unknown }
  | { type: 'pdf'; page_count?: number; truncated?: boolean; text?: string }
  | { type: 'table'; format?: string; truncated?: boolean; rows: unknown[][] }
  | { type: 'html_text'; text?: string; truncated?: boolean }
  | { type: 'text'; text?: string; truncated?: boolean }
