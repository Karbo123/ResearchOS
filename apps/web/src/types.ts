export type TierId = 'simple' | 'medium' | 'complex'

export type ReasoningEffort = 'low' | 'medium' | 'high'

export type VoiceProvider = 'browser' | 'api' | 'groq'

export type ResearchArea = 'overview' | 'related_work' | 'implementation' | 'paper'

export type TabId =
  | 'overview'
  | 'idea'
  | 'approvals'
  | 'reports'
  | 'literature'
  | 'visualization'
  | 'seed_expansion'
  | 'method'
  | 'reproduction'
  | 'introduction'
  | 'paper_related_work'
  | 'paper_method'
  | 'paper_experiments'
  | 'conclusion'

export type ProjectStateAction = 'pause' | 'resume' | 'cancel'

export interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
}

export interface ProjectSummary {
  id: string
  slug: string
  title: string
  status?: string
  pinned?: boolean
  sidebar_order?: number
  current_idea_version?: number
  current_stage?: string
  created_at?: string
  updated_at?: string
  experiment_total?: number
  experiment_running?: number
  experiment_completed?: number
  pending_approvals?: number
  paper_count?: number
  related_work_count?: number
  paper_draft_count?: number
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
  available_data?: string
  ethics_and_compliance?: string
  constraints?: Record<string, unknown>
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
    url?: 'runtime_override' | 'env_default' | 'project_override'
    key?: 'runtime_override' | 'env_default' | 'project_override'
  }
}

export interface ProxySettings {
  enabled: boolean
  url: string
}

export interface ModelSettingsResponse {
  tiers: Record<TierId, ModelTierSettings>
  proxy?: ProxySettings
  project_id?: string
}

export interface DocumentModelSettings {
  model: string
  url: string
  key_configured: boolean
  source?: 'runtime_override' | 'env_default' | 'project_override'
}

export interface VisionModelSettings {
  model: string
  url: string
  key_configured: boolean
  source?: 'runtime_override' | 'env_default' | 'project_override'
}

export type ImageGenerationResolution = '1k' | '2k' | '4k'
export type ImageGenerationQuality = 'low' | 'medium' | 'high'

export interface ImageGenerationSettings {
  model: string
  url: string
  key_configured: boolean
  resolution: ImageGenerationResolution
  quality: ImageGenerationQuality
  source?: 'runtime_override' | 'env_default' | 'project_override'
}

export type ModelTestKind = 'simple' | 'medium' | 'complex' | 'document' | 'vision' | 'image' | 'voice'

export interface VoiceSettingsResponse {
  provider: VoiceProvider
  model: string
  url: string
  key_configured: boolean
  source?: 'runtime_override' | 'env_default' | 'project_override'
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
  instance?: ProjectEmbeddingInstanceStatus
}

export interface ProjectEmbeddingInstanceStatus {
  mode: 'global' | 'custom'
  port: number | null
  running: boolean
  shared_projects: number
}

export interface ProjectEmbeddingSettingsResponse {
  project_id: string
  mode: 'global' | 'custom'
  provider: 'local' | 'openai'
  model: string
  dimensions: number
  base_url: string
  env_base_url: string
  key_configured: boolean
  source: string
  instance: ProjectEmbeddingInstanceStatus
}

export interface ModelSettingsFormValues {
  model: string
  url: string
  key: string
  reasoning_effort: ReasoningEffort
}

export interface ModelCatalogResponse {
  models: string[]
  reasoning_efforts: string[]
}

export interface ProjectDetail {
  id: string
  slug?: string
  title: string
  status: string
  current_stage?: string
  current_idea_version?: number
  created_at?: string
  updated_at?: string
  sidebar_order?: number
  session_id?: string | null
  spec?: ResearchSpec | null
  spec_field_status?: SpecFieldStatus
  idea_versions?: IdeaVersion[]
  papers?: Paper[]
  evidence?: Evidence[]
  repositories?: Repository[]
  reproductions?: Reproduction[]
  reproduction_runs?: ReproductionRun[]
  proposals?: Proposal[]
  experiments?: Experiment[]
  artifacts?: Artifact[]
  policies?: Policy[]
  reports?: Report[]
  feedback?: HumanFeedback[]
  tasks?: ProjectTask[]
  checkpoints?: Checkpoint[]
  claim_reviews?: ClaimReview[]
  related_work_seeds?: RelatedWorkSeed[]
  related_work_candidates?: RelatedWorkCandidate[]
  related_work_runs?: RelatedWorkRun[]
  related_work_attempts?: RelatedWorkAttempt[]
  related_work_edges?: RelatedWorkEdge[]
  related_work_field_provenance?: RelatedWorkFieldProvenance[]
  related_work_candidate_reviews?: RelatedWorkCandidateReview[]
  related_work_run_events?: RelatedWorkRunEvent[]
  research_comparisons?: ResearchComparison[]
  audit_events?: AuditEvent[]
  counts?: {
    papers?: number
    experiments?: number
    artifacts?: number
  }
  policy_enforcement?: PolicyEnforcement
  lineage?: {
    stale_edges?: number
    invalidated_edges?: number
  }
}

