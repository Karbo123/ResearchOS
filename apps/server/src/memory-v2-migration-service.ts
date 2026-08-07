import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { z } from 'zod'
import {
  KNOWLEDGE_DOCUMENT_SCHEMA,
  knowledgeDocumentFrontMatter,
  knowledgeDocumentId,
  type KnowledgeDocumentFrontMatter,
  type KnowledgeDocumentKind,
} from './knowledge-document-contracts.js'
import { knowledgeDocumentPatchPayloadSchema } from './knowledge-document-proposal-service.js'
import { listKnowledgeDocuments, reconcileKnowledgeDocuments } from './knowledge-document-service.js'
import { parseKnowledgeMarkdown } from './knowledge-markdown-parser.js'
import { audit, database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { gitCommit } from './patch-service.js'
import { pathInside } from './paths.js'
import { requireProject } from './project-service.js'
import { projectRoot } from './project-storage.js'

type PaperRow = {
  id: string
  title: string
  doi: string | null
  source_url: string
  metadata: Record<string, unknown>
  bibtex: string | null
  verified: boolean
  confirmed: boolean
}

type EvidenceRow = {
  id: string
  paper_id: string | null
  claim: string
  quote: string
  locator: string | null
  source_url: string
}

type ExperimentRow = {
  id: string
  proposal_id: string
  status: string
  experiment_type: string
  config: Record<string, unknown>
  metrics: Record<string, unknown>
  run_id: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

type ArtifactRow = {
  id: string
  experiment_id: string | null
  kind: string
  name: string
  relative_path: string
  mime_type: string
  sha256: string
  valid: boolean
}

export type MemoryV2MigrationCandidate = {
  candidate_id: string
  document_id: string
  document_kind: KnowledgeDocumentKind
  relative_path: string
  title: string
  source_entities: Array<{ type: string; id: string; fingerprint: string }>
  status: 'ready' | 'blocked'
  blocking_reasons: string[]
  proposed_sha256: string | null
}

type InternalCandidate = MemoryV2MigrationCandidate & {
  content: string | null
  source_snapshot: Record<string, unknown>
}

const terminalExperimentStatuses = new Set(['succeeded', 'failed', 'cancelled', 'invalidated'])
const sensitiveKey = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|secret|password|cookie|authorization)(?:$|[_-])/i

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
  }
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value), null, 2) ?? 'null'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)))
}

function readableKey(value: string, fallback: string): string {
  const normalized = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return normalized.length >= 2 ? normalized : fallback
}

function stableSuffix(value: string, length = 8): string {
  return sha256(value).slice(0, length)
}

function markdownCell(value: unknown): string {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ').trim()
}

function containsSensitiveField(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => containsSensitiveField(item, depth + 1))
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => sensitiveKey.test(key) || containsSensitiveField(item, depth + 1))
}

function renderDocument(frontmatter: KnowledgeDocumentFrontMatter, evidenceBoundary: string, body: string): string {
  const source = `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n# ${frontmatter.title}\n\n> 证据边界：${evidenceBoundary}\n\n${body.trim()}\n\n## 迁移状态\n\n本文档由现有受控记录确定性映射而来，当前状态为 \`draft\`。批准本 Proposal 只会创建这份知识文档，不会把候选解释升级为科研结论，也不会自动执行实验或修改论文。\n`
  parseKnowledgeMarkdown(source, frontmatter.project_id, pathFor(frontmatter))
  return source
}

function pathFor(frontmatter: KnowledgeDocumentFrontMatter): string {
  if (frontmatter.kind === 'idea') return 'research/idea/current.md'
  if (frontmatter.kind === 'paper_summary') return `research/related-work/papers/${frontmatter.id.slice('paper:'.length)}.md`
  if (frontmatter.kind === 'experiment_plan') return `research/experiments/method/${frontmatter.id.slice('experiment:'.length).replace('/plan', '')}/plan.md`
  if (frontmatter.kind === 'run_result') {
    const [, value = ''] = frontmatter.id.split(':', 2)
    const [experimentKey = '', runKey = ''] = value.split('/')
    return `research/experiments/method/${experimentKey}/runs/${runKey}/result.md`
  }
  throw new Error('memory_migration_path_unsupported')
}

function publicCandidate(candidate: InternalCandidate): MemoryV2MigrationCandidate {
  const { content: _content, source_snapshot: _sourceSnapshot, ...visible } = candidate
  return visible
}

