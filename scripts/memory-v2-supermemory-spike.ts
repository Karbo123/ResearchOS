import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Supermemory } from 'supermemory'

const repositoryRoot = resolve(import.meta.dirname, '..')
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
const runToken = `${Date.now().toString(36)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 6)}`
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 4)
const projectFull = `memory-full-${suffix}`
const projectChunks = `memory-chunk-${suffix}`
const runtimeDirectory = resolve(repositoryRoot, 'runtime', `memory-v2-spike-${runToken}`)
process.env.RESEARCH_RUNTIME_DIR = runtimeDirectory

const { database, migrate } = await import('../apps/server/src/database.js')
const { parseKnowledgeMarkdown } = await import('../apps/server/src/knowledge-markdown-parser.js')
const { applyMemoryRevocation, ingestProjectMemory, listProjectMemoryLinks, searchProjectMemory } = await import('../apps/server/src/supermemory-service.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitForTerminal(client: Supermemory, remoteId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = 'unknown'
  while (Date.now() < deadline) {
    try {
      const document = await client.documents.get(remoteId)
      last = String(document.status)
      if (last === 'done' || last === 'failed') return last
    } catch { /* The local worker may not expose the document immediately. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2000))
  }
  throw new Error(`document_terminal_timeout:${last}`)
}

async function waitForSearch(projectId: string, query: string, marker: string, timeoutMs = 120_000) {
  const started = performance.now()
  const deadline = Date.now() + timeoutMs
  let latest: Awaited<ReturnType<typeof searchProjectMemory>> | null = null
  while (Date.now() < deadline) {
    try {
      latest = await searchProjectMemory(projectId, query, 20, 'hybrid')
      if (latest.results.some(item => String(item.memory || '').includes(marker))) {
        return { elapsed_ms: Math.round(performance.now() - started), response: latest }
      }
    } catch { /* Processing is asynchronous; retry the same local service only. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2000))
  }
  throw new Error(`search_marker_timeout:${marker}:${latest?.total ?? 0}`)
}

const output: Record<string, unknown> = {
  run: runToken,
  started_at: new Date().toISOString(),
  service: {},
  whole_document: {},
  ast_chunks: {},
  replacement: {},
  cleanup: {},
}
const linksToDelete: Array<{ projectId: string; linkId: string }> = []

try {
  const baseURL = (process.env.SUPERMEMORY_BASE_URL || 'http://127.0.0.1:6767').replace(/\/$/, '')
  const probeStarted = performance.now()
  const probe = await fetch(`${baseURL}/v3/settings`, { signal: AbortSignal.timeout(8000) })
  assert(probe.ok, `supermemory_local_unreachable:${probe.status}`)
  output.service = { base_url: baseURL, build_probe_status: probe.status, latency_ms: Math.round(performance.now() - probeStarted) }

  await migrate()
  await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2),($3,$3,$4)', [projectFull, 'Memory v2 whole-document spike', projectChunks, 'Memory v2 AST-chunk spike'])
  const fixture = readFileSync(resolve(repositoryRoot, 'apps/server/tests/fixtures/memory-v2/idea-current.zh-CN.md'), 'utf8')
  const parsed = parseKnowledgeMarkdown(fixture, 'fixture-memory-1a2b', 'research/idea/current.md', { target_tokens: 64, hard_max_tokens: 160 })
  const client = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY?.trim() || 'local-auto-auth', baseURL, timeout: 30_000, maxRetries: 0 })

  const wholeStarted = performance.now()
  const whole = await ingestProjectMemory(projectFull, {
    source_type: 'manual', source_id: null, source_key: 'spike:whole-document', artifact_id: null, uploaded_file_id: null,
    content: fixture, source_url: null, quote: null, locator: 'whole Markdown document',
    metadata: { acceptance: 'memory-v2-supermemory-spike', run: runToken, adapter: 'whole_markdown' },
    task_type: 'superrag', idempotency_key: `spike-whole-${runToken}`,
  })
  assert(whole.link, 'whole_document_link_missing')
  linksToDelete.push({ projectId: projectFull, linkId: whole.link.id })
  const wholeTerminal = await waitForTerminal(client, whole.link.supermemory_id)
  const wholeSearch = await waitForSearch(projectFull, '局部几何不确定性 长尾类别', '局部几何不确定性')
  output.whole_document = {
    ingest_ms: Math.round(performance.now() - wholeStarted),
    terminal_status: wholeTerminal,
    result_count: wholeSearch.response.results.length,
    search_until_hit_ms: wholeSearch.elapsed_ms,
    locator_returned: wholeSearch.response.results.some(item => Boolean((item.metadata as Record<string, unknown> | undefined)?.locator)),
  }

  const chunkStarted = performance.now()
  const chunkLinks: Array<{ id: string; remote: string; terminal: string }> = []
  for (const chunk of parsed.chunks) {
    const result = await ingestProjectMemory(projectChunks, {
      source_type: 'knowledge_document_chunk', source_id: null, source_key: `spike:chunk:${chunk.chunk_key}`, artifact_id: null, uploaded_file_id: null,
      content: chunk.content, source_url: null, quote: null, locator: `${chunk.heading_path.join(' > ')} lines ${chunk.line_start}-${chunk.line_end}`,
      metadata: {
        acceptance: 'memory-v2-supermemory-spike', run: runToken, adapter: 'researchos_ast',
        knowledge_index_generation: runToken, knowledge_chunk_key: chunk.chunk_key,
        line_start: chunk.line_start, line_end: chunk.line_end, heading_path: chunk.heading_path,
      },
      task_type: 'superrag', idempotency_key: `spike-chunk-${runToken}-${chunk.chunk_key}`,
    })
    assert(result.link, 'chunk_link_missing')
    linksToDelete.push({ projectId: projectChunks, linkId: result.link.id })
    chunkLinks.push({ id: result.link.id, remote: result.link.supermemory_id, terminal: await waitForTerminal(client, result.link.supermemory_id) })
  }
  const chunkSearch = await waitForSearch(projectChunks, '局部几何不确定性 长尾类别', '局部几何不确定性')
  output.ast_chunks = {
    chunk_count: parsed.chunks.length,
    ingest_ms: Math.round(performance.now() - chunkStarted),
    terminal_statuses: chunkLinks.map(item => item.terminal),
    result_count: chunkSearch.response.results.length,
    search_until_hit_ms: chunkSearch.elapsed_ms,
    locator_returned: chunkSearch.response.results.some(item => {
      const metadata = (item.metadata || {}) as Record<string, unknown>
      return Boolean(metadata.locator || (metadata.line_start && metadata.line_end && metadata.heading_path))
    }),
  }

  const revisedMarker = `修订版本唯一标记 ${runToken}`
  const revised = await ingestProjectMemory(projectFull, {
    source_type: 'manual', source_id: null, source_key: 'spike:whole-document', artifact_id: null, uploaded_file_id: null,
    content: `${fixture}\n\n## Revised section\n\n${revisedMarker}\n`, source_url: null, quote: null, locator: 'whole Markdown document revision',
    metadata: { acceptance: 'memory-v2-supermemory-spike', run: runToken, adapter: 'whole_markdown_revision' },
    task_type: 'superrag', idempotency_key: `spike-whole-revision-${runToken}`,
  })
  assert(revised.link, 'revised_document_link_missing')
  linksToDelete.push({ projectId: projectFull, linkId: revised.link.id })
  const revisedTerminal = await waitForTerminal(client, revised.link.supermemory_id)
  const activeSameSource = (await listProjectMemoryLinks(projectFull)).filter(link => link.source_key === 'spike:whole-document' && link.status === 'active')
  output.replacement = {
    revised_terminal_status: revisedTerminal,
    same_source_active_remote_documents: activeSameSource.length,
    local_build_replaces_same_source_automatically: activeSameSource.length === 1,
    conclusion: activeSameSource.length === 1
      ? 'local build replaced the prior source automatically'
      : 'local build retained both versions; Research OS active-generation filtering is required',
  }
} catch (error) {
  output.failure = { code: error instanceof Error ? error.message : String(error) }
  process.exitCode = 1
} finally {
  let deleted = 0
  const failures: string[] = []
  for (const link of linksToDelete) {
    try {
      await applyMemoryRevocation(link.projectId, link.linkId, 'delete', 'memory-v2-spike')
      deleted += 1
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  output.cleanup = { attempted: linksToDelete.length, deleted, failures }
  output.finished_at = new Date().toISOString()
  const acceptanceDirectory = resolve(repositoryRoot, 'artifacts', 'acceptance')
  mkdirSync(acceptanceDirectory, { recursive: true })
  const outputPath = resolve(acceptanceDirectory, `memory-v2-supermemory-spike-${runToken}.json`)
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  try {
    await database.query('DELETE FROM memory_links WHERE project_id=ANY($1::varchar[])', [[projectFull, projectChunks]])
    await database.query('DELETE FROM audit_events WHERE project_id=ANY($1::varchar[])', [[projectFull, projectChunks]])
    await database.query('DELETE FROM projects WHERE id=ANY($1::varchar[])', [[projectFull, projectChunks]])
    await database.close()
    rmSync(runtimeDirectory, { recursive: true, force: true })
  } catch { /* Evidence is already written; cleanup state remains visible there. */ }
  console.log(JSON.stringify({ output_path: outputPath, ...output }, null, 2))
}

