import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { artifactsRoot, pathInside } from './paths.js'

export const MAX_MATERIAL_CHUNKS = 200
export const MAX_MATERIAL_CHUNK_CHARS = 6_000
export const MATERIAL_CHUNK_OVERLAP_CHARS = 500
export const MAX_MATERIAL_PDF_PAGES = 200

export class MaterialIndexError extends Error {
  readonly code: string
  readonly status: 400 | 404 | 413 | 415 | 422

  constructor(code: string, message: string, status: 400 | 404 | 413 | 415 | 422 = 422) {
    super(message)
    this.name = 'MaterialIndexError'
    this.code = code
    this.status = status
  }
}

export type MaterialFile = {
  id: string
  name: string
  relative_path: string
  mime_type: string
  size_bytes: number
  sha256: string
  metadata: Record<string, unknown>
}

export type MaterialChunk = {
  content: string
  index: number
  locator: string
  content_sha256: string
}

function filePath(file: MaterialFile): string {
  const path = pathInside(artifactsRoot, file.relative_path)
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) throw new MaterialIndexError('uploaded_file_missing', '上传材料文件不存在。', 404)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new MaterialIndexError('uploaded_file_not_regular', '上传材料必须是普通文件。')
  if (stat.size !== file.size_bytes) throw new MaterialIndexError('uploaded_file_size_changed', '上传材料大小已经变化。', 422)
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (sha256 !== file.sha256.toLowerCase()) throw new MaterialIndexError('uploaded_file_hash_mismatch', '上传材料 SHA-256 已变化。', 422)
  return path
}

function splitText(text: string, prefix: (index: number) => string): MaterialChunk[] {
  const normalized = text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const chunks: MaterialChunk[] = []
  let start = 0
  while (start < normalized.length && chunks.length < MAX_MATERIAL_CHUNKS) {
    const end = Math.min(normalized.length, start + MAX_MATERIAL_CHUNK_CHARS)
    const content = normalized.slice(start, end).trim()
    if (content) chunks.push({
      content,
      index: chunks.length,
      locator: prefix(chunks.length),
      content_sha256: createHash('sha256').update(content).digest('hex'),
    })
    if (end >= normalized.length) {
      start = normalized.length
      break
    }
    start = Math.max(end - MATERIAL_CHUNK_OVERLAP_CHARS, start + 1)
  }
  if (start < normalized.length) throw new MaterialIndexError('material_chunk_limit_exceeded', '材料分块超过受控上限。', 413)
  return chunks
}

async function pdfChunks(bytes: Uint8Array): Promise<MaterialChunk[]> {
  const document = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_MATERIAL_PDF_PAGES); pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
    if (text) pages.push(`Page ${pageNumber}: ${text}`)
  }
  return splitText(pages.join('\n'), index => `pages_chunk_${index + 1}`)
}

export async function extractMaterialChunks(file: MaterialFile): Promise<{ path: string; chunks: MaterialChunk[]; raw_upload: boolean; parse_status: string }> {
  const path = filePath(file)
  const mime = file.mime_type.toLowerCase()
  const extension = extname(file.name).toLowerCase()
  if (mime === 'application/pdf' || extension === '.pdf') {
    const chunks = await pdfChunks(new Uint8Array(readFileSync(path)))
    return { path, chunks, raw_upload: true, parse_status: chunks.length ? 'pdf_text_extracted' : 'pdf_no_extractable_text' }
  }
  if (mime.startsWith('text/') || ['application/json', 'application/xml', 'application/csv', 'text/csv', 'text/tab-separated-values'].includes(mime) || ['.json', '.jsonl', '.ndjson', '.csv', '.tsv', '.txt', '.md', '.log', '.xml'].includes(extension)) {
    const chunks = splitText(readFileSync(path, 'utf8'), index => `text_chunk_${index + 1}`)
    return { path, chunks, raw_upload: false, parse_status: chunks.length ? 'text_chunked' : 'text_empty' }
  }
  if (mime.startsWith('image/')) return { path, chunks: [], raw_upload: true, parse_status: 'image_multimodal_upload' }
  throw new MaterialIndexError('material_type_unsupported', '当前材料类型不支持受控语义索引。', 415)
}
