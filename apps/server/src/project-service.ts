import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { gitBinary, pathInside, projectsRoot, repositoryRoot } from './paths.js'
import { audit, database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { reconcileProjectLineage } from './impact-service.js'
import { moveIntoProject, projectStagingPath } from './project-storage.js'
import { specFieldStatus } from './spec-field-status.js'

const PROJECT_GITIGNORE = `.venv/
artifacts/
experiments/runs/
logs/
source-bundles/
*.db
*.sqlite
*.bak
*.log
`
const defaultWorkflowTemplatePath = resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')

export async function moveSessionUploadsIntoProject(projectId: string, sessionId: string): Promise<void> {
  const files = await rows<{ id: string; relative_path: string }>('SELECT id,relative_path FROM uploaded_files WHERE session_id=$1 AND project_id=$2', [sessionId, projectId])
  for (const file of files) {
    if (!file.relative_path.startsWith('staging/')) continue
    const source = pathInside(projectStagingPath(sessionId), basename(file.relative_path))
    const destinationRelativePath = `uploads/${sessionId}/${basename(file.relative_path)}`
    moveIntoProject(projectId, source, destinationRelativePath)
    await database.query('UPDATE uploaded_files SET relative_path=$2 WHERE id=$1 AND project_id=$3', [file.id, `artifacts/${destinationRelativePath}`, projectId])
  }
}

export type ProjectRow = { id: string; slug: string; title: string; status: string; pinned: boolean; sidebar_order: number; current_idea_version: number; current_stage: string; created_at: string; updated_at: string }

export type ProjectSummaryRow = ProjectRow & {
  experiment_total: number
  experiment_running: number
  experiment_completed: number
  pending_approvals: number
  paper_count: number
  related_work_count: number
  paper_draft_count: number
}

export async function listProjectSummaries(status?: string): Promise<ProjectSummaryRow[]> {
  const where = status ? 'WHERE p.status=$1' : ''
  return rows<ProjectSummaryRow>(`
    SELECT p.*,
      (SELECT COUNT(*)::integer FROM experiments e WHERE e.project_id=p.id) AS experiment_total,
      (SELECT COUNT(*)::integer FROM experiments e WHERE e.project_id=p.id AND e.status='running') AS experiment_running,
      (SELECT COUNT(*)::integer FROM experiments e WHERE e.project_id=p.id AND e.status='completed') AS experiment_completed,
      (SELECT COUNT(*)::integer FROM proposals q WHERE q.project_id=p.id AND q.status='pending') AS pending_approvals,
      (SELECT COUNT(*)::integer FROM papers w WHERE w.project_id=p.id) AS paper_count,
      (SELECT COUNT(*)::integer FROM related_work_candidates r WHERE r.project_id=p.id) AS related_work_count,
      (SELECT COUNT(*)::integer FROM proposals pd WHERE pd.project_id=p.id AND pd.kind='code_patch' AND pd.payload->>'patch_kind'='latex') AS paper_draft_count
    FROM projects p
    ${where}
    ORDER BY p.pinned DESC,p.sidebar_order ASC,p.updated_at DESC,p.created_at DESC,p.id
  `, status ? [status] : [])
}

export async function reorderProjectGroup(projectIds: string[]): Promise<ProjectRow[]> {
  return database.transaction(async transaction => {
    const found = (await transaction.query<ProjectRow>('SELECT * FROM projects WHERE id=ANY($1::uuid[])', [projectIds])).rows
    if (found.length !== projectIds.length) throw new ApiError(422, 'project_order_scope_invalid', '项目排序列表必须只包含现有项目，且不能重复。')
    const pinnedGroups = new Set(found.map(project => project.pinned))
    if (pinnedGroups.size !== 1) throw new ApiError(422, 'project_order_group_mismatch', '项目排序只能调整同一置顶分组内的项目。')
    const byId = new Map(found.map(project => [project.id, project]))
    const pinned = found[0]?.pinned || false
    const existingGroup = (await transaction.query<ProjectRow>('SELECT * FROM projects WHERE pinned=$1 ORDER BY sidebar_order ASC,updated_at DESC,created_at DESC,id', [pinned])).rows
    const orderedIds = [...projectIds, ...existingGroup.filter(project => !byId.has(project.id)).map(project => project.id)]
    for (const [index, projectId] of orderedIds.entries()) {
      await transaction.query('UPDATE projects SET sidebar_order=$2 WHERE id=$1', [projectId, index])
    }
    return (await transaction.query<ProjectRow>('SELECT * FROM projects WHERE pinned=$1 ORDER BY sidebar_order ASC,updated_at DESC,created_at DESC,id', [pinned])).rows
  })
}

type ReportSourceSnapshot = {
  project_id?: unknown
  paper_ids?: unknown
  evidence_ids?: unknown
  experiment_ids?: unknown
  artifact_ids?: unknown
  proposal_ids?: unknown
  paragraph_sources?: unknown
}

type ReportRow = {
  id: string
  project_id: string
  period: string
  content: string
  status?: string
  source_snapshot?: ReportSourceSnapshot
  created_at?: string
}

function reportIds(value: unknown): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : []
}

