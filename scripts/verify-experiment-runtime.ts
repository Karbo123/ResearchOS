import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { repositoryRoot } from './idea-case-loader.js'

const checkId = crypto.randomUUID()
process.env.RESEARCH_RUNTIME_DIR = `runtime/experiment-check-${checkId}`
const runtimeDirectory = resolve(repositoryRoot, process.env.RESEARCH_RUNTIME_DIR)

const { experimentRequest } = await import('../apps/server/src/contracts.js')
const { database, migrate } = await import('../apps/server/src/database.js')
const { cancelRun, submitRun } = await import('../apps/server/src/experiment-runner.js')
const { buildArtifactPreview } = await import('../apps/server/src/artifact-preview-service.js')
const { artifactsRoot, projectsRoot } = await import('../apps/server/src/paths.js')

const projectIds = [crypto.randomUUID(), crypto.randomUUID()]
const runIds = [crypto.randomUUID(), crypto.randomUUID()]
const proposalIds = [crypto.randomUUID(), crypto.randomUUID()]
const projectDirectories = projectIds.map(id => resolve(projectsRoot, id))
const runDirectories = runIds.map(id => resolve(artifactsRoot, 'runs', id))

async function runStatus(runId: string): Promise<{ status: string; metrics: Record<string, number>; error: string | null }> {
  const result = await database.query<{ status: string; metrics: Record<string, number>; error: string | null }>('SELECT status,metrics,error FROM experiments WHERE id=$1', [runId])
  const row = result.rows[0]
  if (!row) throw new Error(`experiment row missing: ${runId}`)
  return row
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== null) return value
    await delay(100)
  }
  throw new Error('experiment integration check timed out')
}

