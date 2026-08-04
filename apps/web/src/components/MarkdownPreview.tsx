import { type ReactNode } from 'react'
import { useTranslation } from '../i18n'
import { parseBlocks } from '../markdownParser'

function inlineNodes(value: string, prefix: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_|!\[[^\]]*\]\((?:https?:\/\/[^)\s]+|\/api\/[^)\s]+)\)|\[[^\]]+\]\((?:https?:\/\/[^)\s]+)\))/g
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
    } else if (token.startsWith('![')) {
      const image = token.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/api\/[^)\s]+)\)$/)
      if (image) {
        nodes.push(
          <img
            key={`${prefix}-image-${index}`}
            src={image[2]}
            alt={image[1] || 'image'}
            loading="lazy"
            referrerPolicy="no-referrer"
          />,
        )
      } else {
        nodes.push(token)
      }
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
        if (block.kind === 'image') {
          return (
            <figure className="markdown-figure" key={key}>
              <img src={block.src} alt={block.alt || t('md.imageAlt')} loading="lazy" referrerPolicy="no-referrer" />
            </figure>
          )
        }
        if (block.kind === 'table') {
          const [head, ...body] = block.rows
          return (
            <div className="markdown-table-wrap" key={key}>
              <table>
                {head ? (
                  <thead>
                    <tr>{head.map((cell, cellIndex) => <th key={`${key}-h-${cellIndex}`}>{inlineNodes(cell, `${key}-h-${cellIndex}`)}</th>)}</tr>
                  </thead>
                ) : null}
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={`${key}-r-${rowIndex}`}>
                      {row.map((cell, cellIndex) => <td key={`${key}-c-${rowIndex}-${cellIndex}`}>{inlineNodes(cell, `${key}-c-${rowIndex}-${cellIndex}`)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'code') return <pre key={key} data-language={block.language || undefined}><code>{block.text}</code></pre>
        return <p key={key}>{inlineNodes(block.text, key)}</p>
      })}
      {!blocks.length ? <p className="muted">{t('md.noPreview')}</p> : null}
    </article>
  )
}