function blockedCandidate(input: Omit<InternalCandidate, 'status' | 'blocking_reasons' | 'content' | 'proposed_sha256'>, reasons: string[]): InternalCandidate {
  return { ...input, status: 'blocked', blocking_reasons: reasons, content: null, proposed_sha256: null }
}

function readyCandidate(input: Omit<InternalCandidate, 'status' | 'blocking_reasons' | 'proposed_sha256'>): InternalCandidate {
  return { ...input, status: 'ready', blocking_reasons: [], proposed_sha256: input.content ? sha256(input.content) : null }
}

async function ideaCandidate(projectId: string, existingDocumentIds: Set<string>): Promise<InternalCandidate | null> {
  if (existingDocumentIds.has('idea:current')) return null
  const ideaPath = pathInside(projectRoot(projectId), 'idea.json')
  if (!existsSync(ideaPath)) return null
  const bytes = readFileSync(ideaPath)
  const base = {
    candidate_id: 'idea:current',
    document_id: 'idea:current',
    document_kind: 'idea' as const,
    relative_path: 'research/idea/current.md',
    title: 'Current Idea and method plan',
    source_entities: [] as Array<{ type: string; id: string; fingerprint: string }>,
    source_snapshot: { project_id: projectId, source: 'idea.json', idea_json_sha256: sha256(bytes.toString('utf8')) },
  }
  if (bytes.length > 512 * 1024) return blockedCandidate(base, ['idea_json_too_large'])
  let spec: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not_object')
    spec = parsed as Record<string, unknown>
  } catch {
    return blockedCandidate(base, ['idea_json_invalid'])
  }
  if (containsSensitiveField(spec)) return blockedCandidate(base, ['idea_json_sensitive_field'])
  const latest = await one<{ id: string; version: number; spec: Record<string, unknown> }>('SELECT id,version,spec FROM idea_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId])
  if (latest && fingerprint(latest.spec) !== fingerprint(spec)) return blockedCandidate({ ...base, source_entities: [{ type: 'idea_version', id: latest.id, fingerprint: fingerprint(latest.spec) }], source_snapshot: { ...base.source_snapshot, idea_version_id: latest.id, idea_version: latest.version, idea_version_fingerprint: fingerprint(latest.spec) } }, ['idea_json_database_mismatch'])
  const project = await requireProject(projectId)
  const idea = spec.idea && typeof spec.idea === 'object' && !Array.isArray(spec.idea) ? spec.idea as Record<string, unknown> : {}
  const title = typeof idea.title === 'string' && idea.title.trim() ? idea.title.trim() : project.title
  const sourceEntities = latest ? [{ type: 'idea_version', id: latest.id, fingerprint: fingerprint(latest.spec) }] : []
  const frontmatter = knowledgeDocumentFrontMatter.parse({
    schema: KNOWLEDGE_DOCUMENT_SCHEMA,
    project_id: projectId,
    id: 'idea:current',
    kind: 'idea',
    title: `${title}: current Idea and method`,
    status: 'draft',
    depends_on: latest ? [{ id: `idea_version:${latest.id}`, relation: 'represents', impact: 'review_required' }] : [],
    workspace_scopes: ['overview:overview', 'overview:idea', 'implementation:method', 'paper:introduction', 'paper:paper_method'],
  })
  const content = renderDocument(frontmatter, 'This is an exact migration of the current idea.json structure. Expected contributions, hypotheses, and planned effects remain unverified until supported by evidence and experiments.', `## Structured Idea source\n\nThe following JSON is copied from the project-controlled \`idea.json\`; no model completed or reinterpreted missing fields.\n\n\`\`\`\`json\n${canonicalJson(spec)}\n\`\`\`\``)
  return readyCandidate({
    ...base,
    title: frontmatter.title,
    source_entities: sourceEntities,
    source_snapshot: { ...base.source_snapshot, ...(latest ? { idea_version_id: latest.id, idea_version: latest.version, idea_version_fingerprint: fingerprint(latest.spec) } : {}) },
    content,
  })
}

function paperMetadataSnapshot(paper: PaperRow): Record<string, unknown> {
  const metadata = paper.metadata || {}
  return {
    provider: metadata.provider ?? null,
    providers: metadata.providers ?? null,
    provenance: metadata.provenance ?? metadata.source_provenance ?? null,
    authors: metadata.authors ?? null,
    institutions: metadata.institutions ?? null,
    venue: metadata.venue ?? metadata.container_title ?? null,
    year: metadata.year ?? metadata.published_year ?? null,
    abstract: typeof metadata.abstract === 'string' ? metadata.abstract : null,
  }
}

