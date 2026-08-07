import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const runId = `${Date.now().toString(36)}-${process.pid}`
const runtimeDirectory = resolve(repositoryRoot, 'runtime', `memory-v2-capacity-${runId}`)
const projectsDirectory = resolve(repositoryRoot, 'runtime', `memory-v2-capacity-projects-${runId}`)
const projectId = `capacity-memory-${randomUUID().replaceAll('-', '').slice(0, 4)}`

if (existsSync(resolve(repositoryRoot, '.env')) && typeof process.loadEnvFile === 'function') process.loadEnvFile(resolve(repositoryRoot, '.env'))
process.env.NODE_ENV = 'test'
process.env.RESEARCH_RUNTIME_DIR = runtimeDirectory
process.env.RESEARCH_PROJECTS_DIR = projectsDirectory
process.env.SUPERMEMORY_ENABLED = 'false'

const { database, migrate, one } = await import('../apps/server/src/database.js')
const { createProjectWorkspace } = await import('../apps/server/src/project-service.js')
const { buildContextPacket } = await import('../apps/server/src/context-planner.js')
const { listKnowledgeDocuments, reconcileKnowledgeDocuments, readKnowledgeDocument } = await import('../apps/server/src/knowledge-document-service.js')
const { pathInside } = await import('../apps/server/src/paths.js')
const { projectRoot } = await import('../apps/server/src/project-storage.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function writeProjectFile(relativePath: string, source: string): void {
  const absolute = pathInside(projectRoot(projectId), ...relativePath.split('/'))
  mkdirSync(resolve(absolute, '..'), { recursive: true })
  writeFileSync(absolute, source, 'utf8')
}

function paperSource(index: number, paperId: string): string {
  const key = String(index + 1).padStart(3, '0')
  return `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: paper:capacity-${key}
kind: paper_summary
title: Capacity paper ${key}
status: confirmed
depends_on: []
workspace_scopes:
  - related_work:literature
paper_id: ${paperId}
read_scope: abstract
---

# Capacity paper ${key}

## Retrieval marker

capacity-paper-marker-${key} describes the controlled contribution, dataset protocol, and reported metric for paper ${key}.

## Limitations

This generated acceptance document is a summary candidate and is not raw paper evidence.
`
}

function experimentPlanSource(index: number, experimentId: string): string {
  const key = String(index + 1).padStart(3, '0')
  return `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: experiment:capacity-${key}/plan
kind: experiment_plan
title: Capacity experiment ${key} plan
status: confirmed
depends_on: []
workspace_scopes:
  - implementation:method
  - paper:paper_experiments
experiment_id: ${experimentId}
---

# Capacity experiment ${key}

## Retrieval marker

capacity-experiment-marker-${key} tests the planned method against the fixed benchmark protocol.

## Measurement contract

Measure accuracy, macro-F1, and latency with a fixed seed and record the exact configuration.
`
}

function runResultSource(index: number, run: number, experimentId: string): string {
  const experimentKey = String(index + 1).padStart(3, '0')
  const runKey = String(run).padStart(2, '0')
  return `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: experiment:capacity-${experimentKey}/run-${runKey}
kind: run_result
title: Capacity experiment ${experimentKey} run ${runKey}
status: confirmed
depends_on: []
workspace_scopes:
  - implementation:method
  - paper:paper_experiments
experiment_id: ${experimentId}
run_id: capacity-${experimentKey}-run-${runKey}
---

# Capacity experiment ${experimentKey} run ${runKey}

## Result marker

capacity-run-marker-${experimentKey}-${runKey} recorded from the controlled run.

## Metrics

- accuracy: 0.${String((index * 7 + run * 3) % 100).padStart(2, '0')}
- latency_ms: ${40 + index + run}
`
}

function ideaSource(): string {
  return `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: idea:current
kind: idea
title: Capacity acceptance idea
status: confirmed
depends_on: []
workspace_scopes:
  - overview:overview
  - implementation:method
---

# Capacity acceptance idea

The benchmark evaluates controlled retrieval without placing every document in one model context.
`
}

function protocolSource(): string {
  return `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: benchmark:protocol
kind: benchmark_protocol
title: Capacity benchmark protocol
status: confirmed
depends_on: []
workspace_scopes:
  - implementation:method
  - paper:paper_experiments
---

# Capacity benchmark protocol

Use a fixed seed, fixed dataset split, and bounded context budget for all capacity measurements.
`
}