async function validateReportLineage(projectId: string, reports: ReportRow[]): Promise<Array<ReportRow & { status: string; blocking_reason?: string | null; missing_source_ids?: string[] }>> {
  return Promise.all(reports.map(async report => {
    const snapshot = report.source_snapshot
    const sourceKeys: Array<keyof ReportSourceSnapshot> = ['paper_ids', 'evidence_ids', 'experiment_ids', 'artifact_ids', 'proposal_ids']
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length === 0) {
      return { ...report, status: 'legacy_unverified', blocking_reason: 'report_source_snapshot_missing', missing_source_ids: [] }
    }
    if (snapshot.project_id !== projectId) {
      return { ...report, status: 'blocked', blocking_reason: 'report_source_project_mismatch', missing_source_ids: [] }
    }
    if (!sourceKeys.every(key => Array.isArray(snapshot[key]))) {
      return { ...report, status: 'blocked', blocking_reason: 'report_source_snapshot_invalid', missing_source_ids: [] }
    }

    const sourceGroups: Array<{ label: string; table: 'papers' | 'evidence' | 'experiments' | 'artifacts' | 'proposals'; ids: string[]; validOnly?: boolean }> = [
      { label: 'paper', table: 'papers', ids: reportIds(snapshot.paper_ids) },
      { label: 'evidence', table: 'evidence', ids: reportIds(snapshot.evidence_ids) },
      { label: 'experiment', table: 'experiments', ids: reportIds(snapshot.experiment_ids) },
      { label: 'artifact', table: 'artifacts', ids: reportIds(snapshot.artifact_ids), validOnly: true },
      { label: 'proposal', table: 'proposals', ids: reportIds(snapshot.proposal_ids) },
    ]
    const missing: string[] = []
    for (const group of sourceGroups) {
      if (!group.ids.length) continue
      const placeholders = group.ids.map((_, index) => `$${index + 2}`).join(',')
      const validClause = group.validOnly ? ' AND valid=TRUE' : ''
      const existing = await rows<{ id: string }>(`SELECT id FROM ${group.table} WHERE project_id=$1${validClause} AND id IN (${placeholders})`, [projectId, ...group.ids])
      const existingIds = new Set(existing.map(item => item.id))
      for (const id of group.ids) if (!existingIds.has(id)) missing.push(`${group.label}:${id}`)
    }
    return missing.length
      ? { ...report, status: 'blocked', blocking_reason: 'report_source_missing_or_invalid', missing_source_ids: missing }
      : { ...report, status: 'valid', blocking_reason: null, missing_source_ids: [] }
  }))
}

export async function requireProject(projectId: string, active = false): Promise<ProjectRow> {
  const project = await one<ProjectRow>('SELECT * FROM projects WHERE id=$1', [projectId])
  if (!project) throw new ApiError(404, 'project_not_found', '项目不存在。')
  if (active && project.status !== 'active') throw new ApiError(409, 'project_not_active', '项目当前不可执行该操作。')
  return project
}