function paperCandidate(projectId: string, paper: PaperRow, evidence: EvidenceRow[], existingDocumentIds: Set<string>, boundPaperIds: Set<string>): InternalCandidate | null {
  if (boundPaperIds.has(paper.id)) return null
  const key = `${readableKey(paper.title, 'paper')}-${stableSuffix(paper.id, 6)}`
  const documentId = `paper:${key}`
  if (existingDocumentIds.has(documentId)) return null
  const relativePath = `research/related-work/papers/${key}.md`
  const metadata = paperMetadataSnapshot(paper)
  const locatedEvidence = evidence.filter(item => item.locator && item.quote.trim()).slice(0, 200)
  const readScope = locatedEvidence.length ? 'partial' : typeof metadata.abstract === 'string' && metadata.abstract.trim() ? 'abstract' : 'metadata'
  const sourceEntities = [
    { type: 'paper', id: paper.id, fingerprint: fingerprint({ ...paper, metadata }) },
    ...locatedEvidence.map(item => ({ type: 'evidence', id: item.id, fingerprint: fingerprint(item) })),
  ]
  const frontmatter = knowledgeDocumentFrontMatter.parse({
    schema: KNOWLEDGE_DOCUMENT_SCHEMA,
    project_id: projectId,
    id: documentId,
    kind: 'paper_summary',
    title: paper.title,
    status: 'draft',
    depends_on: [
      { id: `paper:${paper.id}`, relation: 'summarizes', impact: 'review_required' },
      ...locatedEvidence.map(item => ({ id: `evidence:${item.id}`, relation: 'supported_by', impact: 'evidence_blocked' as const })),
    ],
    workspace_scopes: ['related_work:literature', 'related_work:visualization', 'paper:paper_related_work'],
    paper_id: paper.id,
    evidence_ids: locatedEvidence.map(item => item.id),
    read_scope: readScope,
  })
  const evidenceRows = locatedEvidence.length
    ? locatedEvidence.map(item => `| ${item.id} | ${markdownCell(item.locator)} | ${markdownCell(item.claim)} | ${markdownCell(item.source_url)} |`).join('\n')
    : '| - | unresolved | No locator-bound Evidence was available during migration. | - |'
  const quotes = locatedEvidence.map(item => `### Evidence ${item.id}\n\nLocator: ${item.locator}\n\n> ${item.quote.trim().replace(/\r?\n/g, '\n> ')}`).join('\n\n')
  const abstract = typeof metadata.abstract === 'string' && metadata.abstract.trim() ? `## Provider abstract\n\n${metadata.abstract.trim()}` : '## Provider abstract\n\nNo provider abstract is registered.'
  const bibtex = paper.bibtex?.trim() ? `## Registered BibTeX\n\n\`\`\`bibtex\n${paper.bibtex.trim()}\n\`\`\`` : '## Registered BibTeX\n\nNo BibTeX is registered.'
  const content = renderDocument(frontmatter, readScope === 'metadata' ? 'Only registered metadata was available. This document is not a paper-content summary and is not full-text Evidence.' : readScope === 'abstract' ? 'The provider abstract is included verbatim, but abstract-level material does not replace locator-bound full-text Evidence.' : 'Only the listed locator-bound Evidence records may support source claims; all other paper details remain metadata-level.', `## Registered metadata\n\n- Paper ID: ${paper.id}\n- DOI: ${paper.doi || 'unresolved'}\n- Source URL: ${paper.source_url}\n- User confirmed: ${paper.confirmed}\n- Metadata verified flag: ${paper.verified}\n- Read scope: ${readScope}\n\n\`\`\`\`json\n${canonicalJson(metadata)}\n\`\`\`\`\n\n${abstract}\n\n## Locator-bound Evidence\n\n| Evidence ID | Locator | Registered claim | Source |\n| --- | --- | --- | --- |\n${evidenceRows}\n\n${quotes || 'No locator-bound quote was migrated.'}\n\n${bibtex}`)
  return readyCandidate({
    candidate_id: documentId,
    document_id: documentId,
    document_kind: 'paper_summary',
    relative_path: relativePath,
    title: paper.title,
    source_entities: sourceEntities,
    source_snapshot: { project_id: projectId, source: 'papers/evidence', paper: { id: paper.id, fingerprint: sourceEntities[0]!.fingerprint }, evidence: sourceEntities.slice(1), read_scope: readScope },
    content,
  })
}