const paperIds = Array.from({ length: 100 }, () => randomUUID())
const experimentIds = Array.from({ length: 200 }, () => randomUUID())
const proposalIds = experimentIds.map(() => randomUUID())
const started = performance.now()
let firstReconcileMs = 0
let secondReconcileMs = 0
let paperRecallCount = 0
let experimentRecallCount = 0
const plannerLatencies: number[] = []

try {
  await migrate()
  await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Memory v2 capacity acceptance'])
  await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3)', [randomUUID(), projectId, { acceptance: true }])
  await createProjectWorkspace(projectId, projectId, {})
  writeProjectFile('research/idea/current.md', ideaSource())
  writeProjectFile('research/experiments/benchmark-protocol.md', protocolSource())

  for (const [index, paperId] of paperIds.entries()) {
    const key = String(index + 1).padStart(3, '0')
    await database.query('INSERT INTO papers(id,project_id,title,source_url,metadata,confirmed) VALUES ($1,$2,$3,$4,$5,TRUE)', [paperId, projectId, `Capacity paper ${key}`, `https://example.invalid/paper/${key}`, { acceptance: 'memory-v2-capacity' }])
    writeProjectFile(`research/related-work/papers/capacity-${key}.md`, paperSource(index, paperId))
  }
  for (const [index, experimentId] of experimentIds.entries()) {
    const key = String(index + 1).padStart(3, '0')
    await database.query('INSERT INTO proposals(id,project_id,kind,status,reason,summary,payload) VALUES ($1,$2,$3,\'approved\',$4,$5,$6)', [proposalIds[index], projectId, 'experiment', 'capacity acceptance fixture', `Capacity experiment ${key}`, { acceptance: 'memory-v2-capacity' }])
    await database.query('INSERT INTO experiments(id,project_id,proposal_id,status,experiment_type,config,metrics,run_id,finished_at) VALUES ($1,$2,$3,\'succeeded\',$4,$5,$6,$7,NOW())', [experimentId, projectId, proposalIds[index], 'capacity-fixture', { seed: index + 1, dataset: 'capacity-fixture' }, { accuracy: 0.8 + ((index % 10) / 100), latency_ms: 40 + index }, `capacity-${key}-run-02`])
    writeProjectFile(`research/experiments/method/capacity-${key}/plan.md`, experimentPlanSource(index, experimentId))
    writeProjectFile(`research/experiments/method/capacity-${key}/runs/run-01/result.md`, runResultSource(index, 1, experimentId))
    writeProjectFile(`research/experiments/method/capacity-${key}/runs/run-02/result.md`, runResultSource(index, 2, experimentId))
  }

  const beforeReconcile = performance.now()
  const first = await reconcileKnowledgeDocuments(projectId, 'test')
  firstReconcileMs = performance.now() - beforeReconcile
  assert(first.documents.length === 702, `expected 702 knowledge documents, got ${first.documents.length}`)
  const secondStart = performance.now()
  const second = await reconcileKnowledgeDocuments(projectId, 'test')
  secondReconcileMs = performance.now() - secondStart
  assert(second.documents.every(document => !document.changed), 'unchanged capacity documents were re-parsed as changed')
  const registered = await listKnowledgeDocuments(projectId)
  assert(registered.length === 702, `expected 702 registered documents, got ${registered.length}`)

  for (const index of [0, 24, 49, 74, 99]) {
    const key = String(index + 1).padStart(3, '0')
    const before = performance.now()
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'literature', workspace_area: 'related_work', workspace_tab: 'literature', workspace_scope: 'related_work/literature', query: `capacity-paper-marker-${key}`, search_mode: 'bm25' })
    plannerLatencies.push(performance.now() - before)
    assert(packet.included_tokens <= packet.plan.token_budget - packet.plan.output_reserve, `paper context budget exceeded for ${key}`)
    if (packet.blocks.some(block => block.provenance.document_id === `paper:capacity-${key}`)) paperRecallCount += 1
  }
  for (const index of [0, 49, 99, 149, 199]) {
    const key = String(index + 1).padStart(3, '0')
    const before = performance.now()
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'method_experiment', workspace_area: 'implementation', workspace_tab: 'method', workspace_scope: 'implementation/method', query: `capacity-experiment-marker-${key}`, search_mode: 'bm25' })
    plannerLatencies.push(performance.now() - before)
    assert(packet.included_tokens <= packet.plan.token_budget - packet.plan.output_reserve, `experiment context budget exceeded for ${key}`)
    if (packet.blocks.some(block => block.provenance.document_id === `experiment:capacity-${key}/plan`)) experimentRecallCount += 1
  }
  const broad = await buildContextPacket({ project_id: projectId, purpose: 'literature', workspace_area: 'related_work', workspace_tab: 'literature', workspace_scope: 'related_work/literature', query: 'capacity paper marker', search_mode: 'bm25' })
  assert(broad.included_tokens <= broad.plan.token_budget - broad.plan.output_reserve, 'broad context exceeded its token budget')
  assert(new Set(broad.blocks.map(block => block.provenance.document_id).filter(Boolean)).size <= broad.plan.max_documents, 'planner exceeded max document count')

  const editedPath = pathInside(projectRoot(projectId), 'research', 'related-work', 'papers', 'capacity-050.md')
  const editedSource = readFileSync(editedPath, 'utf8').replace('capacity-paper-marker-050', 'capacity-paper-marker-050-local-edit')
  writeFileSync(editedPath, editedSource, 'utf8')
  const editStart = performance.now()
  const edited = await reconcileKnowledgeDocuments(projectId, 'test')
  const editReconcileMs = performance.now() - editStart
  assert(edited.documents.find(item => item.row.document_id === 'paper:capacity-050')?.changed === true, 'local edit was not registered')
  const editedRead = await readKnowledgeDocument(projectId, 'paper:capacity-050')
  assert(editedRead.source.includes('capacity-paper-marker-050-local-edit'), 'context source did not reflect local edit')
  const editedPacket = await buildContextPacket({ project_id: projectId, purpose: 'literature', workspace_area: 'related_work', workspace_tab: 'literature', workspace_scope: 'related_work/literature', query: 'capacity-paper-marker-050-local-edit', search_mode: 'bm25' })
  assert(editedPacket.blocks.some(block => block.provenance.document_id === 'paper:capacity-050' && block.content.includes('capacity-paper-marker-050-local-edit')), 'local search returned stale edited content')

  const sortedLatencies = [...plannerLatencies].sort((a, b) => a - b)
  const p95 = sortedLatencies[Math.min(sortedLatencies.length - 1, Math.ceil(sortedLatencies.length * 0.95) - 1)] || 0
  const durationMs = performance.now() - started
  const result = {
    status: paperRecallCount === 5 && experimentRecallCount === 5 ? 'passed' : 'failed',
    project_id: projectId,
    documents: { total: 702, paper_summaries: 100, experiment_plans: 200, run_results: 400 },
    runs_per_experiment: 2,
    recall: { paper_queries: 5, paper_hits: paperRecallCount, experiment_queries: 5, experiment_hits: experimentRecallCount },
    timing_ms: { first_reconcile: Math.round(firstReconcileMs), unchanged_reconcile: Math.round(secondReconcileMs), local_edit_reconcile: Math.round(editReconcileMs), planner_p95: Math.round(p95), total: Math.round(durationMs) },
    context_budget: { max_documents: broad.plan.max_documents, token_budget: broad.plan.token_budget, output_reserve: broad.plan.output_reserve, broad_included_tokens: broad.included_tokens, broad_document_count: new Set(broad.blocks.map(block => block.provenance.document_id).filter(Boolean)).size },
    semantic_remote: { status: 'not_run', reason: 'This capacity check deliberately uses the explicit local BM25 path; remote Supermemory recall is covered only by the real Supermemory acceptance script.' },
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
} finally {
  await database.query('DELETE FROM context_manifests WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM knowledge_index_entries WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM knowledge_index_generations WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM experiments WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM papers WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM idea_versions WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId]).catch(() => undefined)
  await database.query('DELETE FROM projects WHERE id=$1', [projectId]).catch(() => undefined)
  await database.close().catch(() => undefined)
  rmSync(runtimeDirectory, { recursive: true, force: true })
  rmSync(projectsDirectory, { recursive: true, force: true })
}
