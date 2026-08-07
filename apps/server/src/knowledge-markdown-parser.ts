import { createHash } from 'node:crypto'
import { encode } from 'gpt-tokenizer'
import type { Root, RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import remarkFrontmatter from 'remark-frontmatter'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parseDocument } from 'yaml'
import {
  assertKnowledgePathForKind,
  KNOWLEDGE_DOCUMENT_PARSER_VERSION,
  knowledgeDocumentFrontMatter,
  type KnowledgeDocumentFrontMatter,
} from './knowledge-document-contracts.js'

export type KnowledgeChunk = {
  chunk_key: string
  content: string
  content_sha256: string
  heading_path: string[]
  line_start: number
  line_end: number
  token_count: number
  ordinal: number
}

export type ParsedKnowledgeDocument = {
  frontmatter: KnowledgeDocumentFrontMatter
  body: string
  body_sha256: string
  document_sha256: string
  parser_version: typeof KNOWLEDGE_DOCUMENT_PARSER_VERSION
  chunks: KnowledgeChunk[]
  headings: Array<{ depth: number; title: string; line: number }>
}

export type KnowledgeChunkOptions = {
  target_tokens?: number
  hard_max_tokens?: number
}

type LocatedPart = {
  content: string
  headingPath: string[]
  lineStart: number
  lineEnd: number
  tokenCount: number
  startOffset: number
  endOffset: number
}

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml'])

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function tokenCount(value: string): number {
  return encode(value).length
}

function parseFrontmatter(root: Root): KnowledgeDocumentFrontMatter {
  const first = root.children[0] as (RootContent & { value?: unknown }) | undefined
  if (!first || first.type !== 'yaml' || first.position?.start.line !== 1 || typeof first.value !== 'string') throw new Error('knowledge_frontmatter_required')
  const yaml = parseDocument(first.value, { prettyErrors: false, uniqueKeys: true })
  if (yaml.errors.length) throw new Error(`knowledge_frontmatter_yaml_invalid:${yaml.errors[0]?.message || 'invalid_yaml'}`)
  const value = yaml.toJS({ maxAliasCount: 0 }) as unknown
  return knowledgeDocumentFrontMatter.parse(value)
}

function lineEndFor(content: string, lineStart: number): number {
  const newlineCount = (content.match(/\n/g) || []).length
  return Math.max(lineStart, lineStart + newlineCount - (content.endsWith('\n') ? 1 : 0))
}

function splitTextToTokenLimit(content: string, lineStart: number, headingPath: string[], hardMax: number, startOffset: number): LocatedPart[] {
  if (tokenCount(content) <= hardMax) {
    return [{ content, headingPath, lineStart, lineEnd: lineEndFor(content, lineStart), tokenCount: tokenCount(content), startOffset, endOffset: startOffset + content.length }]
  }
  const lines = content.split(/(?<=\n)/)
  const parts: LocatedPart[] = []
  let buffer = ''
  let bufferLine = lineStart
  let bufferOffset = startOffset
  let cursorLine = lineStart
  let cursorOffset = startOffset

  const push = (value: string, startLine: number, valueOffset: number) => {
    if (!value) return
    parts.push({
      content: value,
      headingPath: [...headingPath],
      lineStart: startLine,
      lineEnd: lineEndFor(value, startLine),
      tokenCount: tokenCount(value),
      startOffset: valueOffset,
      endOffset: valueOffset + value.length,
    })
  }

  for (const line of lines) {
    if (tokenCount(line) > hardMax) {
      push(buffer, bufferLine, bufferOffset)
      buffer = ''
      const characters = Array.from(line)
      let offset = 0
      let consumedLength = 0
      while (offset < characters.length) {
        let low = offset + 1
        let high = characters.length
        let best = low
        while (low <= high) {
          const middle = Math.floor((low + high) / 2)
          const candidate = characters.slice(offset, middle).join('')
          if (tokenCount(candidate) <= hardMax) {
            best = middle
            low = middle + 1
          } else high = middle - 1
        }
        const segment = characters.slice(offset, best).join('')
        push(segment, cursorLine, cursorOffset + consumedLength)
        consumedLength += segment.length
        offset = best
      }
    } else if (buffer && tokenCount(buffer + line) > hardMax) {
      push(buffer, bufferLine, bufferOffset)
      buffer = line
      bufferLine = cursorLine
      bufferOffset = cursorOffset
    } else {
      if (!buffer) {
        bufferLine = cursorLine
        bufferOffset = cursorOffset
      }
      buffer += line
    }
    cursorLine += (line.match(/\n/g) || []).length
    cursorOffset += line.length
  }
  push(buffer, bufferLine, bufferOffset)
  return parts
}