function experimentCandidates(projectId: string, experiment: ExperimentRow, artifacts: ArtifactRow[], existingDocumentIds: Set<string>, bound: Array<{ kind: string; experiment_id: unknown; run_id: unknown }>): InternalCandidate[] {
  const key = `${readableKey(experiment.experiment_type, 'experiment')}-${stableSuffix(experiment.id, 8)}`
  const base = `research/experiments/method/${key}`
  const sourceEntities = [{ type: 'experiment', id: experiment.id, fingerprint: fingerprint(experiment) }]
  const sensitive = containsSensitiveField(experiment.config)
  const output: InternalCandidate[] = []
  if (!bound.some(item => item.kind === 'experiment_plan' && item.experiment_id === experiment.id)) {
    const documentId = `experiment:${key}/plan`
    if (!existingDocumentIds.has(documentId)) {
      const common = {
        candidate_id: documentId,
        document_id: documentId,
        document_kind: 'experiment_plan' as const,
        relative_path: `${base}/plan.md`,
        title: `${experiment.experiment_type} experiment plan`,
        source_entities: sourceEntities,
        source_snapshot: { project_id: projectId, source: 'experiments', experiment_id: experiment.id, experiment_fingerprint: sourceEntities[0]!.fingerprint },
      }
      if (sensitive) output.push(blockedCandidate(common, ['experiment_config_sensitive_field']))
      else {
        const frontmatter = knowledgeDocumentFrontMatter.parse({ schema: KNOWLEDGE_DOCUMENT_SCHEMA, project_id: projectId, id: documentId, kind: 'experiment_plan', title: common.title, status: 'draft', depends_on: [{ id: `experiment:${experiment.id}`, relation: 'plans_from', impact: 'rerun_required' }], workspace_scopes: ['implementation:method', 'paper:paper_experiments'], experiment_id: experiment.id })
        const content = renderDocument(frontmatter, 'This plan is reconstructed from the existing Experiment row. It describes registered configuration only and does not mean the experiment was approved, executed, or scientifically validated.', `## Experiment ledger\n\n- Experiment ID: ${experiment.id}\n- Proposal ID: ${experiment.proposal_id}\n- Recorded status: ${experiment.status}\n- Created at: ${experiment.created_at}\n- Finished at: ${experiment.finished_at || 'not finished'}\n- Run ID: ${experiment.run_id || 'unresolved'}\n\n## Registered configuration\n\n\`\`\`\`json\n${canonicalJson(experiment.config)}\n\`\`\`\`\n\n## Missing planning interpretation\n\nObjectives, controlled variables, stopping criteria, comparability, and risks were not inferred during migration. They must be added through a later reviewable Proposal.`)
        output.push(readyCandidate({ ...common, content }))
      }
    }
  }

  if (terminalExperimentStatuses.has(experiment.status) && !bound.some(item => item.kind === 'run_result' && item.experiment_id === experiment.id && item.run_id === (experiment.run_id || experiment.id))) {
    const runKey = `${readableKey(experiment.run_id || experiment.experiment_type, 'run')}-${stableSuffix(experiment.id, 8)}`
    const documentId = `run:${key}/${runKey}`
    if (!existingDocumentIds.has(documentId)) {
      const validArtifacts = artifacts.filter(item => item.valid)
      const runSources = [...sourceEntities, ...validArtifacts.map(item => ({ type: 'artifact', id: item.id, fingerprint: item.sha256 }))]
      const frontmatter = knowledgeDocumentFrontMatter.parse({
        schema: KNOWLEDGE_DOCUMENT_SCHEMA,
        project_id: projectId,
        id: documentId,
        kind: 'run_result',
        title: `${experiment.experiment_type} run result`,
        status: 'draft',
        depends_on: [{ id: `experiment:${experiment.id}`, relation: 'summarizes', impact: 'rerun_required' }, ...validArtifacts.map(item => ({ id: `artifact:${item.id}`, relation: 'references_artifact', impact: 'evidence_blocked' as const }))],
        workspace_scopes: ['implementation:method', 'paper:paper_experiments'],
        experiment_id: experiment.id,
        run_id: experiment.run_id || experiment.id,
        artifact_ids: validArtifacts.map(item => item.id),
      })
      const artifactRows = artifacts.length ? artifacts.map(item => `| ${item.id} | ${markdownCell(item.name)} | ${item.valid ? 'valid' : 'invalid'} | ${item.sha256} | ${markdownCell(item.relative_path)} |`).join('\n') : '| - | - | - | - | No Artifact registered |'
      const content = renderDocument(frontmatter, 'All numbers below are copied from the existing Experiment.metrics record. This migration does not infer causes, comparability, significance, or superiority; invalid Artifacts are retained only as historical rows and are not bound as evidence.', `## Run ledger\n\n- Experiment ID: ${experiment.id}\n- Run ID: ${experiment.run_id || experiment.id}\n- Status: ${experiment.status}\n- Error: ${experiment.error || 'none recorded'}\n- Finished at: ${experiment.finished_at || 'unresolved'}\n\n## Authoritative recorded metrics\n\n\`\`\`\`json\n${canonicalJson(experiment.metrics)}\n\`\`\`\`\n\n## Controlled Artifacts\n\n| Artifact ID | Name | Validity | SHA-256 | Path |\n| --- | --- | --- | --- | --- |\n${artifactRows}\n\n## Missing interpretation\n\nNo explanation of the result was generated during migration. Interpretation and comparison require a separate reviewable synthesis grounded in compatible protocols.`)
      output.push(readyCandidate({
        candidate_id: documentId,
        document_id: documentId,
        document_kind: 'run_result',
        relative_path: `${base}/runs/${runKey}/result.md`,
        title: frontmatter.title,
        source_entities: runSources,
        source_snapshot: { project_id: projectId, source: 'experiments/artifacts', experiment_id: experiment.id, experiment_fingerprint: sourceEntities[0]!.fingerprint, artifacts: validArtifacts.map(item => ({ id: item.id, sha256: item.sha256 })) },
        content,
      }))
    }
  }
  return output
}