export interface WorkflowGraphStep {
  id: string
  canSuspend?: boolean
  mapConfig?: string
  component?: string
  serializedStepFlow?: WorkflowGraphEntry[]
}

export interface WorkflowGraphEntry {
  type: 'step' | 'conditional' | 'parallel' | 'map'
  step?: WorkflowGraphStep
  steps?: WorkflowGraphEntry[]
  serializedConditions?: Array<{ id: string; fn?: string }>
}

export interface WorkflowGraphResponse {
  project_id: string
  version: number
  source_hash: string
  status: 'active' | 'missing' | 'error'
  last_error: string | null
  graph: WorkflowGraphEntry[]
  step_ids: string[]
}

export interface WorkflowRunRecord {
  mastra_run_id: string
  project_id: string
  workflow_version: number
  source_hash: string
  status: 'running' | 'suspended' | 'success' | 'failed'
  created_at: string
}

export type WorkflowRuntimeStatus = 'waiting' | 'dispatching' | 'blocked' | 'failed' | 'paused'
export type WorkflowNodeRunStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'blocked' | 'cancelled'
export type WorkflowTaskStatus = 'queued' | 'retrying' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type WorkflowConcurrency = 'thread-serial' | 'project-serial' | 'parallel'
export type WorkflowEdgeCondition = 'always' | 'success'
export type WorkflowTriggerMode = 'root' | 'follow'

export interface WorkflowGraphGroup {
  id: string
  label_key: string
  description_key?: string
}

export interface WorkflowGraphNode {
  id: string
  group: string
  capability: string
  label_key: string
  description_key?: string
  requires: string[]
  retry: { max_attempts: number; backoff_seconds: number } | 'explicit'
  timeout_seconds: number
  concurrency: WorkflowConcurrency
}

export interface WorkflowGraphEdge {
  from: string
  to: string
  condition: WorkflowEdgeCondition
}

export interface WorkflowGraphTrigger {
  event_type: string
  node_id: string
  mode: WorkflowTriggerMode
}

export interface WorkflowRuntimeSnapshot {
  status: WorkflowRuntimeStatus
  state_version: number
  event_cursor: number
  coordinator_lease_token: string | null
  lease_until: string | null
  updated_at: string
}

export interface WorkflowNodeRun {
  id: string
  node_id: string
  correlation_id: string
  status: WorkflowNodeRunStatus
  attempt: number
  error_code: string | null
  blocked_reason: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
  input_ref: Record<string, unknown> | null
  output_ref: Record<string, unknown> | null
  task_id: string | null
  definition_version: number
}

