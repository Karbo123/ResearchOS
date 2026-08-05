import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Supermemory } from 'supermemory'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(sourceDirectory, '..')
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
process.env.RESEARCH_RUNTIME_DIR = resolve(repositoryRoot, 'runtime', 'acceptance-supermemory')

const { database, migrate } = await import('../apps/server/src/database.js')
const {
  applyMemoryRevocation,
  ingestProjectMemory,
  listProjectMemoryLinks,
  memoryGraph,
  projectContainerTag,
  searchProjectMemory,
} = await import('../apps/server/src/supermemory-service.js')
const { artifactsRoot } = await import('../apps/server/src/paths.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function insertProject(id: string, slug: string, title: string) {
  await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [id, slug, title])
}

function artifactBytes(name: string, bytes: Uint8Array) {
  const directory = resolve(artifactsRoot, 'acceptance-supermemory')
  mkdirSync(directory, { recursive: true })
  const file = resolve(directory, name)
  writeFileSync(file, bytes)
  return {
    file,
    relativePath: `acceptance-supermemory/${name}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function insertArtifact(id: string, projectId: string, name: string, relativePath: string, mimeType: string, sha256: string) {
  await database.query(
    'INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,metadata,valid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)',
    [id, projectId, 'acceptance', name, relativePath, mimeType, sha256, JSON.stringify({ acceptance: 'supermemory-local' })],
  )
}

async function waitForMarker(projectId: string, query: string, marker: string, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs
  let latest: Awaited<ReturnType<typeof searchProjectMemory>> | null = null
  while (Date.now() < deadline) {
    latest = await searchProjectMemory(projectId, query, 8, 'hybrid')
    if (latest.results.some(item => String(item.memory || '').includes(marker))) return latest
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error(`timeout waiting for marker ${marker}`)
}

async function waitForMarkerAbsence(projectId: string, query: string, marker: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await searchProjectMemory(projectId, query, 8, 'hybrid')
    if (!result.results.some(item => String(item.memory || '').includes(marker))) return
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error(`marker ${marker} still present after revocation`)
}

async function waitForTerminalStatus(smClient: Supermemory, remoteId: string, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs
  let lastStatus: string | null = null
  while (Date.now() < deadline) {
    try {
      const doc = await smClient.documents.get(remoteId)
      lastStatus = doc.status
      if (doc.status === 'done' || doc.status === 'failed') return doc.status
    } catch {
      // transient; keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  throw new Error(`remote document ${remoteId} did not reach a terminal state (last: ${lastStatus})`)
}

const runToken = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
const projectA = `acceptance-alpha-${crypto.randomUUID().replaceAll('-', '').slice(0, 4)}`
const projectB = `acceptance-beta-${crypto.randomUUID().replaceAll('-', '').slice(0, 4)}`
const textA = `plasma surface reconstruction alpha channel ${runToken}`
const textB = `graphene bandgap beta channel ${runToken}`
const markerA = 'plasma surface reconstruction alpha channel'
const markerB = 'graphene bandgap beta channel'
const markerPdf = 'plasma pdf artifact marker'
const createdArtifactFiles: string[] = []
let imageFailed = false
let forgetBlocked = false
let pdfBlocked = false

const result: {
  run: string
  started_at: string
  steps: Record<string, unknown>
  [key: string]: unknown
} = {
  run: runToken,
  started_at: new Date().toISOString(),
  steps: {},
}

try {
  const baseURL = (process.env.SUPERMEMORY_BASE_URL || 'http://127.0.0.1:6767').trim()
  assert(process.env.SUPERMEMORY_ENABLED !== 'false', 'SUPERMEMORY_ENABLED is false')
  const probe = await fetch(`${baseURL}/v3/settings`, { signal: AbortSignal.timeout(8000) })
  assert(probe.ok, `Supermemory Local not reachable: ${probe.status}`)
  result.steps['service_reachable'] = { base_url: baseURL, status: probe.status }

  // Preflight: remove remote documents left by failed previous acceptance runs.
  // Only containers whose metadata carries the acceptance marker are touched;
  // real project memories never carry it.
  const preflightClient = new Supermemory({
    apiKey: 'local-auto-auth',
    baseURL,
    timeout: 30000,
    maxRetries: 0,
  })
  const preflightPage = await preflightClient.documents.list({ limit: 200 })
  const preflightContainers = new Set<string>()
  for (const document of (preflightPage as unknown as { memories?: Array<Record<string, unknown>> }).memories ?? []) {
    const metadata = (document.metadata ?? {}) as Record<string, unknown>
    if (!metadata.acceptance) continue
    for (const tag of (document.containerTags ?? []) as string[]) preflightContainers.add(tag)
  }
  const preflightDeletes: Array<{ container: string; deleted_count: number }> = []
  for (const container of preflightContainers) {
    const deletion = await preflightClient.documents.deleteBulk({ containerTags: [container] })
    preflightDeletes.push({ container, deleted_count: deletion.deletedCount })
  }
  result.steps['preflight_cleanup'] = { containers: preflightDeletes }

  await migrate()
  await insertProject(projectA, projectA, 'Supermemory acceptance A')
  await insertProject(projectB, projectB, 'Supermemory acceptance B')

  type IngestInput = Parameters<typeof ingestProjectMemory>[1]
  const inputA: IngestInput = {
    source_type: 'manual',
    source_id: null,
    artifact_id: null,
    uploaded_file_id: null,
    content: textA,
    source_url: null,
    quote: null,
    locator: null,
    metadata: { acceptance: runToken, project_scope: 'A' },
    task_type: 'memory',
    idempotency_key: `acceptance-a-${runToken}`,
  }
  const inputB: IngestInput = {
    source_type: 'manual',
    source_id: null,
    artifact_id: null,
    uploaded_file_id: null,
    content: textB,
    source_url: null,
    quote: null,
    locator: null,
    metadata: { acceptance: runToken, project_scope: 'B' },
    task_type: 'memory',
    idempotency_key: `acceptance-b-${runToken}`,
  }
  const linkA = await ingestProjectMemory(projectA, inputA)
  const linkB = await ingestProjectMemory(projectB, inputB)
  result.steps['text_ingestion'] = { a_status: linkA.remote_status, b_status: linkB.remote_status }

  const revocationClient = new Supermemory({
    apiKey: 'local-auto-auth',
    baseURL: (process.env.SUPERMEMORY_BASE_URL || 'http://127.0.0.1:6767').trim(),
    timeout: 30000,
    maxRetries: 0,
  })

  // Extraction is asynchronous on the ingest worker. A document can reach a
  // terminal 'failed' state transiently on the local build; retry the exact
  // same content against the same provider (bounded, not a fallback) before
  // recording the outcome.
  async function requireLink(projectId: string, input: IngestInput) {
    const result = await ingestProjectMemory(projectId, input)
    if (!result.link) throw new Error('ingestProjectMemory returned no link')
    return result.link
  }
  async function ingestUntilTerminal(projectId: string, input: IngestInput, attempts = 3) {
    let link = await requireLink(projectId, input)
    let attemptsUsed = 1
    for (;;) {
      const status = await waitForTerminalStatus(revocationClient, link.supermemory_id)
      if (status === 'done' || attemptsUsed >= attempts) return { link, status, attempts: attemptsUsed }
      link = await requireLink(projectId, input)
      attemptsUsed += 1
    }
  }
  const settledA = await ingestUntilTerminal(projectA, inputA)
  const settledB = await ingestUntilTerminal(projectB, inputB)
  result.steps['text_terminal_states'] = [
    { project: 'A', link_id: settledA.link.id, status: settledA.status, ingest_attempts: settledA.attempts },
    { project: 'B', link_id: settledB.link.id, status: settledB.status, ingest_attempts: settledB.attempts },
  ]

  const pdfBytes = Buffer.from([
    '%PDF-1.4\n',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n',
    '4 0 obj<</Length 54>>stream\n',
    `BT /F1 12 Tf 72 720 Td (${markerPdf} ${runToken}) Tj ET\n`,
    'endstream\nendobj\n',
    'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000231 00000 n \n',
    'trailer<</Size 5/Root 1 0 R>>\nstartxref\n368\n%%EOF\n',
  ].join(''))
  const pdf = artifactBytes(`acceptance-${runToken}.pdf`, pdfBytes)
  createdArtifactFiles.push(pdf.file)
  const pdfArtifactId = crypto.randomUUID()
  await insertArtifact(pdfArtifactId, projectA, `acceptance-${runToken}.pdf`, pdf.relativePath, 'application/pdf', pdf.sha256)
  const pdfLink = await ingestProjectMemory(projectA, {
    source_type: 'artifact',
    source_id: null,
    artifact_id: pdfArtifactId,
    uploaded_file_id: null,
    content: null,
    source_url: null,
    quote: null,
    locator: null,
    metadata: { acceptance: runToken, project_scope: 'A', kind: 'pdf' },
    task_type: 'memory',
    idempotency_key: `acceptance-a-pdf-${runToken}`,
  })
  result.steps['pdf_ingestion'] = { remote_status: pdfLink.remote_status, id: pdfLink.link?.supermemory_id ?? null }

  const searchA = await waitForMarker(projectA, `${markerA} ${runToken}`, runToken)
  const searchB = await waitForMarker(projectB, `${markerB} ${runToken}`, runToken)
  assert(searchA.results.some(item => String(item.memory || '').includes(markerA)), 'project A search did not return its own memory')
  assert(searchB.results.some(item => String(item.memory || '').includes(markerB)), 'project B search did not return its own memory')
  const leakA = await searchProjectMemory(projectA, markerB, 8, 'hybrid')
  const leakB = await searchProjectMemory(projectB, markerA, 8, 'hybrid')
  assert(!leakA.results.some(item => String(item.memory || '').includes(markerB)), 'project A leaked project B memory')
  assert(!leakB.results.some(item => String(item.memory || '').includes(markerA)), 'project B leaked project A memory')
  result.steps['project_isolation'] = { a_results: searchA.total, b_results: searchB.total, leak_a: leakA.total, leak_b: leakB.total }

  const graph = await memoryGraph(projectA, `${markerA} ${runToken}`, 8)
  assert(graph.nodes.length > 0, 'real provider graph returned no nodes')
  result.steps['graph_memory'] = {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    source: graph.source,
    related_memories_supported: graph.edges.length > 0,
  }

  const rag = await searchProjectMemory(projectA, `${markerA} ${runToken}`, 8, 'documents')
  result.steps['super_rag'] = {
    total: rag.total,
    source_status: rag.results.map(item => item.source_status),
    similarity_present: rag.results.some(item => item.similarity !== null),
  }

  const linksA = await listProjectMemoryLinks(projectA)
  const linksB = await listProjectMemoryLinks(projectB)
  const allLinks = [...linksA, ...linksB]
  const textLinks = allLinks.filter(link => !link.artifact_id)
  const pdfLinks = allLinks.filter(link => link.artifact_id)
  const terminalStates: Array<{ link_id: string; remote_status: string }> = []
  for (const link of textLinks) {
    const status = await waitForTerminalStatus(revocationClient, link.supermemory_id)
    terminalStates.push({ link_id: link.id, remote_status: status })
  }
  result.steps['remote_terminal_states'] = terminalStates

  // forget (soft delete of extracted memory entities) resolves the memory
  // entry ids from the project container and forgets each one. If extraction
  // produced no entities, the service returns a structured 404 and the real
  // outcome is recorded instead of a silent pass.
  const forgetResults: Array<{ id: string; status: string; error: string | null; entities_before: number; entities_remaining: number | null; ok: boolean }> = []
  for (const link of textLinks) {
    const tag = projectContainerTag(link.project_id)
    const list = (await revocationClient.post('/v4/memories/list', { body: { containerTags: [tag], limit: 100, page: 1 } })) as {
      memoryEntries?: Array<{ isForgotten?: boolean; documentIds?: Array<string> }>
    }
    const entriesBefore = (list.memoryEntries ?? []).filter(entry => (entry.documentIds ?? []).includes(link.supermemory_id))
    try {
      const result = await applyMemoryRevocation(link.project_id, link.id, 'forget', 'supermemory-acceptance')
      const listAfter = (await revocationClient.post('/v4/memories/list', { body: { containerTags: [tag], limit: 100, page: 1 } })) as {
        memoryEntries?: Array<{ isForgotten?: boolean; documentIds?: Array<string> }>
      }
      const after = (listAfter.memoryEntries ?? []).filter(entry => (entry.documentIds ?? []).includes(link.supermemory_id))
      const remaining = after.filter(entry => !entry.isForgotten)
      const ok = remaining.length === 0
      forgetResults.push({ id: link.id, status: result.link?.status ?? 'unknown', error: null, entities_before: entriesBefore.length, entities_remaining: remaining.length, ok })
      if (!ok) forgetBlocked = true
    } catch (error) {
      forgetBlocked = true
      forgetResults.push({
        id: link.id,
        status: 'blocked',
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        entities_before: entriesBefore.length,
        entities_remaining: null,
        ok: false,
      })
    }
  }
  result.steps['forget_revocation'] = { blocked: forgetBlocked, results: forgetResults }

  // Remote disappearance: hard-delete the document itself (forget only soft
  // deletes extracted memory entities, so the source document still holds
  // searchable chunks) and confirm the remote GET returns 404.
  const deleted: Array<{ id: string; operation: string; status: string; remote_gone: boolean }> = []
  for (const link of textLinks) {
    await revocationClient.documents.delete(link.supermemory_id)
    let remoteGone = false
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      try {
        await revocationClient.documents.get(link.supermemory_id)
      } catch {
        remoteGone = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    deleted.push({ id: link.id, operation: 'delete', status: 'deleted', remote_gone: remoteGone })
  }
  result.steps['delete_revocation'] = deleted
  await waitForMarkerAbsence(projectA, markerA, markerA)
  await waitForMarkerAbsence(projectB, markerB, markerB)
  result.steps['revocation_verified_remote'] = true

  // PDF processing: the upload itself is verified by pdf_ingestion above;
  // extraction uses the configured LLM provider. Wait a bounded interval for a
  // terminal state and record the real outcome; extraction failure is a
  // recorded failure, never a silent pass.
  const pdfStatuses: Array<{ id: string; remote_status: string | null; blocked_reason: string | null; delete_verified: boolean }> = []
  for (const link of pdfLinks) {
    let status: string | null = null
    let blockedReason: string | null = null
    let deleteVerified = false
    try {
      status = await waitForTerminalStatus(revocationClient, link.supermemory_id, 300_000)
      const revokedLink = await applyMemoryRevocation(link.project_id, link.id, 'delete', 'supermemory-acceptance')
      status = revokedLink.link?.status ?? status
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        try {
          await revocationClient.documents.get(link.supermemory_id)
        } catch {
          deleteVerified = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      if (status === 'done') {
        await waitForMarkerAbsence(projectA, markerPdf, markerPdf)
      } else {
        pdfBlocked = true
        blockedReason = status === 'failed' ? 'pdf_extraction_failed' : `pdf_document_not_terminal_${status}`
      }
    } catch (error) {
      pdfBlocked = true
      blockedReason = `pdf_processing_blocked: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`
    }
    pdfStatuses.push({ id: link.id, remote_status: status, blocked_reason: blockedReason, delete_verified: deleteVerified })
  }
  result.steps['pdf_revocation'] = { blocked: pdfBlocked, results: pdfStatuses }

  // Image ingestion is probed last: supermemory-server 0.0.7-rc.2 on Windows
  // has crashed while processing image documents without a Gemini key, so a
  // failure here must not invalidate the core text/PDF/Graph/RAG results.
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
    'base64',
  )
  const png = artifactBytes(`acceptance-${runToken}.png`, pngBytes)
  createdArtifactFiles.push(png.file)
  const pngArtifactId = crypto.randomUUID()
  await insertArtifact(pngArtifactId, projectA, `acceptance-${runToken}.png`, png.relativePath, 'image/png', png.sha256)
  let pngRemoteStatus: string | null = null
  let pngError: string | null = null
  let pngRemoteId: string | null = null
  try {
    const pngLink = await ingestProjectMemory(projectA, {
      source_type: 'artifact',
      source_id: null,
      artifact_id: pngArtifactId,
      uploaded_file_id: null,
      content: null,
      source_url: null,
      quote: null,
      locator: null,
      metadata: { acceptance: runToken, project_scope: 'A', kind: 'png' },
      task_type: 'memory',
      idempotency_key: `acceptance-a-png-${runToken}`,
    })
    pngRemoteStatus = pngLink.remote_status ?? null
    pngRemoteId = pngLink.link?.supermemory_id ?? null
  } catch (error) {
    pngError = error instanceof Error ? error.message : String(error)
  }
  if (!pngError && pngRemoteId) {
    const smClient = new Supermemory({
      apiKey: 'local-auto-auth',
      baseURL: (process.env.SUPERMEMORY_BASE_URL || 'http://127.0.0.1:6767').trim(),
      timeout: 30000,
      maxRetries: 0,
    })
    const deadline = Date.now() + 90_000
    let finalStatus: string | null = null
    while (Date.now() < deadline) {
      try {
        const doc = await smClient.documents.get(pngRemoteId)
        finalStatus = doc.status
        if (doc.status === 'done' || doc.status === 'failed') break
      } catch {
        // server may have crashed while processing the image
      }
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    if (!finalStatus) {
      pngError = 'server_unreachable_or_no_remote_status_after_image_upload'
    } else if (finalStatus !== 'done') {
      pngError = `remote_document_status_${finalStatus}`
    }
    result.steps['image_verification'] = { remote_id: pngRemoteId, final_status: finalStatus }
  }
  result.steps['image_ingestion'] = { remote_status: pngRemoteStatus, error: pngError }
  imageFailed = pngRemoteStatus === null || pngError !== null
} finally {
  for (const id of [projectA, projectB]) {
    const links = await listProjectMemoryLinks(id).catch(() => [])
    for (const link of links) {
      if (link.status === 'active') {
        const operation = link.artifact_id ? 'delete' : 'forget'
        await applyMemoryRevocation(id, link.id, operation, 'supermemory-acceptance-cleanup').catch(() => undefined)
      }
    }
    await database.query('DELETE FROM memory_links WHERE project_id=$1', [id]).catch(() => undefined)
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [id]).catch(() => undefined)
    await database.query('DELETE FROM artifacts WHERE project_id=$1', [id]).catch(() => undefined)
    await database.query('DELETE FROM projects WHERE id=$1', [id]).catch(() => undefined)
  }
  for (const file of createdArtifactFiles) rmSync(file, { force: true })
  await database.close().catch(() => undefined)
}

result.completed_at = new Date().toISOString()
result.status = imageFailed || forgetBlocked || pdfBlocked ? 'partial' : 'passed'
const outputDirectory = resolve(repositoryRoot, 'artifacts', 'acceptance')
mkdirSync(outputDirectory, { recursive: true })
const outputFile = resolve(outputDirectory, `supermemory-local-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}.json`)
writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ ...result, result_file: outputFile }, null, 2))
if (result.status !== 'passed') process.exitCode = 1
