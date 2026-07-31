import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathInside, projectsRoot } from './paths.js'
import { audit, database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { reconcileProjectLineage } from './impact-service.js'

export type ProjectRow = { id: string; slug: string; title: string; status: string; current_idea_version: number; current_stage: string; created_at: string; updated_at: string }

export async function requireProject(projectId: string, active = false): Promise<ProjectRow> {
  const project = await one<ProjectRow>('SELECT * FROM projects WHERE id=$1', [projectId])
  if (!project) throw new ApiError(404, 'project_not_found', '项目不存在。')
  if (active && project.status !== 'active') throw new ApiError(409, 'project_not_active', '项目当前不可执行该操作。')
  return project
}

export async function createProjectWorkspace(projectId: string, slug: string, spec: object): Promise<string> {
  const root = pathInside(projectsRoot, projectId)
  if (existsSync(root)) throw new Error('project_workspace_exists')
  for (const directory of ['experiment', 'paper', 'literature', 'data', 'artifacts']) mkdirSync(pathInside(root, directory), { recursive: true })
  writeFileSync(pathInside(root, 'idea.json'), `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  writeFileSync(pathInside(root, 'README.md'), `# ${slug}\n\nResearch OS project workspace.\n`, 'utf8')
  execFileSync('git.exe', ['init', '--initial-branch=main'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  execFileSync('git.exe', ['add', 'idea.json', 'README.md'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  execFileSync('git.exe', ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: initialize research project'], { cwd: root, windowsHide: true, stdio: 'ignore' })
  await audit('project.workspace_created', projectId, { slug })
  return root
}

export async function projectDetail(projectId: string) {
  const project = await requireProject(projectId)
  const lineage = await reconcileProjectLineage(projectId)
  const [ideas, papers, evidence, repositories, proposals, experiments, artifacts, policies, reports, tasks, checkpoints] = await Promise.all([
    rows('SELECT * FROM idea_versions WHERE project_id=$1 ORDER BY version DESC', [projectId]),
    rows('SELECT * FROM papers WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM evidence WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM repositories WHERE project_id=$1 ORDER BY retrieved_at DESC', [projectId]),
    rows('SELECT * FROM proposals WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM experiments WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM artifacts WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM policies WHERE project_id=$1 AND active=TRUE ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM reports WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM tasks WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    rows('SELECT * FROM checkpoints WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
  ])
  const session = await one<{ id: string }>('SELECT id FROM conversation_sessions WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 1', [projectId])
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
    preview_url: `/api/projects/${projectId}/artifacts/${artifact.id}/preview`,
    download_url: `/api/projects/${projectId}/artifacts/${artifact.id}/download`,
    url: `/api/projects/${projectId}/artifacts/${artifact.id}/download`,
  }))
  return {
    ...project,
    session_id: session?.id ?? null,
    spec: (ideas[0] as Record<string, unknown> | undefined)?.spec ?? null,
    idea_versions: ideas,
    papers: paperRows,
    evidence: evidenceRows,
    repositories: repositoryRows,
    proposals,
    experiments,
    artifacts: artifactRows,
    policies,
    reports,
    tasks,
    checkpoints,
    lineage,
  }
}

export async function enqueue(projectId: string, kind: string, payload: object, idempotencyKey: string) {
  const id = crypto.randomUUID()
  await database.query("INSERT INTO tasks(id,project_id,kind,payload,idempotency_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING", [id, projectId, kind, payload, idempotencyKey])
  return one<{ id: string }>('SELECT id FROM tasks WHERE idempotency_key=$1', [idempotencyKey])
}
