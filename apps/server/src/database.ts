import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { runtimeRoot } from './paths.js'

export const database = new PGlite(resolve(runtimeRoot, 'research-os.pglite'))

const migrationSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY, slug VARCHAR(120) UNIQUE NOT NULL, title VARCHAR(240) NOT NULL, status VARCHAR(40) NOT NULL DEFAULT 'active', current_idea_version INTEGER NOT NULL DEFAULT 1, current_stage VARCHAR(80) NOT NULL DEFAULT 'initialized', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS conversation_sessions (id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), phase VARCHAR(40) NOT NULL DEFAULT 'clarifying', draft JSONB NOT NULL DEFAULT '{}', pending_field VARCHAR(80), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS messages (id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES conversation_sessions(id), role VARCHAR(20) NOT NULL, content TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS uploaded_files (id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES conversation_sessions(id), project_id UUID REFERENCES projects(id), name VARCHAR(255) NOT NULL, relative_path TEXT NOT NULL, mime_type VARCHAR(120) NOT NULL, size_bytes INTEGER NOT NULL, sha256 VARCHAR(64) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS idea_versions (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), version INTEGER NOT NULL, spec JSONB NOT NULL, change_reason TEXT, supersedes_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(project_id, version));
CREATE TABLE IF NOT EXISTS papers (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), title TEXT NOT NULL, doi VARCHAR(255), source_url TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', bibtex TEXT, verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS evidence (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), paper_id UUID REFERENCES papers(id), claim TEXT NOT NULL, quote TEXT NOT NULL, locator VARCHAR(255), source_url TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS proposals (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), kind VARCHAR(60) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'pending', reason TEXT NOT NULL, summary TEXT NOT NULL, diff TEXT, impact JSONB NOT NULL DEFAULT '{}', estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0, payload JSONB NOT NULL DEFAULT '{}', decided_by VARCHAR(200), decision_comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS experiments (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), proposal_id UUID NOT NULL REFERENCES proposals(id), status VARCHAR(30) NOT NULL DEFAULT 'queued', experiment_type VARCHAR(80) NOT NULL, config JSONB NOT NULL DEFAULT '{}', metrics JSONB NOT NULL DEFAULT '{}', run_id VARCHAR(255), error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS artifacts (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), experiment_id UUID REFERENCES experiments(id), kind VARCHAR(80) NOT NULL, name VARCHAR(255) NOT NULL, relative_path TEXT NOT NULL, mime_type VARCHAR(120) NOT NULL, sha256 VARCHAR(64) NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', valid BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS policies (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), rule TEXT NOT NULL, rationale TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS audit_events (id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), actor VARCHAR(200) NOT NULL, action VARCHAR(120) NOT NULL, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reports (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), period VARCHAR(20) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS tasks (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), kind VARCHAR(100) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'queued', payload JSONB NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, idempotency_key VARCHAR(255), next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), leased_until TIMESTAMPTZ, lease_token VARCHAR(64), error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_idempotency_key ON tasks (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tasks_queue_claim ON tasks (status, next_attempt_at, leased_until, created_at);
CREATE TABLE IF NOT EXISTS checkpoints (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), stage VARCHAR(100) NOT NULL, idea_version INTEGER NOT NULL, git_commit VARCHAR(64), data_version VARCHAR(255), state JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS valid BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS invalidated_reason TEXT;
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS human_feedback (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), session_id UUID REFERENCES conversation_sessions(id), category VARCHAR(40) NOT NULL, instruction TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS repositories (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), paper_id UUID REFERENCES papers(id), source_url TEXT NOT NULL, license_spdx VARCHAR(100), commit_or_tag VARCHAR(255), verified_official BOOLEAN NOT NULL DEFAULT FALSE, metadata JSONB NOT NULL DEFAULT '{}', retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS artifact_dependencies (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), artifact_id UUID NOT NULL REFERENCES artifacts(id), upstream_type VARCHAR(40) NOT NULL, upstream_id VARCHAR(255) NOT NULL, relation VARCHAR(80) NOT NULL DEFAULT 'generated_from', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS lineage_dependencies (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), downstream_type VARCHAR(40) NOT NULL, downstream_id VARCHAR(255) NOT NULL, upstream_type VARCHAR(40) NOT NULL, upstream_id VARCHAR(255) NOT NULL, upstream_fingerprint VARCHAR(64) NOT NULL, relation VARCHAR(120) NOT NULL, valid BOOLEAN NOT NULL DEFAULT TRUE, invalidated_reason TEXT, invalidated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(project_id,downstream_type,downstream_id,upstream_type,upstream_id,relation));
CREATE INDEX IF NOT EXISTS ix_lineage_upstream ON lineage_dependencies(project_id,upstream_type,upstream_id,valid);
CREATE INDEX IF NOT EXISTS ix_lineage_downstream ON lineage_dependencies(project_id,downstream_type,downstream_id,valid);
CREATE TABLE IF NOT EXISTS memory_links (id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), source_type VARCHAR(80) NOT NULL, source_id UUID, artifact_id UUID REFERENCES artifacts(id), uploaded_file_id UUID REFERENCES uploaded_files(id), content_sha256 VARCHAR(64) NOT NULL, custom_id VARCHAR(100) NOT NULL, supermemory_id VARCHAR(255) NOT NULL, container_tag VARCHAR(120) NOT NULL, task_type VARCHAR(20) NOT NULL DEFAULT 'memory', status VARCHAR(30) NOT NULL DEFAULT 'active', metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, UNIQUE(project_id,source_type,source_id,content_sha256));
ALTER TABLE memory_links ADD COLUMN IF NOT EXISTS uploaded_file_id UUID REFERENCES uploaded_files(id);
CREATE INDEX IF NOT EXISTS ix_memory_links_project ON memory_links(project_id,status,created_at);
CREATE INDEX IF NOT EXISTS ix_memory_links_remote ON memory_links(project_id,supermemory_id);
`

export async function migrate(): Promise<void> {
  await database.exec(migrationSql)
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0001-native-typescript') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0002-lineage-checkpoint-integrity') ON CONFLICT DO NOTHING")
  await database.query("INSERT INTO schema_migrations(version) VALUES ('0003-supermemory-links') ON CONFLICT DO NOTHING")
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