function locatedParts(source: string, root: Root, hardMax: number): { parts: LocatedPart[]; headings: ParsedKnowledgeDocument['headings']; bodyStart: number } {
  const yamlNode = root.children[0]
  const bodyStart = yamlNode?.type === 'yaml' && yamlNode.position ? yamlNode.position.end.offset ?? 0 : 0
  const headings: ParsedKnowledgeDocument['headings'] = []
  const headingStack: string[] = []
  const parts: LocatedPart[] = []
  for (const node of root.children) {
    if (node.type === 'yaml' || !node.position || node.position.start.offset === undefined || node.position.end.offset === undefined) continue
    if (node.type === 'heading') {
      const title = toString(node).trim()
      headingStack.length = node.depth - 1
      headingStack[node.depth - 1] = title
      headings.push({ depth: node.depth, title, line: node.position.start.line })
    }
    const content = source.slice(node.position.start.offset, node.position.end.offset)
    parts.push(...splitTextToTokenLimit(content, node.position.start.line, [...headingStack], hardMax, node.position.start.offset))
  }
  return { parts, headings, bodyStart }
}

function groupParts(parts: LocatedPart[], source: string, target: number, hardMax: number): LocatedPart[] {
  if (!parts.length) return []
  const first = parts[0]
  const last = parts.at(-1)
  if (first && last) {
    const whole = source.slice(first.startOffset, last.endOffset)
    const wholeTokens = tokenCount(whole)
    if (wholeTokens <= target) {
      return [{
        content: whole,
        headingPath: first.headingPath,
        lineStart: first.lineStart,
        lineEnd: last.lineEnd,
        tokenCount: wholeTokens,
        startOffset: first.startOffset,
        endOffset: last.endOffset,
      }]
    }
  }
  const grouped: LocatedPart[] = []
  let current = parts[0]
  if (!current) return grouped
  for (const next of parts.slice(1)) {
    const contiguousContent: string = `${current.content}${source.slice(current.endOffset, next.startOffset)}${next.content}`
    const combinedTokens = tokenCount(contiguousContent)
    const startsNewSection = next.headingPath.length > 0 && next.content.trimStart().startsWith('#')
    if (!startsNewSection && combinedTokens <= hardMax) {
      current = {
        content: contiguousContent,
        headingPath: current.headingPath.length ? current.headingPath : next.headingPath,
        lineStart: current.lineStart,
        lineEnd: next.lineEnd,
        tokenCount: combinedTokens,
        startOffset: current.startOffset,
        endOffset: next.endOffset,
      }
    } else {
      grouped.push(current)
      current = next
    }
  }
  grouped.push(current)
  return grouped
}

export function parseKnowledgeMarkdown(
  source: string,
  expectedProjectId: string,
  relativePath: string,
  options: KnowledgeChunkOptions = {},
): ParsedKnowledgeDocument {
  const target = options.target_tokens ?? 1_000
  const hardMax = options.hard_max_tokens ?? 1_400
  if (!Number.isInteger(target) || !Number.isInteger(hardMax) || target < 64 || hardMax < target) throw new Error('knowledge_chunk_budget_invalid')
  const root = processor.parse(source) as Root
  const frontmatter = parseFrontmatter(root)
  if (frontmatter.project_id !== expectedProjectId) throw new Error('knowledge_project_mismatch')
  assertKnowledgePathForKind(relativePath, frontmatter.kind)
  const { parts, headings, bodyStart } = locatedParts(source, root, hardMax)
  const grouped = groupParts(parts, source, target, hardMax)
  const body = source.slice(bodyStart).replace(/^\r?\n/, '')
  const chunks = grouped.map((part, ordinal): KnowledgeChunk => {
    const contentSha = sha256(part.content)
    return {
      chunk_key: sha256(`${frontmatter.id}\0${part.headingPath.join(' > ')}\0${part.lineStart}\0${part.lineEnd}\0${contentSha}`).slice(0, 32),
      content: part.content,
      content_sha256: contentSha,
      heading_path: part.headingPath,
      line_start: part.lineStart,
      line_end: part.lineEnd,
      token_count: part.tokenCount,
      ordinal,
    }
  })
  return {
    frontmatter,
    body,
    body_sha256: sha256(body),
    document_sha256: sha256(source),
    parser_version: KNOWLEDGE_DOCUMENT_PARSER_VERSION,
    chunks,
    headings,
  }
}
