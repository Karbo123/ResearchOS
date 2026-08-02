import { type ReactNode } from 'react'
import { useTranslation } from '../i18n'

type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'unordered'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language: string; text: string }

function inlineNodes(value: string, prefix: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(<code key={`${prefix}-code-${index}`}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${prefix}-strong-${index}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('_')) {
      nodes.push(<em key={`${prefix}-em-${index}`}>{token.slice(1, -1)}</em>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
      if (link) {
        nodes.push(
          <a key={`${prefix}-link-${index}`} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }
    cursor = match.index + token.length
    index += 1
  }
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

function parseBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let unordered: string[] = []
  let ordered: string[] = []
  let code: string[] = []
  let codeLanguage = ''
  let inCode = false

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushLists = () => {
    if (unordered.length) blocks.push({ kind: 'unordered', items: unordered })
    if (ordered.length) blocks.push({ kind: 'ordered', items: ordered })
    unordered = []
    ordered = []
  }
  const flushText = () => {
    flushParagraph()
    flushLists()
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({ kind: 'code', language: codeLanguage, text: code.join('\n') })
        code = []
        codeLanguage = ''
        inCode = false
      } else {
        flushText()
        codeLanguage = line.slice(3).trim()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }
    if (!line.trim()) {
      flushText()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushText()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      if (ordered.length) flushLists()
      unordered.push(bullet[1])
      continue
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (numbered) {
      flushParagraph()
      if (unordered.length) flushLists()
      ordered.push(numbered[1])
      continue
    }
    if (line.startsWith('> ')) {
      flushText()
      blocks.push({ kind: 'quote', text: line.slice(2) })
      continue
    }
    paragraph.push(line.trim())
  }
  if (inCode) blocks.push({ kind: 'code', language: codeLanguage, text: code.join('\n') })
  flushText()
  return blocks
}

export function MarkdownPreview({ content }: { content: string }) {
  const { t } = useTranslation()
  const blocks = parseBlocks(content)
  return (
    <article className="markdown-preview" aria-label={t('md.previewLabel')}>
      {blocks.map((block, index) => {
        const key = `markdown-${index}`
        if (block.kind === 'heading') {
          const Heading = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3'
          return <Heading key={key}>{inlineNodes(block.text, key)}</Heading>
        }
        if (block.kind === 'unordered' || block.kind === 'ordered') {
          const List = block.kind === 'unordered' ? 'ul' : 'ol'
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{inlineNodes(item, `${key}-${itemIndex}`)}</li>)}
            </List>
          )
        }
        if (block.kind === 'quote') return <blockquote key={key}>{inlineNodes(block.text, key)}</blockquote>
        if (block.kind === 'code') return <pre key={key} data-language={block.language || undefined}><code>{block.text}</code></pre>
        return <p key={key}>{inlineNodes(block.text, key)}</p>
      })}
      {!blocks.length ? <p className="muted">{t('md.noPreview')}</p> : null}
    </article>
  )
}
