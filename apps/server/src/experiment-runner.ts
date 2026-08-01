import { createHash } from 'node:crypto'
import { ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { once } from 'node:events'
import type { z } from 'zod'
import { database, audit, one } from './database.js'
import type { experimentRequest } from './contracts.js'
import { ApiError } from './http.js'
import { artifactsRoot, gitBinary, pathInside, projectsRoot } from './paths.js'
import { fingerprintValue, registerLineageDependencies, type LineageNode } from './impact-service.js'
import { artifactMimeType, MetricsValidationError, parseMetricsJsonl, type MetricsSeries } from './metrics-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'

type ExperimentRequest = z.infer<typeof experimentRequest>
type RunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
type ActiveRun = { child: ChildProcess; state: RunState; timeout: NodeJS.Timeout }
const activeRuns = new Map<string, ActiveRun>()
const entrypointPattern = /^experiment\/[A-Za-z0-9_.-]+\.py$/

function safeEnvironment(venv?: string): NodeJS.ProcessEnv {
  if (process.platform === 'win32') {
    const path = [venv ? resolve(venv, 'Scripts') : '', process.env.SystemRoot ? resolve(process.env.SystemRoot, 'System32') : '', process.env.PATH || ''].filter(Boolean).join(';')
    return { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: path, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' }
  }
  const path = [venv ? resolve(venv, 'bin') : '', process.env.PATH || ''].filter(Boolean).join(':')
  return { PATH: path, TEMP: process.env.TEMP, TMP: process.env.TMP, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' }
}

async function runFixed(executable: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: 'ignore' })
  const [code] = await once(child, 'exit') as [number | null]
  if (code !== 0) throw new Error(`fixed_process_failed:${basename(executable)}:${code ?? 'signal'}`)
}

export async function ensureWindowsVenv(projectRoot: string): Promise<string> {
  const venv = pathInside(projectRoot, '.venv')
  const python = resolve(venv, 'Scripts', 'python.exe')
  if (existsSync(python)) return venv
  const configuredPython = process.env.RESEARCH_PYTHON_EXECUTABLE || 'python.exe'
  await runFixed(configuredPython, ['-m', 'venv', venv], { cwd: projectRoot, env: safeEnvironment() })
  if (!existsSync(python)) throw new Error('project_venv_creation_failed')
  return venv
}

export async function ensureLinuxVenv(projectRoot: string): Promise<string> {
  const venv = pathInside(projectRoot, '.venv')
  const python = resolve(venv, 'bin', 'python')
  if (existsSync(python)) return venv
  const configuredPython = process.env.RESEARCH_PYTHON_EXECUTABLE || 'python3'
  await runFixed(configuredPython, ['-m', 'venv', venv], { cwd: projectRoot, env: safeEnvironment() })
  if (!existsSync(python)) throw new Error('project_venv_creation_failed')
  return venv
}

function windowsToWsl(path: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(resolve(path))
  if (!match) throw new Error('wsl_path_conversion_failed')
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll('\\', '/')}`
}

async function ensureWslVenv(projectRoot: string): Promise<string> {
  const root = windowsToWsl(projectRoot)
  const venv = `${root}/.venv`
  await runFixed('wsl.exe', ['--exec', 'sh', '-lc', 'test -x "$1/.venv/bin/python" || python3 -m venv "$1/.venv"', 'research-os', root], { cwd: projectRoot, env: safeEnvironment() })
  return venv
}

// The execution backend must match the host the server runs on. On a WSL2/Linux
// host the native `linux` backend is the only supported execution path; the
// legacy `windows`/`wsl2` backends require a Windows host and fail closed here.
export function assertBackendSupported(backend: string): void {
  if (process.platform === 'win32') {
    if (backend !== 'windows' && backend !== 'wsl2') {
      throw new ApiError(400, 'execution_backend_unsupported', 'linux 后端只能在 WSL2/Linux 宿主上使用；Windows 宿主请使用 windows 或 wsl2 后端。')
    }
    return
  }
  if (backend === 'windows' || backend === 'wsl2') {
    throw new ApiError(400, 'execution_backend_unsupported', 'windows/wsl2 后端只能在 Windows 宿主上使用；WSL2/Linux 宿主请使用 linux 后端。')
  }
}

export async function ensureVenv(projectRoot: string, backend: string): Promise<string> {
  assertBackendSupported(backend)
  if (backend === 'linux') return ensureLinuxVenv(projectRoot)
  if (backend === 'wsl2') return ensureWslVenv(projectRoot)
  return ensureWindowsVenv(projectRoot)
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function collectFiles(root: string, current = root): string[] {
  const result: string[] = []
  for (const name of readdirSync(current)) {
    const path = resolve(current, name)
    const info = statSync(path)
    if (info.isSymbolicLink()) throw new Error('artifact_symlink_forbidden')
    if (info.isDirectory()) result.push(...collectFiles(root, path))
    else if (info.isFile()) result.push(path)
  }
  return result
}

function readValidatedResults(runDirectory: string): { metrics: Record<string, number>; checkpoint: Record<string, unknown>; metricsSeries: MetricsSeries | null } {
  const metricsPath = resolve(runDirectory, 'metrics.json')
  const checkpointPath = resolve(runDirectory, 'checkpoint.json')
  if (!existsSync(metricsPath) || !existsSync(checkpointPath)) throw new Error('required_experiment_outputs_missing')
  const metrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<string, unknown>
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Record<string, unknown>
  if (!metrics || Array.isArray(metrics) || Object.values(metrics).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('metrics_must_be_finite_numbers')
  if (!checkpoint || Array.isArray(checkpoint)) throw new Error('checkpoint_must_be_an_object')
  const metricsJsonlPath = resolve(runDirectory, 'metrics.jsonl')
  const metricsSeries = existsSync(metricsJsonlPath) ? parseMetricsJsonl(metricsJsonlPath) : null
  return { metrics: metrics as Record<string, number>, checkpoint, metricsSeries }
}

function spawnExperiment(request: ExperimentRequest, projectRoot: string, runDirectory: string, venv: string): ChildProcess {
  const entrypoint = String(request.config.entrypoint || 'experiment/main.py')
  if (!entrypointPattern.test(entrypoint)) throw new Error('invalid_experiment_entrypoint')
  const entryPath = pathInside(projectRoot, ...entrypoint.split('/'))
  if (!existsSync(entryPath)) throw new Error('experiment_entrypoint_missing')
  const planPath = resolve(runDirectory, 'plan.json')
  writeFileSync(planPath, `${JSON.stringify({ plan: request.topic_plan ?? null, resume: request.topic_resume ?? null, random_seeds: request.random_seeds }, null, 2)}\n`)
  const outputLog = resolve(runDirectory, 'run.log')
  if (request.execution_backend === 'linux') {
    const python = resolve(venv, 'bin', 'python')
    if (!existsSync(python)) throw new Error('project_venv_python_missing')
    const child = spawn(python, [entryPath, planPath, runDirectory], {
      cwd: projectRoot, env: safeEnvironment(venv), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    attachRunLog(child, outputLog)
    return child
  }
  if (request.execution_backend === 'wsl2') {
    const args = ['--exec', `${venv}/bin/python`, windowsToWsl(entryPath), windowsToWsl(planPath), windowsToWsl(runDirectory)]
    return spawn('wsl.exe', args, { cwd: projectRoot, env: safeEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  const python = resolve(venv, 'Scripts', 'python.exe')
  const command = `""${python}" "${entryPath}" "${planPath}" "${runDirectory}""`
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: projectRoot, env: safeEnvironment(venv), windowsHide: true, windowsVerbatimArguments: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  attachRunLog(child, outputLog)
  return child
}

function attachRunLog(child: ChildProcess, outputLog: string): void {
  let logBytes = 0
  const append = (chunk: Buffer) => {
    if (logBytes >= 5 * 1024 * 1024) return
    const bounded = chunk.subarray(0, 5 * 1024 * 1024 - logBytes)
    logBytes += bounded.length
    writeFileSync(outputLog, bounded, { flag: 'a' })
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
}

function spawnLatex(projectRoot: string, runDirectory: string): ChildProcess {
  const source = pathInside(projectRoot, 'paper', 'main.tex')
  if (!existsSync(source)) throw new Error('paper_source_missing')
  const latexmk = process.platform === 'win32' ? 'latexmk.exe' : 'latexmk'
  return spawn(latexmk, ['-pdf', '-interaction=nonstopmode', '-halt-on-error', `-outdir=${runDirectory}`, source], {
    cwd: pathInside(projectRoot, 'paper'), env: safeEnvironment(), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function terminateTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    await once(killer, 'exit')
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch { /* process already exited */ }
  }
}

async function execute(runId: string, request: ExperimentRequest): Promise<void> {
  const projectRoot = pathInside(projectsRoot, request.project_id)
  const runDirectory = pathInside(artifactsRoot, 'runs', runId)
  mkdirSync(runDirectory, { recursive: true })
  try {
    await database.query("UPDATE experiments SET status='running', run_id=$2 WHERE id=$1", [runId, runId])
    const child = request.experiment_type === 'compile_latex'
      ? spawnLatex(projectRoot, runDirectory)
      : spawnExperiment(request, projectRoot, runDirectory, await ensureVenv(projectRoot, request.execution_backend))
    const timeout = setTimeout(() => void terminateTree(child), Number(process.env.EXPERIMENT_TIMEOUT_SECONDS || 3600) * 1000)
    activeRuns.set(runId, { child, state: 'running', timeout })
    const [exitCode] = await once(child, 'exit') as [number | null]
    clearTimeout(timeout)
    const active = activeRuns.get(runId)
    activeRuns.delete(runId)
    if (active?.state === 'cancelled') return
    if (exitCode !== 0) throw new Error(`experiment_process_failed:${exitCode ?? 'signal'}`)
    if (request.experiment_type === 'compile_latex') {
      writeFileSync(resolve(runDirectory, 'metrics.json'), '{"compiled":1}\n')
      writeFileSync(resolve(runDirectory, 'checkpoint.json'), `${JSON.stringify({ source: 'paper/main.tex', backend: request.execution_backend })}\n`)
    }
    const { metrics, checkpoint, metricsSeries } = readValidatedResults(runDirectory)
    await database.query("UPDATE experiments SET status='succeeded', metrics=$2, finished_at=NOW() WHERE id=$1", [runId, metrics])
    const artifactIds: string[] = []
    for (const file of collectFiles(runDirectory)) {
      const relativePath = relative(artifactsRoot, file).replaceAll('\\', '/')
      const artifactId = crypto.randomUUID()
      artifactIds.push(artifactId)
      const name = basename(file)
      await database.query('INSERT INTO artifacts(id,project_id,experiment_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [artifactId, request.project_id, runId, 'experiment_output', name, relativePath, artifactMimeType(name), hashFile(file), {
        backend: request.execution_backend,
        ...(name === 'metrics.jsonl' && metricsSeries ? {
          metrics_series: { points: metricsSeries.points.length, bytes: metricsSeries.bytes, sha256: metricsSeries.sha256, seeds: metricsSeries.seeds, units: metricsSeries.units },
        } : {}),
      }])
    }
    if (supermemoryEnabled()) {
      await ingestProjectMemory(request.project_id, {
        source_type: 'experiment_summary',
        source_id: runId,
        artifact_id: null,
        uploaded_file_id: null,
        content: `Experiment ${runId} completed with metrics ${JSON.stringify(metrics)}. Controlled artifacts: ${artifactIds.join(', ')}. This is an integration result and not a scientific conclusion.`,
        source_url: null,
        quote: null,
        locator: null,
        metadata: { experiment_id: runId, artifact_ids: artifactIds, evidence_status: 'integration_result_requires_review' },
        task_type: 'memory',
        idempotency_key: `experiment-summary:${runId}`,
      })
    }
    const ideaVersionNumber = typeof request.topic_plan?.idea_version === 'number' ? request.topic_plan.idea_version : null
    const ideaVersion = ideaVersionNumber === null
      ? await one<{ id: string; version: number }>('SELECT id,version FROM idea_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [request.project_id])
      : await one<{ id: string; version: number }>('SELECT id,version FROM idea_versions WHERE project_id=$1 AND version=$2', [request.project_id, ideaVersionNumber])
    if (!ideaVersion) throw new Error('experiment_idea_version_missing')
    const gitCommit = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: projectRoot, windowsHide: true, encoding: 'utf8' }).trim()
    const configFingerprint = fingerprintValue({ experiment_type: request.experiment_type, config: request.config, execution_backend: request.execution_backend, random_seeds: request.random_seeds, topic_plan: request.topic_plan })
    const upstream: LineageNode[] = [
      { type: 'idea_version', id: ideaVersion.id },
      { type: 'git_commit', id: gitCommit },
      { type: 'config', id: configFingerprint },
    ]
    const topicPlan = request.topic_plan || {}
    for (const key of ['paper_ids', 'evidence_ids', 'repository_ids', 'uploaded_file_ids']) {
      const type = key.replace(/_ids$/, '') as LineageNode['type']
      const values = Array.isArray(topicPlan[key]) ? topicPlan[key] : []
      for (const value of values) if (typeof value === 'string') upstream.push({ type, id: value })
    }
    const experimentDependencies = await registerLineageDependencies(request.project_id, upstream.map(item => ({ downstream: { type: 'experiment', id: runId }, upstream: item, relation: 'experiment_input' })))
    const checkpointId = crypto.randomUUID()
    await database.query('INSERT INTO checkpoints(id,project_id,stage,idea_version,git_commit,data_version,state) VALUES ($1,$2,$3,$4,$5,$6,$7)', [checkpointId, request.project_id, 'experiment_succeeded', ideaVersion.version, gitCommit, typeof request.config.data_version === 'string' ? request.config.data_version : null, { ...checkpoint, source_run_id: runId, artifact_ids: artifactIds, lineage_dependencies: experimentDependencies }])
    await registerLineageDependencies(request.project_id, [
      ...upstream.map(item => ({ downstream: { type: 'checkpoint' as const, id: checkpointId }, upstream: item, relation: 'checkpoint_input' })),
      { downstream: { type: 'checkpoint', id: checkpointId }, upstream: { type: 'experiment', id: runId }, relation: 'checkpoint_source_run' },
    ])
    await audit('experiment.succeeded', request.project_id, { run_id: runId, backend: request.execution_backend })
  } catch (error) {
    activeRuns.delete(runId)
    const message = error instanceof MetricsValidationError ? error.code : error instanceof Error ? error.message : 'experiment_failed'
    await database.query("UPDATE experiments SET status='failed', error=$2, finished_at=NOW() WHERE id=$1", [runId, message])
    await audit('experiment.failed', request.project_id, { run_id: runId, code: message })
  }
}

export function submitRun(runId: string, request: ExperimentRequest): Promise<void> {
  return execute(runId, request)
}

export async function cancelRun(runId: string): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (!active) return false
  active.state = 'cancelled'
  clearTimeout(active.timeout)
  await terminateTree(active.child)
  activeRuns.delete(runId)
  await database.query("UPDATE experiments SET status='cancelled', finished_at=NOW() WHERE id=$1", [runId])
  return true
}
