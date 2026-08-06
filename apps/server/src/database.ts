import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { runtimeRoot } from './paths.js'

export const database = new PGlite(resolve(runtimeRoot, 'research-os.pglite'))

const migrationSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS projects (id VARCHAR(120) PRIMARY KEY, slug VARCHAR(120) UNIQUE NOT NULL, title VARCHAR(240) NOT NULL, status VARCHAR(40) NOT NULL DEFAULT 'active', pinned BOOLEAN NOT NULL DEFAULT FALSE, sidebar_order INTEGER NOT NULL DEFAULT 0, current_idea_version INTEGER NOT NULL DEFAULT 1, current_stage VARCHAR(80) NOT NULL DEFAULT 'initialized', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sidebar_order INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS project_slug_aliases (slug VARCHAR(120) PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS ix_project_slug_aliases_project ON project_slug_aliases(project_id);
CREATE TABLE IF NOT EXISTS conversation_sessions (id UUID PRIMARY KEY, project_id VARCHAR(120) REFERENCES projects(id), phase VARCHAR(40) NOT NULL DEFAULT 'clarifying', draft JSONB NOT NULL DEFAULT '{}', pending_field VARCHAR(80), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS scope VARCHAR(120) NOT NULL DEFAULT 'project';
CREATE INDEX IF NOT EXISTS ix_conversation_sessions_project_scope ON conversation_sessions(project_id, scope);
CREATE TABLE IF NOT EXISTS messages (id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES conversation_sessions(id), role VARCHAR(20) NOT NULL, content TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS uploaded_files (id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES conversation_sessions(id), project_id VARCHAR(120) REFERENCES projects(id), name VARCHAR(255) NOT NULL, relative_path TEXT NOT NULL, mime_type VARCHAR(120) NOT NULL, size_bytes INTEGER NOT NULL, sha256 VARCHAR(64) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS idea_versions (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), version INTEGER NOT NULL, spec JSONB NOT NULL, change_reason TEXT, supersedes_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(project_id, version));
CREATE TABLE IF NOT EXISTS papers (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), title TEXT NOT NULL, doi VARCHAR(255), source_url TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', bibtex TEXT, verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE papers ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS evidence (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), paper_id UUID REFERENCES papers(id), claim TEXT NOT NULL, quote TEXT NOT NULL, locator VARCHAR(255), source_url TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS proposals (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), kind VARCHAR(60) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'pending', reason TEXT NOT NULL, summary TEXT NOT NULL, diff TEXT, impact JSONB NOT NULL DEFAULT '{}', estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0, payload JSONB NOT NULL DEFAULT '{}', decided_by VARCHAR(200), decision_comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS experiments (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), proposal_id UUID NOT NULL REFERENCES proposals(id), status VARCHAR(30) NOT NULL DEFAULT 'queued', experiment_type VARCHAR(80) NOT NULL, config JSONB NOT NULL DEFAULT '{}', metrics JSONB NOT NULL DEFAULT '{}', run_id VARCHAR(255), error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS artifacts (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), experiment_id UUID REFERENCES experiments(id), kind VARCHAR(80) NOT NULL, name VARCHAR(255) NOT NULL, relative_path TEXT NOT NULL, mime_type VARCHAR(120) NOT NULL, sha256 VARCHAR(64) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', valid BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS policies (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), rule TEXT NOT NULL, rationale TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS audit_events (id UUID PRIMARY KEY, project_id VARCHAR(120) REFERENCES projects(id), actor VARCHAR(200) NOT NULL, action VARCHAR(120) NOT NULL, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reports (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), period VARCHAR(20) NOT NULL, content TEXT NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'legacy_unverified', source_snapshot JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ix_reports_project_created ON reports(project_id,created_at);
CREATE TABLE IF NOT EXISTS tasks (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), kind VARCHAR(100) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'queued', payload JSONB NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, idempotency_key VARCHAR(255), next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), leased_until TIMESTAMPTZ, lease_token VARCHAR(64), error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_idempotency_key ON tasks (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tasks_queue_claim ON tasks (status, next_attempt_at, leased_until, created_at);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_definition_version INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_node_id VARCHAR(200);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_node_run_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_trigger_event_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_correlation_id VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS worker_id VARCHAR(64);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS heartbeat_until TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_concurrency VARCHAR(30);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_thread_key VARCHAR(255);
CREATE INDEX IF NOT EXISTS ix_tasks_workflow_node_run ON tasks(workflow_node_run_id) WHERE workflow_node_run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS workflow_definitions (
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source_sha256 VARCHAR(64) NOT NULL,
  git_commit VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  graph_json JSONB NOT NULL DEFAULT '{}',
  compiled_ref TEXT,
  validation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, version)
);
CREATE INDEX IF NOT EXISTS ix_workflow_definitions_project_status ON workflow_definitions(project_id,status,version);
CREATE TABLE IF NOT EXISTS project_workflow_runtime (
  project_id VARCHAR(120) PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  active_definition_version INTEGER NOT NULL DEFAULT 0,
  state_version INTEGER NOT NULL DEFAULT 0,
  event_cursor INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'waiting',
  coordinator_lease_token VARCHAR(64),
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workflow_events (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  source VARCHAR(200) NOT NULL,
  definition_version INTEGER NOT NULL,
  causation_id UUID,
  correlation_id VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (project_id, sequence),
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_workflow_events_project_sequence ON workflow_events(project_id,sequence);
CREATE INDEX IF NOT EXISTS ix_workflow_events_project_unprocessed ON workflow_events(project_id,processed_at,sequence) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS workflow_node_runs (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id VARCHAR(200) NOT NULL,
  node_run_id VARCHAR(255) NOT NULL,
  definition_version INTEGER NOT NULL,
  trigger_event_id UUID NOT NULL,
  correlation_id VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 0,
  input_ref JSONB NOT NULL DEFAULT '{}',
  output_ref JSONB,
  blocked_reason TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  task_id UUID,
  worker_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, correlation_id, node_id, definition_version)
);
CREATE INDEX IF NOT EXISTS ix_workflow_node_runs_project_status ON workflow_node_runs(project_id,status,created_at);
CREATE INDEX IF NOT EXISTS ix_workflow_node_runs_correlation ON workflow_node_runs(project_id,correlation_id,node_id);
ALTER TABLE workflow_node_runs ADD COLUMN IF NOT EXISTS capability VARCHAR(120);
CREATE TABLE IF NOT EXISTS checkpoints (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), stage VARCHAR(100) NOT NULL, idea_version INTEGER NOT NULL, git_commit VARCHAR(64), data_version VARCHAR(255), state JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS valid BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS invalidated_reason TEXT;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS human_feedback (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), session_id UUID REFERENCES conversation_sessions(id), category VARCHAR(40) NOT NULL, instruction TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE human_feedback ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE human_feedback ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'open';
ALTER TABLE human_feedback ADD COLUMN IF NOT EXISTS decided_by VARCHAR(200);
ALTER TABLE human_feedback ADD COLUMN IF NOT EXISTS decision_comment TEXT;
ALTER TABLE human_feedback ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS claim_reviews (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), claim TEXT NOT NULL, evidence_ids JSONB NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'pending', reviewer VARCHAR(200), decision_comment TEXT, evidence_status VARCHAR(80) NOT NULL DEFAULT 'page_quote_requires_claim_review', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS ix_claim_reviews_project ON claim_reviews(project_id,status,created_at);
CREATE TABLE IF NOT EXISTS repositories (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), paper_id UUID REFERENCES papers(id), source_url TEXT NOT NULL, license_spdx VARCHAR(100), commit_or_tag VARCHAR(255), verified_official BOOLEAN NOT NULL DEFAULT FALSE, metadata JSONB NOT NULL DEFAULT '{}', retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reproductions (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  repository_id UUID NOT NULL REFERENCES repositories(id),
  status VARCHAR(40) NOT NULL DEFAULT 'dependency_pending',
  source_commit VARCHAR(40) NOT NULL,
  repository_relative_path TEXT NOT NULL,
  dependency_manifest TEXT NOT NULL,
  dependency_sha256 VARCHAR(64) NOT NULL,
  venv_relative_path TEXT NOT NULL,
  entrypoint TEXT,
  plan JSONB NOT NULL DEFAULT '{}',
  dependency_report JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_reproductions_project ON reproductions(project_id,created_at);
CREATE TABLE IF NOT EXISTS reproduction_runs (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  reproduction_id UUID NOT NULL REFERENCES reproductions(id),
  proposal_id UUID NOT NULL REFERENCES proposals(id),
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  source_commit VARCHAR(40) NOT NULL,
  entrypoint TEXT NOT NULL,
  random_seeds JSONB NOT NULL DEFAULT '[]',
  config JSONB NOT NULL DEFAULT '{}',
  run_relative_path TEXT NOT NULL,
  output_manifest JSONB NOT NULL DEFAULT '[]',
  metrics JSONB NOT NULL DEFAULT '{}',
  artifact_proposal_id UUID,
  artifact_ids JSONB NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_reproduction_runs_project ON reproduction_runs(project_id,created_at);
CREATE INDEX IF NOT EXISTS ix_reproduction_runs_reproduction ON reproduction_runs(reproduction_id,created_at);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS reproduction_run_id UUID REFERENCES reproduction_runs(id);
CREATE TABLE IF NOT EXISTS artifact_dependencies (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), artifact_id UUID NOT NULL REFERENCES artifacts(id), upstream_type VARCHAR(40) NOT NULL, upstream_id VARCHAR(255) NOT NULL, relation VARCHAR(80) NOT NULL DEFAULT 'generated_from', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS lineage_dependencies (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), downstream_type VARCHAR(40) NOT NULL, downstream_id VARCHAR(255) NOT NULL, upstream_type VARCHAR(40) NOT NULL, upstream_id VARCHAR(255) NOT NULL, upstream_fingerprint VARCHAR(64) NOT NULL, relation VARCHAR(120) NOT NULL, valid BOOLEAN NOT NULL DEFAULT TRUE, invalidated_reason TEXT, invalidated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(project_id,downstream_type,downstream_id,upstream_type,upstream_id,relation));
CREATE INDEX IF NOT EXISTS ix_lineage_upstream ON lineage_dependencies(project_id,upstream_type,upstream_id,valid);
CREATE INDEX IF NOT EXISTS ix_lineage_downstream ON lineage_dependencies(project_id,downstream_type,downstream_id,valid);
CREATE TABLE IF NOT EXISTS memory_links (id UUID PRIMARY KEY, project_id VARCHAR(120) NOT NULL REFERENCES projects(id), source_type VARCHAR(80) NOT NULL, source_id UUID, artifact_id UUID REFERENCES artifacts(id), uploaded_file_id UUID REFERENCES uploaded_files(id), content_sha256 VARCHAR(64) NOT NULL, custom_id VARCHAR(100) NOT NULL, supermemory_id VARCHAR(255) NOT NULL, container_tag VARCHAR(120) NOT NULL, task_type VARCHAR(20) NOT NULL DEFAULT 'memory', status VARCHAR(30) NOT NULL DEFAULT 'active', metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, UNIQUE(project_id,source_type,source_id,content_sha256));
ALTER TABLE memory_links ADD COLUMN IF NOT EXISTS uploaded_file_id UUID REFERENCES uploaded_files(id);
CREATE INDEX IF NOT EXISTS ix_memory_links_project ON memory_links(project_id,status,created_at);
CREATE INDEX IF NOT EXISTS ix_memory_links_remote ON memory_links(project_id,supermemory_id);
CREATE TABLE IF NOT EXISTS related_work_seeds (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  source_type VARCHAR(30) NOT NULL,
  raw_input JSONB NOT NULL DEFAULT '{}',
  input_summary TEXT NOT NULL,
  normalized_doi VARCHAR(500),
  normalized_title TEXT,
  year INTEGER,
  artifact_id UUID REFERENCES artifacts(id),
  artifact_sha256 VARCHAR(64),
  paper_id UUID REFERENCES papers(id),
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  created_by VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_related_work_seeds_project ON related_work_seeds(project_id,created_at);
CREATE TABLE IF NOT EXISTS related_work_candidates (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  provider VARCHAR(40) NOT NULL,
  stable_id VARCHAR(500) NOT NULL,
  normalized_doi VARCHAR(500),
  normalized_title TEXT NOT NULL,
  year INTEGER,
  title TEXT NOT NULL,
  paper_id UUID REFERENCES papers(id),
  status VARCHAR(30) NOT NULL DEFAULT 'candidate',
  discovery_depth INTEGER NOT NULL DEFAULT 0,
  candidate JSONB NOT NULL DEFAULT '{}',
  first_run_id UUID,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,provider,stable_id)
);
CREATE INDEX IF NOT EXISTS ix_related_work_candidates_project ON related_work_candidates(project_id,updated_at);
CREATE INDEX IF NOT EXISTS ix_related_work_candidates_doi ON related_work_candidates(project_id,normalized_doi);
CREATE INDEX IF NOT EXISTS ix_related_work_candidates_title_year ON related_work_candidates(project_id,normalized_title,year);
CREATE TABLE IF NOT EXISTS related_work_candidate_sources (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  candidate_id UUID NOT NULL REFERENCES related_work_candidates(id),
  provider VARCHAR(40) NOT NULL,
  stable_id VARCHAR(500) NOT NULL,
  candidate JSONB NOT NULL DEFAULT '{}',
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,candidate_id,provider,stable_id)
);
CREATE INDEX IF NOT EXISTS ix_related_work_candidate_sources_project ON related_work_candidate_sources(project_id,candidate_id);
CREATE TABLE IF NOT EXISTS related_work_seed_candidates (
  seed_id UUID NOT NULL REFERENCES related_work_seeds(id),
  candidate_id UUID NOT NULL REFERENCES related_work_candidates(id),
  provider VARCHAR(40) NOT NULL,
  match_method VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(seed_id,candidate_id,provider)
);
CREATE TABLE IF NOT EXISTS related_work_recursive_runs (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  proposal_id UUID NOT NULL REFERENCES proposals(id),
  seed_ids JSONB NOT NULL,
  providers JSONB NOT NULL,
  depth INTEGER NOT NULL,
  width INTEGER NOT NULL,
  max_total INTEGER NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  edge_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(proposal_id)
);
CREATE INDEX IF NOT EXISTS ix_related_work_recursive_runs_project ON related_work_recursive_runs(project_id,created_at);
CREATE TABLE IF NOT EXISTS related_work_source_attempts (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  seed_id UUID REFERENCES related_work_seeds(id),
  run_id UUID REFERENCES related_work_recursive_runs(id),
  parent_candidate_id UUID REFERENCES related_work_candidates(id),
  provider VARCHAR(40) NOT NULL,
  query TEXT NOT NULL,
  request_url TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) NOT NULL,
  http_status INTEGER,
  result_count INTEGER NOT NULL DEFAULT 0,
  failure JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_related_work_source_attempts_project ON related_work_source_attempts(project_id,created_at);
CREATE INDEX IF NOT EXISTS ix_related_work_source_attempts_run ON related_work_source_attempts(run_id,created_at);
CREATE TABLE IF NOT EXISTS related_work_request_cache (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  provider VARCHAR(40) NOT NULL,
  operation VARCHAR(30) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  schema_version VARCHAR(80) NOT NULL,
  request_url TEXT NOT NULL,
  request_params JSONB NOT NULL DEFAULT '{}',
  response JSONB NOT NULL,
  status VARCHAR(30) NOT NULL,
  http_status INTEGER,
  result_count INTEGER NOT NULL DEFAULT 0,
  failure JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_hit_at TIMESTAMPTZ,
  hit_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id,provider,operation,request_hash,schema_version)
);
CREATE INDEX IF NOT EXISTS ix_related_work_request_cache_lookup ON related_work_request_cache(project_id,provider,operation,request_hash,schema_version,expires_at);
CREATE TABLE IF NOT EXISTS related_work_citation_edges (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  run_id UUID REFERENCES related_work_recursive_runs(id),
  source_candidate_id UUID NOT NULL REFERENCES related_work_candidates(id),
  target_candidate_id UUID NOT NULL REFERENCES related_work_candidates(id),
  provider VARCHAR(40) NOT NULL,
  relation VARCHAR(30) NOT NULL DEFAULT 'references',
  ranking_score DOUBLE PRECISION,
  ranking_reasons JSONB NOT NULL DEFAULT '[]',
  discovery_depth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,source_candidate_id,target_candidate_id,provider,relation)
);
CREATE INDEX IF NOT EXISTS ix_related_work_edges_project ON related_work_citation_edges(project_id,created_at);
CREATE TABLE IF NOT EXISTS related_work_run_events (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  run_id UUID NOT NULL REFERENCES related_work_recursive_runs(id),
  event_type VARCHAR(50) NOT NULL,
  level INTEGER,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_related_work_run_events_run ON related_work_run_events(run_id,created_at);
CREATE TABLE IF NOT EXISTS related_work_candidate_reviews (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  candidate_id UUID NOT NULL REFERENCES related_work_candidates(id),
  decision VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL,
  actor VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_related_work_candidate_reviews_candidate ON related_work_candidate_reviews(project_id,candidate_id,created_at);
CREATE TABLE IF NOT EXISTS related_work_field_provenance (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  candidate_id UUID NOT NULL REFERENCES related_work_candidates(id),
  field_name VARCHAR(80) NOT NULL,
  provider VARCHAR(40),
  source_type VARCHAR(40) NOT NULL DEFAULT 'provider',
  stable_id VARCHAR(500),
  source_attempt_id UUID REFERENCES related_work_source_attempts(id),
  artifact_id UUID REFERENCES artifacts(id),
  retrieved_at TIMESTAMPTZ NOT NULL,
  locator TEXT,
  raw_value_hash VARCHAR(64) NOT NULL,
  normalized_value JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'observed',
  conflict_group VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE related_work_field_provenance ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE related_work_field_provenance ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'provider';
CREATE INDEX IF NOT EXISTS ix_related_work_field_provenance_candidate ON related_work_field_provenance(project_id,candidate_id,field_name,created_at);
CREATE INDEX IF NOT EXISTS ix_related_work_field_provenance_conflict ON related_work_field_provenance(project_id,candidate_id,status);
CREATE TABLE IF NOT EXISTS research_status_matrices (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  idea_version INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ready',
  created_by VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_research_status_matrices_project ON research_status_matrices(project_id,created_at);
CREATE TABLE IF NOT EXISTS research_status_matrix_rows (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  matrix_id UUID NOT NULL REFERENCES research_status_matrices(id),
  paper_id UUID NOT NULL REFERENCES papers(id),
  theme TEXT,
  method TEXT,
  year INTEGER,
  datasets JSONB NOT NULL DEFAULT '[]',
  metrics JSONB NOT NULL DEFAULT '[]',
  limitations TEXT,
  code_availability VARCHAR(40) NOT NULL DEFAULT 'unresolved',
  evidence_ids JSONB NOT NULL DEFAULT '[]',
  claim_review_ids JSONB NOT NULL DEFAULT '[]',
  evidence_status VARCHAR(60) NOT NULL DEFAULT 'candidate_requires_review',
  provenance JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(matrix_id,paper_id)
);
CREATE INDEX IF NOT EXISTS ix_research_status_matrix_rows_project ON research_status_matrix_rows(project_id,matrix_id,year);
CREATE TABLE IF NOT EXISTS research_status_gap_candidates (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  matrix_id UUID NOT NULL REFERENCES research_status_matrices(id),
  candidate_type VARCHAR(30) NOT NULL,
  statement TEXT NOT NULL,
  row_ids JSONB NOT NULL DEFAULT '[]',
  paper_ids JSONB NOT NULL DEFAULT '[]',
  evidence_ids JSONB NOT NULL DEFAULT '[]',
  claim_review_ids JSONB NOT NULL DEFAULT '[]',
  idea_version INTEGER NOT NULL DEFAULT 1,
  basis JSONB NOT NULL DEFAULT '{}',
  evidence_status VARCHAR(60) NOT NULL DEFAULT 'candidate_requires_review',
  status VARCHAR(30) NOT NULL DEFAULT 'candidate',
  actor VARCHAR(200) NOT NULL,
  decision_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
ALTER TABLE research_status_gap_candidates ADD COLUMN IF NOT EXISTS paper_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE research_status_gap_candidates ADD COLUMN IF NOT EXISTS evidence_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE research_status_gap_candidates ADD COLUMN IF NOT EXISTS claim_review_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE research_status_gap_candidates ADD COLUMN IF NOT EXISTS idea_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE research_status_gap_candidates ADD COLUMN IF NOT EXISTS basis JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ix_research_status_gaps_project ON research_status_gap_candidates(project_id,matrix_id,created_at);
CREATE TABLE IF NOT EXISTS research_comparisons (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  paper_id UUID NOT NULL REFERENCES papers(id),
  reproduction_run_id UUID NOT NULL REFERENCES reproduction_runs(id),
  status VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL,
  input_hash VARCHAR(64) NOT NULL,
  paper_context JSONB NOT NULL DEFAULT '{}',
  reproduction_context JSONB NOT NULL DEFAULT '{}',
  metric_comparisons JSONB NOT NULL DEFAULT '{}',
  blocking_reasons JSONB NOT NULL DEFAULT '[]',
  source_snapshot JSONB NOT NULL DEFAULT '{}',
  created_by VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_research_comparisons_project ON research_comparisons(project_id,created_at);
CREATE INDEX IF NOT EXISTS ix_research_comparisons_run ON research_comparisons(project_id,reproduction_run_id,created_at);
CREATE TABLE IF NOT EXISTS research_comparison_candidates (
  id UUID PRIMARY KEY,
  project_id VARCHAR(120) NOT NULL REFERENCES projects(id),
  comparison_id UUID NOT NULL REFERENCES research_comparisons(id),
  candidate_type VARCHAR(40) NOT NULL,
  statement TEXT NOT NULL,
  basis JSONB NOT NULL DEFAULT '{}',
  evidence_status VARCHAR(60) NOT NULL DEFAULT 'comparison_requires_review',
  status VARCHAR(30) NOT NULL DEFAULT 'candidate',
  actor VARCHAR(200) NOT NULL,
  decision_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_research_comparison_candidates_project ON research_comparison_candidates(project_id,comparison_id,created_at);
`

export async function migrate(): Promise<void> {
  for (const statement of migrationSql.split(';').map(item => item.trim()).filter(Boolean)) {
    await database.exec(`${statement};`)
  }
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0001-native-typescript') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0002-lineage-checkpoint-integrity') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0003-supermemory-links') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0004-claim-reviews') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0005-related-work-recursion') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0006-related-work-field-source-types') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0007-research-status-matrix-graph') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0008-reproduction-gated-execution') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0009-report-lineage') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0010-related-work-request-cache') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0011-research-comparisons') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0012-project-pinning') ON CONFLICT DO NOTHING")
  const sidebarOrderMigration = await database.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version='0013-project-sidebar-order'")
  if (!sidebarOrderMigration.rows.length) {
    await database.transaction(async transaction => {
      const projects = (await transaction.query<{ id: string; pinned: boolean }>('SELECT id,pinned FROM projects ORDER BY pinned DESC,updated_at DESC,created_at DESC,id')).rows
      const nextOrder = new Map<boolean, number>([[true, 0], [false, 0]])
      for (const project of projects) {
        const order = nextOrder.get(project.pinned) || 0
        await transaction.query('UPDATE projects SET sidebar_order=$2 WHERE id=$1', [project.id, order])
        nextOrder.set(project.pinned, order + 1)
      }
    })
    await database.query("INSERT INTO schema_migrations(version) VALUES ('0013-project-sidebar-order') ON CONFLICT DO NOTHING")
  }
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0014-project-slug-aliases') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0015-research-status-source-binding') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0017-chat-workspace-scope') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0018-workflow-v2-runtime') ON CONFLICT DO NOTHING")
}

/**
 * Confirms that project identities are semantic slugs. Legacy UUID project
 * schemas are intentionally unsupported and fail closed instead of migrating.
 */
export async function migrateProjectPrimaryKeyToSlug(): Promise<void> {
  const already = await one<{ version: string }>('SELECT version FROM schema_migrations WHERE version=$1', ['0016-project-id-slug-primary-key'])
  if (already) return
  const idColumn = await one<{ data_type: string }>(
    "SELECT data_type FROM information_schema.columns WHERE table_name='projects' AND column_name='id'",
  )
  if (idColumn?.data_type === 'uuid') throw new Error('legacy_uuid_project_schema_unsupported')
  if (idColumn?.data_type !== 'character varying') throw new Error('unexpected_project_id_type')
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0016-project-id-slug-primary-key') ON CONFLICT DO NOTHING")
}

export async function rows<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await database.query<T>(sql, params)).rows
}

export async function one<T extends object>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(sql, params))[0] ?? null
}

export async function audit(action: string, projectId: string | null, details: object, actor = 'system'): Promise<void> {
  await database.query('INSERT INTO audit_events(id, project_id, actor, action, details) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), projectId, actor, action, details])
}