export async function createProjectWorkspace(projectId: string, slug: string, spec: object): Promise<string> {
  const root = pathInside(projectsRoot, projectId)
  if (existsSync(root)) throw new Error('project_workspace_exists')
  for (const directory of ['code', 'experiment', 'paper', 'literature', 'data', 'artifacts']) mkdirSync(pathInside(root, directory), { recursive: true })
  writeFileSync(pathInside(root, 'idea.json'), `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  writeFileSync(pathInside(root, 'README.md'), `# ${slug}\n\nResearch OS project workspace.\n`, 'utf8')
  writeFileSync(pathInside(root, '.gitignore'), PROJECT_GITIGNORE, 'utf8')
  writeFileSync(pathInside(root, 'workflow.ts'), readFileSync(defaultWorkflowTemplatePath, 'utf8'), 'utf8')
  execFileSync(gitBinary(), ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' })
  execFileSync(gitBinary(), ['add', 'idea.json', 'README.md', '.gitignore', 'workflow.ts'], { cwd: root, stdio: 'ignore' })
  execFileSync(gitBinary(), ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: initialize research project'], { cwd: root, stdio: 'ignore' })
  await audit('project.workspace_created', projectId, { slug })
  return root
}

export function ensureProjectGit(projectId: string): string {
  const root = pathInside(projectsRoot, projectId)
  if (!existsSync(root)) throw new ApiError(404, 'project_workspace_not_found', '项目代码工作区不存在。')
  const expectedGitDir = resolve(root, '.git')
  const gitignorePath = pathInside(root, '.gitignore')
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, PROJECT_GITIGNORE, 'utf8')
  if (existsSync(expectedGitDir)) {
    try {
      const actual = execFileSync(gitBinary(), ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim()
      if (resolve(actual) === expectedGitDir) {
        try {
          return execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
        } catch { /* fall through and create the initial commit */ }
      }
    } catch { /* fall through and reinitialize */ }
  }
  execFileSync(gitBinary(), ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' })
  execFileSync(gitBinary(), ['add', '--all'], { cwd: root, stdio: 'ignore' })
  try {
    execFileSync(gitBinary(), ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: adopt existing project workspace into project git'], { cwd: root, stdio: 'ignore' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('nothing to commit')) throw error
  }
  return execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

export async function projectDetail(projectId: string) {
  const project = await requireProject(projectId)
  const lineage = await reconcileProjectLineage(projectId)
  const [ideas, papers, evidence, repositories, proposals, experiments, artifacts, policies, reports, tasks, checkpoints, claimReviews, feedback, reproductions, reproductionRuns, relatedWorkSeeds, relatedWorkCandidates, relatedWorkRuns, relatedWorkAttempts, relatedWorkEdges, relatedWorkFieldProvenance, relatedWorkCandidateReviews, relatedWorkRunEvents, researchComparisons, researchComparisonCandidates, auditEvents] = await Promise.all([
    rows('SELECT * FROM idea_versions WHERE project_id=$1 ORDER BY version DESC', [projectId]),
    rows('SELECT * FROM papers WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM evidence WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM repositories WHERE project_id=$1 ORDER BY retrieved_at DESC', [projectId]),
    rows('SELECT * FROM proposals WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM experiments WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows(`SELECT a.*, e.status AS experiment_status, e.run_id AS experiment_run_id, e.finished_at AS experiment_finished_at,
      e.config AS experiment_config, e.proposal_id AS experiment_proposal_id
      FROM artifacts a LEFT JOIN experiments e ON e.id=a.experiment_id
      WHERE a.project_id=$1 ORDER BY a.created_at DESC`, [projectId]),
    rows('SELECT * FROM policies WHERE project_id=$1 AND active=TRUE ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM reports WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM tasks WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM checkpoints WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM claim_reviews WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM human_feedback WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM reproductions WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM reproduction_runs WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM related_work_seeds WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows(`SELECT c.*,COUNT(s.id)::integer AS source_count,
        COALESCE(ARRAY_AGG(DISTINCT r.match_method) FILTER (WHERE r.match_method IS NOT NULL), ARRAY[]::varchar[]) AS match_methods
      FROM related_work_candidates c
      LEFT JOIN related_work_candidate_sources s ON s.candidate_id=c.id
      LEFT JOIN related_work_seed_candidates r ON r.candidate_id=c.id
      WHERE c.project_id=$1 GROUP BY c.id ORDER BY c.updated_at DESC`, [projectId]),
    rows('SELECT * FROM related_work_recursive_runs WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM related_work_source_attempts WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows(`SELECT e.*,s.title AS source_title,t.title AS target_title
      FROM related_work_citation_edges e
      JOIN related_work_candidates s ON s.id=e.source_candidate_id
      JOIN related_work_candidates t ON t.id=e.target_candidate_id
      WHERE e.project_id=$1 ORDER BY e.created_at DESC`, [projectId]),
    rows('SELECT * FROM related_work_field_provenance WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM related_work_candidate_reviews WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM related_work_run_events WHERE project_id=$1 ORDER BY created_at,id', [projectId]),
    rows('SELECT * FROM research_comparisons WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM research_comparison_candidates WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT id,project_id,actor,action,details,created_at FROM audit_events WHERE project_id=$1 ORDER BY created_at DESC LIMIT 300', [projectId]),
  ])
  const session = await one<{ id: string }>('SELECT id FROM conversation_sessions WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 1', [projectId])
  const currentSpec = (ideas[0] as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | null | undefined
  const repositoryRows = repositories as Array<Record<string, unknown>>
  const evidenceRows = evidence as Array<Record<string, unknown>>
  const paperRows = (papers as Array<Record<string, unknown>>).map(paper => ({
    ...paper,
    ...((paper.metadata || {}) as Record<string, unknown>),
    fulltext_evidence_count: evidenceRows.filter(item => item.paper_id === paper.id).length,
    code_repositories: repositoryRows.filter(item => item.paper_id === paper.id),
  }))
  const artifactRows = (artifacts as Array<Record<string, unknown>>).map(artifact => ({
    ...artifact,
    experiment_status: artifact.experiment_status ?? null,
    run_id: artifact.experiment_run_id ?? null,
    experiment_finished_at: artifact.experiment_finished_at ?? null,
    proposal_id: artifact.experiment_proposal_id ?? null,
    experiment_config: artifact.experiment_config ?? null,
    metadata: {
      ...((artifact.metadata || {}) as Record<string, unknown>),
      lineage: {
        experiment_id: artifact.experiment_id ?? null,
        run_id: artifact.experiment_run_id ?? null,
        proposal_id: artifact.experiment_proposal_id ?? null,
        experiment_status: artifact.experiment_status ?? null,
        experiment_config: artifact.experiment_config ?? null,
        idea_version: ((artifact.metadata || {}) as Record<string, unknown>).idea_version ?? null,
        data_version: ((artifact.metadata || {}) as Record<string, unknown>).data_version ?? null,
        git_commit: ((artifact.metadata || {}) as Record<string, unknown>).git_commit ?? null,
      },
    },
    preview_url: `/api/projects/${projectId}/artifacts/${artifact.id}/preview`,
    download_url: `/api/projects/${projectId}/artifacts/${artifact.id}/download`,
    url: `/api/projects/${projectId}/artifacts/${artifact.id}/download`,
  }))
  const reportRows = await validateReportLineage(projectId, reports as ReportRow[])
  return {
    ...project,
    session_id: session?.id ?? null,
    spec: currentSpec ?? null,
    spec_field_status: specFieldStatus(currentSpec, ideas as Array<Record<string, unknown>>),
    idea_versions: ideas,
    papers: paperRows,
    evidence: evidenceRows,
    repositories: repositoryRows,
    proposals,
    experiments,
    artifacts: artifactRows,
    policies,
    reports: reportRows,
    tasks,
    checkpoints,
    claim_reviews: claimReviews,
    feedback,
    reproductions,
    reproduction_runs: reproductionRuns,
    related_work_seeds: relatedWorkSeeds,
    related_work_candidates: relatedWorkCandidates,
    related_work_runs: relatedWorkRuns,
    related_work_attempts: relatedWorkAttempts,
    related_work_edges: relatedWorkEdges,
    related_work_field_provenance: relatedWorkFieldProvenance,
    related_work_candidate_reviews: relatedWorkCandidateReviews,
    related_work_run_events: relatedWorkRunEvents,
    research_comparisons: (researchComparisons as Array<Record<string, unknown>>).map(comparison => ({
      ...comparison,
      candidates: (researchComparisonCandidates as Array<Record<string, unknown>>).filter(candidate => candidate.comparison_id === comparison.id),
    })),
    audit_events: auditEvents,
    lineage,
  }
}

export async function enqueue(projectId: string, kind: string, payload: object, idempotencyKey: string) {
  const id = crypto.randomUUID()
  await database.query("INSERT INTO tasks(id,project_id,kind,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING", [id, projectId, kind, payload, idempotencyKey])
  return one<{ id: string }>('SELECT id FROM tasks WHERE idempotency_key=$1', [idempotencyKey])
}