async function internalMigrationCandidates(projectId: string): Promise<InternalCandidate[]> {
  await requireProject(projectId)
  await reconcileKnowledgeDocuments(projectId, 'api')
  const existing = await listKnowledgeDocuments(projectId)
  const existingDocumentIds = new Set(existing.map(item => item.document_id))
  const boundPaperIds = new Set(existing.filter(item => item.kind === 'paper_summary' && typeof item.metadata.paper_id === 'string').map(item => String(item.metadata.paper_id)))
  const boundExperiments = existing.map(item => ({ kind: item.kind, experiment_id: item.metadata.experiment_id, run_id: item.metadata.run_id }))
  const [papers, evidence, experiments, artifacts] = await Promise.all([
    rows<PaperRow>('SELECT id,title,doi,source_url,metadata,bibtex,verified,confirmed FROM papers WHERE project_id=$1 ORDER BY created_at,id', [projectId]),
    rows<EvidenceRow>('SELECT id,paper_id,claim,quote,locator,source_url FROM evidence WHERE project_id=$1 ORDER BY created_at,id', [projectId]),
    rows<ExperimentRow>('SELECT id,proposal_id,status,experiment_type,config,metrics,run_id,error,created_at,finished_at FROM experiments WHERE project_id=$1 ORDER BY created_at,id', [projectId]),
    rows<ArtifactRow>('SELECT id,experiment_id,kind,name,relative_path,mime_type,sha256,valid FROM artifacts WHERE project_id=$1 ORDER BY created_at,id', [projectId]),
  ])
  const candidates: InternalCandidate[] = []
  const idea = await ideaCandidate(projectId, existingDocumentIds)
  if (idea) candidates.push(idea)
  for (const paper of papers) {
    const candidate = paperCandidate(projectId, paper, evidence.filter(item => item.paper_id === paper.id), existingDocumentIds, boundPaperIds)
    if (candidate) candidates.push(candidate)
  }
  for (const experiment of experiments) candidates.push(...experimentCandidates(projectId, experiment, artifacts.filter(item => item.experiment_id === experiment.id), existingDocumentIds, boundExperiments))
  const paths = new Map<string, string>()
  for (const candidate of candidates) {
    const owner = paths.get(candidate.relative_path)
    if (owner && owner !== candidate.document_id) {
      candidate.status = 'blocked'
      candidate.blocking_reasons.push('migration_path_conflict')
      candidate.content = null
      candidate.proposed_sha256 = null
    } else paths.set(candidate.relative_path, candidate.document_id)
  }
  return candidates.sort((left, right) => left.relative_path.localeCompare(right.relative_path))
}

