import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { repositoryRoot } from './idea-case-loader.js'

const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const tempRuntime = resolve(repositoryRoot, `runtime/related-work-restart-${Date.now()}`)
process.env.RESEARCH_RUNTIME_DIR = tempRuntime
mkdirSync(tempRuntime, { recursive: true })

const projectId = randomUUID()
const proposalId = randomUUID()
const runId = randomUUID()
const slug = `restart-${randomUUID().slice(0, 8)}`
let firstServer: ChildProcess | null = null
let secondServer: ChildProcess | null = null

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('free port lookup failed'))
        return
      }
      const port = address.port
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Server may still be starting.
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250))
  }
  throw new Error(`server did not become healthy on port ${port}`)
}

function startServer(port: number): ChildProcess {
  const child = spawn('node', ['--use-env-proxy', 'dist/index.js'], {
    cwd: resolve(repositoryRoot, 'apps/server'),
    env: {
      ...process.env,
      RESEARCH_RUNTIME_DIR: tempRuntime,
      RESEARCH_API_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  child.once('exit', () => {
    if (child.exitCode !== 0) console.error(output.trim())
  })
  return child
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise(resolveTimeout => setTimeout(resolveTimeout, 8_000))])
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250))
}

async function readRunStatus(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/${slug}`)
  if (!response.ok) throw new Error(`project detail failed with ${response.status}`)
  const detail = await response.json() as { related_work_runs?: Array<{ id: string; status: string; error: string | null }> }
  const runs = detail.related_work_runs || []
  if (runs.length !== 1 || !runs[0]) throw new Error(`expected one related-work run, got ${runs.length}`)
  return runs[0]
}

try {
  const { database, migrate } = await import('../apps/server/src/database.js')
  await migrate()
  await database.query(
    `INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)`,
    [projectId, slug, 'Related Work Restart Acceptance'],
  )
  await database.query(
    `INSERT INTO proposals(id,project_id,kind,status,reason,summary,payload)
     VALUES ($1,$2,'related_work_recursive','approved','restart acceptance','restart acceptance',$3)`,
    [proposalId, projectId, { seed_ids: [], depth: 1, width: 1, max_total: 1, providers: [] }],
  )
  await database.query(
    `INSERT INTO related_work_recursive_runs
     (id,project_id,proposal_id,seed_ids,providers,depth,width,max_total,status,cancel_requested,started_at,finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',TRUE,NULL,NULL)`,
    [runId, projectId, proposalId, [], [], 1, 1, 1],
  )
  await database.close()

  const port = await findFreePort()
  firstServer = startServer(port)
  await waitForHealth(port)
  const beforeRestart = await readRunStatus(port)
  if (beforeRestart.status !== 'queued' || beforeRestart.id !== runId) {
    throw new Error(`first process run state mismatch: ${JSON.stringify(beforeRestart)}`)
  }
  await stopServer(firstServer)
  firstServer = null

  secondServer = startServer(port)
  await waitForHealth(port)
  const afterRestart = await readRunStatus(port)
  if (afterRestart.status !== 'queued' || afterRestart.id !== runId || afterRestart.error !== null) {
    throw new Error(`restarted process run state mismatch: ${JSON.stringify(afterRestart)}`)
  }
  console.log(JSON.stringify({
    status: 'passed',
    project_id: projectId,
    slug,
    run_id: runId,
    port,
    before_restart: beforeRestart,
    after_restart: afterRestart,
    runtime_dir: tempRuntime,
  }, null, 2))
} finally {
  if (firstServer) await stopServer(firstServer)
  if (secondServer) await stopServer(secondServer)
  rmSync(tempRuntime, { recursive: true, force: true })
}
