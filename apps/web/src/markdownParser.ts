export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'unordered'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'code'; language: string; text: string }

export function parseBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let unordered: string[] = []
  let ordered: string[] = []
  let code: string[] = []
  let codeLanguage = ''
  let inCode = false
  let index = 0

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

  while (index < lines.length) {
    const line = lines[index] ?? ''
    index += 1
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
    const image = line.match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/api\/[^)\s]+)\)\s*$/)
    if (image) {
      flushText()
      blocks.push({ kind: 'image', alt: image[1] ?? '', src: image[2] ?? '' })
      continue
    }
    const separatorRow = /^\s*\|?[\s:|-]+\|?\s*$/
    const nextLine = lines[index] ?? ''
    if (line.includes('|') && nextLine && separatorRow.test(nextLine)) {
      flushText()
      const rows = [line, nextLine]
      index += 1
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        rows.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({
        kind: 'table',
        rows: rows
          .filter(row => !separatorRow.test(row.trim()))
          .map(row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())),
      })
      continue
    }
    if (!line.trim()) {
      flushText()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushText()
      blocks.push({ kind: 'heading', level: (heading[1] ?? '').length, text: (heading[2] ?? '').trim() })
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      if (ordered.length) flushLists()
      unordered.push(bullet[1] ?? '')
      continue
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (numbered) {
      flushParagraph()
      if (unordered.length) flushLists()
      ordered.push(numbered[1] ?? '')
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