export async function memoryV2MigrationPreview(projectId: string): Promise<{ project_id: string; candidates: MemoryV2MigrationCandidate[]; summary: Record<string, number> }> {
  const candidates = await internalMigrationCandidates(projectId)
  const visible = candidates.map(publicCandidate)
  return {
    project_id: projectId,
    candidates: visible,
    summary: {
      total: visible.length,
      ready: visible.filter(item => item.status === 'ready').length,
      blocked: visible.filter(item => item.status === 'blocked').length,
      idea: visible.filter(item => item.document_kind === 'idea').length,
      papers: visible.filter(item => item.document_kind === 'paper_summary').length,
      experiment_plans: visible.filter(item => item.document_kind === 'experiment_plan').length,
      run_results: visible.filter(item => item.document_kind === 'run_result').length,
    },
  }
}

export const memoryV2MigrationProposalRequest = z.object({
  candidate_ids: z.array(knowledgeDocumentId).length(1).superRefine((value, context) => {
    if (new Set(value).size !== value.length) context.addIssue({ code: 'custom', message: 'candidate_ids cannot contain duplicates' })
  }),
}).strict()

export async function createMemoryV2MigrationProposals(projectId: string, candidateIds: string[]): Promise<{ project_id: string; proposals: Array<{ candidate_id: string; proposal_id: string; idempotent: boolean }> }> {
  await requireProject(projectId, true)
  const requested = memoryV2MigrationProposalRequest.parse({ candidate_ids: candidateIds }).candidate_ids
  const all = await internalMigrationCandidates(projectId)
  const byId = new Map(all.map(candidate => [candidate.candidate_id, candidate]))
  const selected = requested.map(candidateId => {
    const candidate = byId.get(candidateId)
    if (!candidate) throw new ApiError(409, 'memory_migration_candidate_stale', `迁移候选 ${candidateId} 已不存在或已经完成，请重新预览。`)
    const content = candidate.content
    if (candidate.status !== 'ready' || !content) throw new ApiError(409, 'memory_migration_candidate_blocked', `迁移候选 ${candidateId} 被阻止：${candidate.blocking_reasons.join(', ')}`)
    return { ...candidate, content }
  })
  const baseGitCommit = gitCommit(projectId)
  const proposals: Array<{ candidate_id: string; proposal_id: string; idempotent: boolean }> = []
  for (const candidate of selected) {
    const pending = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='knowledge_document_patch' AND status='pending' AND payload->>'document_id'=$2 ORDER BY created_at DESC LIMIT 1", [projectId, candidate.document_id])
    if (pending) {
      proposals.push({ candidate_id: candidate.candidate_id, proposal_id: pending.id, idempotent: true })
      continue
    }
    const payload = knowledgeDocumentPatchPayloadSchema.parse({
      patch_kind: 'knowledge_document',
      base_git_commit: baseGitCommit,
      document_id: candidate.document_id,
      document_kind: candidate.document_kind,
      relative_path: candidate.relative_path,
      context_manifest_id: null,
      source_snapshot: candidate.source_snapshot,
      operations: [{ action: 'create', path: candidate.relative_path, content: candidate.content }],
    })
    const proposalId = crypto.randomUUID()
    const lineCount = candidate.content.split('\n').length
    const diff = `--- /dev/null\n+++ b/${candidate.relative_path}\n@@ -0,0 +1,${lineCount} @@\n${candidate.content.split('\n').map(line => `+${line}`).join('\n')}`
    await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      proposalId,
      projectId,
      'knowledge_document_patch',
      `Migrate existing controlled sources into draft Memory v2 document ${candidate.document_id}.`,
      `Review migration candidate: ${candidate.title}`,
      diff,
      { source: 'memory_v2_migration', document_id: candidate.document_id, document_kind: candidate.document_kind, source_entities: candidate.source_entities, proposed_sha256: candidate.proposed_sha256, automatic_execution: false },
      payload,
    ])
    await audit('knowledge.migration_proposal_created', projectId, { proposal_id: proposalId, candidate_id: candidate.candidate_id, document_id: candidate.document_id, document_kind: candidate.document_kind, relative_path: candidate.relative_path, source_entities: candidate.source_entities, proposed_sha256: candidate.proposed_sha256 })
    proposals.push({ candidate_id: candidate.candidate_id, proposal_id: proposalId, idempotent: false })
  }
  return { project_id: projectId, proposals }
}
