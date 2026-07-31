import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { audit, database, rows } from './database.js'
import { ApiError } from './http.js'
import { artifactsRoot, pathInside } from './paths.js'
import { registerLineageDependencies } from './impact-service.js'
import { requireProject } from './project-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'

type Paper = { id: string; title: string; doi: string | null; source_url: string; bibtex: string | null; metadata: Record<string, unknown> }
const allowedPdfHosts = new Set(['arxiv.org', 'export.arxiv.org', 'openaccess.thecvf.com', 'aclanthology.org', 'proceedings.mlr.press'])

function allowedPdfUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !allowedPdfHosts.has(url.hostname.toLowerCase())) throw new ApiError(422, 'pdf_source_not_allowlisted', 'PDF 来源不在开放全文白名单中。')
  return url
}

async function downloadPdf(value: string): Promise<Uint8Array> {
  const url = allowedPdfUrl(value)
  const response = await fetch(url, { headers: { 'user-agent': process.env.RESEARCH_USER_AGENT || 'ResearchOS/0.3' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`pdf_http_${response.status}`)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > 25 * 1024 * 1024) throw new Error('pdf_too_large')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 25 * 1024 * 1024 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('invalid_pdf_payload')
  return bytes
}

async function pageQuotes(bytes: Uint8Array): Promise<Array<{ page: number; quote: string }>> {
  const document = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise
  const quotes: Array<{ page: number; quote: string }> = []
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 80); pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
    if (text.length >= 120) quotes.push({ page: pageNumber, quote: text.slice(0, 1200) })
    if (quotes.length >= 3) break
  }
  return quotes
}

export async function ingestEvidence(projectId: string, limit: number) {
  await requireProject(projectId, true)
  const papers = await rows<Paper>('SELECT id,title,doi,source_url,bibtex,metadata FROM papers WHERE project_id=$1 ORDER BY created_at DESC', [projectId])
  const candidates = papers.filter(paper => typeof paper.metadata?.pdf_url === 'string').slice(0, limit)
  if (!candidates.length) throw new ApiError(422, 'no_open_pdf_candidates', '当前文献候选没有白名单开放 PDF，无法提取全文证据。')
  const errors: Array<{ paper_id: string; code: string }> = []
  let storedCount = 0
  for (const paper of candidates) {
    try {
      const pdfUrl = String(paper.metadata.pdf_url)
      const bytes = await downloadPdf(pdfUrl)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const directory = pathInside(artifactsRoot, 'evidence', projectId)
      mkdirSync(directory, { recursive: true })
      const path = pathInside(directory, `${paper.id}.pdf`)
      writeFileSync(path, bytes, { flag: 'wx' })
      const artifactId = crypto.randomUUID()
      await database.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [artifactId, projectId, 'source_pdf', `${paper.id}.pdf`, `evidence/${projectId}/${paper.id}.pdf`, 'application/pdf', sha256, { source_url: pdfUrl, paper_id: paper.id }])
      const quotes = await pageQuotes(bytes)
      if (!quotes.length) throw new Error('pdf_text_not_extractable')
      for (const item of quotes) {
        const evidenceId = crypto.randomUUID()
        await database.query('INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [evidenceId, projectId, paper.id, 'Candidate passage requiring claim-level human review', item.quote, `page ${item.page}`, pdfUrl, { pdf_sha256: sha256, artifact_id: artifactId, evidence_status: 'page_quote_candidate' }])
        await registerLineageDependencies(projectId, [
          { downstream: { type: 'artifact', id: artifactId }, upstream: { type: 'paper', id: paper.id }, relation: 'source_pdf' },
          { downstream: { type: 'evidence', id: evidenceId }, upstream: { type: 'paper', id: paper.id }, relation: 'paper_evidence' },
        ])
        storedCount += 1
      }
      if (supermemoryEnabled()) {
        await ingestProjectMemory(projectId, {
          source_type: 'related_work', source_id: paper.id, artifact_id: artifactId, uploaded_file_id: null,
          content: null, source_url: pdfUrl, quote: quotes.map(item => `page ${item.page}: ${item.quote}`).join('\n').slice(0, 4000), locator: `pages ${quotes[0]?.page || 1}-${quotes.at(-1)?.page || quotes[0]?.page || 1}`,
          metadata: { paper_id: paper.id, source_url: pdfUrl, page_quote_count: quotes.length }, task_type: 'superrag', idempotency_key: `paper-pdf:${paper.id}:${sha256}`,
        })
      }
      await database.query('UPDATE papers SET verified=TRUE WHERE id=$1', [paper.id])
    } catch (error) { errors.push({ paper_id: paper.id, code: error instanceof Error ? error.message : 'evidence_ingest_failed' }) }
  }
  await audit('evidence.ingested', projectId, { stored_count: storedCount, errors })
  return { stored_count: storedCount, errors }
}