export interface WorkflowTaskRun {
  id: string
  node_id: string | null
  status: WorkflowTaskStatus
  attempts: number
  error: string | null
  worker_id: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowEventRun {
  sequence: number
  event_type: string
  correlation_id: string
  source: string
  definition_version: number
  created_at: string
}

export interface WorkflowGraphSnapshot {
  project_id: string
  definition_version: number
  source_hash: string
  git_commit: string | null
  status: WorkflowRuntimeStatus
  last_error: string | null
  groups: WorkflowGraphGroup[]
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  triggers: WorkflowGraphTrigger[]
  runtime: WorkflowRuntimeSnapshot
  node_runs: WorkflowNodeRun[]
  tasks: WorkflowTaskRun[]
  events: WorkflowEventRun[]
}

export interface IdeaVersion {
  id: string
  project_id: string
  version: number
  spec: ResearchSpec
  change_reason?: string | null
  supersedes_id?: string | null
  created_at?: string
}

export interface SpecFieldStatusEntry {
  status: 'user_confirmed' | 'model_candidate' | 'unresolved'
  source: 'user_revision' | 'project_spec' | 'model_draft'
  version: number
  confirmed_at?: string | null
  changed_from_version?: number | null
  change_reason?: string | null
}

export type SpecFieldStatus = Record<string, SpecFieldStatusEntry>

export interface ProjectTask {
  id: string
  project_id: string
  kind: string
  status: string
  attempts?: number
  max_attempts?: number
  error?: string | null
  payload?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface RelatedWorkSeed {
  id: string
  source_type: 'doi' | 'title' | 'url' | 'bibtex' | 'artifact_pdf' | 'existing_paper'
  input_summary: string
  normalized_doi?: string | null
  normalized_title?: string | null
  year?: number | null
  artifact_id?: string | null
  paper_id?: string | null
  status: string
  created_by?: string
  created_at?: string
  resolved_at?: string | null
}

export interface RelatedWorkCandidate {
  id: string
  provider: string
  stable_id: string
  title: string
  match_methods?: string[]
  year?: number | null
  normalized_doi?: string | null
  paper_id?: string | null
  status: string
  discovery_depth?: number
  source_count?: number
  candidate?: Record<string, unknown>
  updated_at?: string
}

export interface RelatedWorkFieldProvenance {
  id: string
  project_id: string
  candidate_id: string
  field_name: string
  provider?: string | null
  source_type?: 'provider' | 'user_input' | 'controlled_artifact' | string
  stable_id?: string | null
  source_attempt_id?: string | null
  artifact_id?: string | null
  retrieved_at?: string
  locator?: string | null
  raw_value_hash?: string
  normalized_value?: unknown
  status?: string
  conflict_group?: string | null
  created_at?: string
}

export interface RelatedWorkCandidateReview {
  id: string
  project_id: string
  candidate_id: string
  decision: 'approved' | 'rejected' | 'reopened'
  reason: string
  actor?: string
  created_at?: string
}

export interface RelatedWorkRunEvent {
  id: string
  project_id: string
  run_id: string
  event_type: 'started' | 'progress' | 'finished' | 'failed' | 'cancel_requested' | 'edge_skipped_missing_node' | string
  level?: number | null
  payload?: Record<string, unknown>
  created_at?: string
}

export interface ProjectWorkspaceDetail {
  project_id: string
  root_relative_path: string
  code_relative_path: string
  code_directory_exists: boolean
  source_commit?: string | null
  branch?: string | null
  head?: string | null
  dirty?: boolean
  status?: string | null
  diff?: string
  diff_truncated?: boolean
  files?: Array<{ path: string; kind: 'file' | 'directory'; size_bytes: number }>
  dependency_manifests?: Array<{ path: string; kind: 'file' | 'directory'; size_bytes: number }>
  limits?: { max_files: number; max_diff_chars: number }
}

export type PaperSectionId = 'introduction' | 'paper_related_work' | 'paper_method' | 'paper_experiments' | 'conclusion'

export interface PaperSentence {
  en: string
  zh: string | null
}

export interface PaperSectionWorkspace {
  id: PaperSectionId
  heading: string
  source: string
  english: string
  citations: string[]
  figure_refs: string[]
  sentences: PaperSentence[]
  status: 'missing' | 'draft' | 'ready'
}

export interface PaperBibEntry {
  key: string
  title: string
  authors: string
  year: string
  venue: string
}

export interface PaperWorkspaceDetail {
  project_id: string
  source_path: string
  has_source: boolean
  has_references: boolean
  source_commit: string | null
  source_dirty: boolean
  sections: PaperSectionWorkspace[]
  references: PaperBibEntry[]
  compile_runs: number
  compile_succeeded: number
  compile_latest_status: string | null
  compile_latest_error: string | null
}

export interface RelatedWorkRun {
  id: string
  proposal_id: string
  seed_ids: string[]
  providers: string[]
  depth: number
  width: number
  max_total: number
  status: string
  cancel_requested?: boolean
  discovered_count?: number
  edge_count?: number
  failure_count?: number
  error?: string | null
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
}

export interface RelatedWorkAttempt {
  id?: string
  seed_id?: string | null
  run_id?: string | null
  parent_candidate_id?: string | null
  provider: string
  query: string
  request_url?: string
  status: string
  http_status?: number | null
  result_count?: number
  failure?: { code?: string; message?: string; retryable?: boolean } | null
  started_at?: string
  finished_at?: string
}

export interface RelatedWorkEdge {
  id?: string
  run_id?: string | null
  source_candidate_id: string
  target_candidate_id: string
  source_title?: string
  target_title?: string
  provider: string
  relation: string
  ranking_score?: number | null
  ranking_reasons?: string[]
  discovery_depth?: number
}

export interface Evidence {
  id: string
  paper_id?: string | null
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
  authors?: Array<{ name: string; orcid?: string | null; affiliations?: string[] } | string>
  institutions?: string[]
  citation_count?: number | null
  html_url?: string | null
  project_homepage?: string | null
  source_provider?: string
  source_url?: string
  doi?: string | null
  pdf_url?: string | null
  confirmed?: boolean
  verified?: boolean
  fulltext_evidence_count?: number
  code_repositories?: Repository[]
  bibtex?: string
  confirmed_field_snapshot?: Array<{
    field_name: string
    provider?: string | null
    source_type?: string
    stable_id?: string | null
    source_attempt_id?: string | null
    artifact_id?: string | null
    retrieved_at?: string
    locator?: string | null
    raw_value_hash?: string
    normalized_value?: unknown
    status?: string
  }>
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

export interface Reproduction {
  id: string
  project_id: string
  repository_id: string
  status: string
  source_commit: string
  repository_relative_path: string
  dependency_manifest: string
  dependency_sha256: string
  venv_relative_path: string
  entrypoint?: string | null
  plan?: Record<string, any>
  dependency_report?: Record<string, any>
  error?: string | null
  created_at?: string
  updated_at?: string
}

export interface ReproductionRun {
  id: string
  project_id: string
  reproduction_id: string
  proposal_id: string
  status: string
  source_commit: string
  entrypoint: string
  random_seeds: number[]
  config?: Record<string, any>
  run_relative_path: string
  output_manifest?: Array<{ path: string; sha256: string; size_bytes: number; mime_type: string }>
  metrics?: Record<string, any>
  artifact_proposal_id?: string | null
  artifact_ids?: string[]
  error?: string | null
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
}

export interface ResearchComparisonMetric {
  status: 'comparable' | 'partial' | 'blocked' | string
  paper_value?: number | null
  reproduction_mean?: number | null
  reproduction_population_std?: number | null
  reproduction_count?: number | null
  reproduction_min?: number | null
  reproduction_max?: number | null
  delta?: number | null
  relative_delta?: number | null
  direction?: string
  signal?: string
  evidence_ids?: string[]
  definition?: { paper?: string | null; reproduction?: string | null; status?: string }
  per_seed?: Record<string, number | null>
  reason?: string
}

export interface ResearchComparisonCandidate {
  id: string
  project_id: string
  comparison_id: string
  candidate_type: string
  statement: string
  basis?: Record<string, unknown>
  evidence_status: string
  status: string
  actor?: string
  decision_comment?: string | null
  created_at?: string
  decided_at?: string | null
}

export interface ResearchComparison {
  id: string
  project_id: string
  paper_id: string
  reproduction_run_id: string
  status: string
  reason?: string
  input_hash?: string
  paper_context?: Record<string, unknown>
  reproduction_context?: Record<string, unknown>
  metric_comparisons?: Record<string, ResearchComparisonMetric>
  blocking_reasons?: string[]
  source_snapshot?: Record<string, unknown>
  created_by?: string
  created_at?: string
  candidates?: ResearchComparisonCandidate[]
}

export interface RepositoryDiscovery {
  canonical_url: string
  source_type: 'paper_metadata' | 'paper_source_url'
  locator: string
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
  created_at?: string
  decided_at?: string | null
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
  created_at?: string
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
  status?: 'valid' | 'blocked' | 'legacy_unverified' | 'failed' | string
  blocking_reason?: string | null
  missing_source_ids?: string[]
  source_snapshot?: Record<string, unknown>
  created_at?: string
}

export interface HumanFeedback {
  id: string
  project_id: string
  session_id?: string | null
  reference_id?: string | null
  category: 'idea' | 'report' | 'experiment' | 'memory' | 'general' | string
  instruction: string
  status: 'open' | 'acknowledged' | 'rejected' | 'revision_requested' | 'proposal_created' | string
  decided_by?: string | null
  decision_comment?: string | null
  created_at?: string
  decided_at?: string | null
}

export interface AuditEvent {
  id: string
  project_id?: string | null
  actor: string
  action: string
  details?: Record<string, unknown>
  created_at?: string
}

export interface Checkpoint {
  id: string
  stage: string
  idea_version?: number
  state?: Record<string, any>
  valid?: boolean
  created_at?: string
  invalidated_at?: string | null
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

export type ResearchStatusCodeAvailability = 'official_repository' | 'partial' | 'not_found' | 'unresolved'

export interface ResearchStatusMatrixRow {
  id: string
  project_id: string
  matrix_id: string
  paper_id: string
  theme: string | null
  method: string | null
  year: number | null
  datasets: string[]
  metrics: string[]
  limitations: string | null
  code_availability: ResearchStatusCodeAvailability
  evidence_ids: string[]
  claim_review_ids: string[]
  evidence_status: string
  provenance: Record<string, unknown>
  paper: {
    id: string
    title: string
    doi: string | null
    source_url: string
    confirmed: boolean
    verified: boolean
  } | null
  created_at: string
  updated_at: string
}

export interface ResearchStatusMatrix {
  id: string
  project_id: string
  idea_version: number
  status: string
  created_by: string
  created_at: string
  updated_at: string
  rows: ResearchStatusMatrixRow[]
}

export interface ResearchStatusGraphNode {
  id: string
  kind: 'candidate' | 'paper' | 'evidence' | 'claim_review'
  label: string
  status: string
  citation_count?: number | null
  source: {
    source_type: string
    source_id: string
    provider?: string
    stable_id?: string
    url?: string
    locator?: string | null
  }
  permission_status: 'project_scoped'
  evidence_status: 'metadata_only' | 'page_quote' | 'claim_reviewed'
}

export interface ResearchStatusGraphEdge {
  id: string
  source: string
  target: string
  relation: 'references' | 'has_evidence' | 'uses_evidence'
  source_type: string
  source_id: string
  permission_status: 'project_scoped'
  evidence_status: 'metadata_only' | 'page_quote' | 'claim_reviewed'
}

export type ResearchStatusCandidateType =
  | 'gap'
  | 'cluster'
  | 'duplicate_risk'
  | 'innovation'
  | 'boundary'
  | 'counterexample'
  | 'open_question'

export interface ResearchStatusCandidateBasisPaper {
  id: string
  title: string
  doi: string | null
  source_url: string
}

export interface ResearchStatusCandidateBasisEvidence {
  id: string
  paper_id: string | null
  claim: string
  locator: string | null
  source_url: string
}

export interface ResearchStatusCandidateBasisReview {
  id: string
  claim: string
  evidence_ids: string[]
}

export interface ResearchStatusCandidateBasis {
  idea_version: number
  papers: ResearchStatusCandidateBasisPaper[]
  evidence: ResearchStatusCandidateBasisEvidence[]
  claim_reviews: ResearchStatusCandidateBasisReview[]
}

export interface ResearchStatusGapCandidate {
  id: string
  project_id: string
  matrix_id: string
  candidate_type: ResearchStatusCandidateType
  statement: string
  row_ids: string[]
  paper_ids: string[]
  evidence_ids: string[]
  claim_review_ids: string[]
  idea_version: number
  basis: ResearchStatusCandidateBasis
  evidence_status: string
  status: 'candidate' | 'accepted' | 'rejected' | string
  actor: string
  decision_comment: string | null
  created_at: string
  decided_at: string | null
}

export interface ResearchStatusResponse {
  project_id: string
  permission_status: 'project_scoped'
  status: 'ready' | 'empty' | string
  matrix_status: 'ready' | 'empty' | string
  graph_status: 'ready' | 'empty' | string
  matrix: ResearchStatusMatrix | null
  matrices: Array<{ id: string; idea_version: number; status: string; created_by: string; created_at: string; updated_at: string }>
  gap_candidates: ResearchStatusGapCandidate[]
  graph: {
    project_id: string
    permission_status: 'project_scoped'
    nodes: ResearchStatusGraphNode[]
    edges: ResearchStatusGraphEdge[]
  }
  limitations: string[]
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