async function processExists(pid: number): Promise<boolean> {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const child = spawn('tasklist.exe', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  await once(child, 'exit')
  return output.split(/\r?\n/).some(line => line.includes(`,"${pid}",`))
}

try {
  await migrate()
  for (let index = 0; index < projectIds.length; index += 1) {
    const projectId = projectIds[index]!
    const proposalId = proposalIds[index]!
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `runtime-check-${index}-${checkId.slice(0, 8)}`, `Runtime check ${index}`])
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec,change_reason) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), projectId, 1, { schema_version: '1.0', idea: { title: `Runtime check ${index}`, research_question: 'Verify the native experiment contract and artifact lineage.' } }, 'test fixture'])
    await database.query("INSERT INTO proposals(id,project_id,kind,status,reason,summary,payload) VALUES ($1,$2,'experiment_plan','approved',$3,$4,$5)", [proposalId, projectId, 'Native experiment integration check', 'Approved test-only scientific experiment', {}])
    mkdirSync(resolve(projectDirectories[index]!, 'experiment'), { recursive: true })
  }

  const successSource = [
    'import json, pathlib, sys',
    'output = pathlib.Path(sys.argv[2])',
    'output.mkdir(parents=True, exist_ok=True)',
    '(output / "metrics.json").write_text(json.dumps({"accuracy": 0.875, "loss": 0.25}), encoding="utf-8")',
    '(output / "metrics.jsonl").write_text("\\n".join(json.dumps(item) for item in [{"step": 1, "unit": "epoch", "seed": 13, "loss": 0.4, "accuracy": 0.75}, {"step": 2, "unit": "epoch", "seed": 13, "loss": 0.25, "accuracy": 0.875}]) + "\\n", encoding="utf-8")',
    '(output / "checkpoint.json").write_text(json.dumps({"stage": "complete", "samples": 8}), encoding="utf-8")',
    '(output / "preview.ply").write_text("ply\\nformat ascii 1.0\\nelement vertex 3\\nproperty float x\\nproperty float y\\nproperty float z\\nend_header\\n0 0 0\\n1 0 0\\n0 1 0\\n", encoding="ascii")',
  ].join('\n')
  writeFileSync(resolve(projectDirectories[0]!, 'experiment', 'main.py'), `${successSource}\n`, 'utf8')
  const successRequest = experimentRequest.parse({
    project_id: projectIds[0], proposal_id: proposalIds[0], experiment_type: 'python_analysis',
    execution_backend: process.platform === 'win32' ? 'windows' : 'linux', config: { entrypoint: 'experiment/main.py' }, random_seeds: [13],
  })
  await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,config,run_id) VALUES ($1,$2,$3,$4,$5,$6)', [runIds[0], projectIds[0], proposalIds[0], successRequest.experiment_type, successRequest.config, runIds[0]])
  const successCompletion = submitRun(runIds[0]!, successRequest)
  const success = await waitFor(async () => {
    const row = await runStatus(runIds[0]!)
    return ['succeeded', 'failed'].includes(row.status) ? row : null
  })
  if (success.status !== 'succeeded') {
    const logPath = resolve(runDirectories[0]!, 'run.log')
    const logTail = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-2000) : 'run.log missing'
    throw new Error(`successful experiment failed: ${success.error || 'unknown'}\n${logTail}`)
  }
  if (success.metrics.accuracy !== 0.875 || success.metrics.loss !== 0.25) throw new Error('experiment metrics were not persisted')
  for (const name of ['metrics.json', 'metrics.jsonl', 'checkpoint.json', 'preview.ply']) {
    const path = resolve(runDirectories[0]!, name)
    if (!existsSync(path) || readFileSync(path).length === 0) throw new Error(`required artifact missing: ${name}`)
  }
  const metricsPreview = buildArtifactPreview(resolve(runDirectories[0]!, 'metrics.jsonl'), 'metrics.jsonl', 'application/x-ndjson', '/download')
  if (metricsPreview.type !== 'timeseries' || metricsPreview.point_count !== 2 || !/^[0-9a-f]{64}$/.test(String(metricsPreview.sha256))) throw new Error('metrics.jsonl artifact preview contract failed')
  const plyPreview = buildArtifactPreview(resolve(runDirectories[0]!, 'preview.ply'), 'preview.ply', 'model/ply', '/download')
  if (plyPreview.type !== 'point_cloud' || plyPreview.source_point_count !== 3) throw new Error('PLY artifact preview contract failed')
  const artifactRows = await database.query<{ sha256: string }>('SELECT sha256 FROM artifacts WHERE experiment_id=$1', [runIds[0]])
  if (artifactRows.rows.length < 4 || artifactRows.rows.some(row => !/^[0-9a-f]{64}$/.test(row.sha256))) throw new Error('artifact SHA-256 ledger is incomplete')

  const cancellationSource = [
    'import pathlib, subprocess, sys, time',
    'output = pathlib.Path(sys.argv[2])',
    'output.mkdir(parents=True, exist_ok=True)',
    'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])',
    '(output / "child.pid").write_text(str(child.pid), encoding="ascii")',
    'time.sleep(300)',
  ].join('\n')
  writeFileSync(resolve(projectDirectories[1]!, 'experiment', 'cancel.py'), `${cancellationSource}\n`, 'utf8')
  const cancellationRequest = experimentRequest.parse({
    project_id: projectIds[1], proposal_id: proposalIds[1], experiment_type: 'python_analysis',
    execution_backend: process.platform === 'win32' ? 'windows' : 'linux', config: { entrypoint: 'experiment/cancel.py' }, random_seeds: [13],
  })
  await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,config,run_id) VALUES ($1,$2,$3,$4,$5,$6)', [runIds[1], projectIds[1], proposalIds[1], cancellationRequest.experiment_type, cancellationRequest.config, runIds[1]])
  const cancellationCompletion = submitRun(runIds[1]!, cancellationRequest)
  const childPid = await waitFor(async () => {
    const path = resolve(runDirectories[1]!, 'child.pid')
    if (!existsSync(path)) return null
    const value = Number(readFileSync(path, 'ascii').trim())
    return Number.isInteger(value) && value > 0 ? value : null
  })
  if (!(await cancelRun(runIds[1]!))) throw new Error('active experiment cancellation was not accepted')
  const cancelled = await runStatus(runIds[1]!)
  if (cancelled.status !== 'cancelled') throw new Error(`cancelled experiment has status ${cancelled.status}`)
  await waitFor(async () => await processExists(childPid) ? null : true, 15_000)
  await cancellationCompletion
  await successCompletion

  const venvInterpreter = (project: string) => process.platform === 'win32'
    ? resolve(project, '.venv', 'Scripts', 'python.exe')
    : resolve(project, '.venv', 'bin', 'python')
  console.log(JSON.stringify({
    status: 'passed', per_project_venv: projectDirectories.every(project => existsSync(venvInterpreter(project))),
    successful_metrics: success.metrics, artifact_sha256_records: artifactRows.rows.length, metrics_preview: { type: metricsPreview.type, point_count: metricsPreview.point_count },
    process_tree_cancelled: true, generated_python_removed_after_check: true,
  }, null, 2))
} finally {
  await database.close()
  for (const path of [...projectDirectories, ...runDirectories, runtimeDirectory]) rmSync(path, { recursive: true, force: true })
}
