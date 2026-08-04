import assert from 'node:assert/strict'
import { parseBlocks } from '../apps/web/src/markdownParser.js'

const blocks = parseBlocks(`# Weekly Report

| Metric | Value |
| --- | --- |
| Accuracy | 0.92 |
| Loss | 0.31 |

![Result chart](https://example.com/chart.png)

See the [upstream source](https://example.com/paper).

\`\`\`ts
const answer = 42
\`\`\`

![Unsafe](javascript:alert(1))
`)

assert.ok(blocks.some(block => block.kind === 'heading' && block.text === 'Weekly Report'), 'headings must be preserved')
const table = blocks.find(block => block.kind === 'table')
assert.ok(table && table.kind === 'table', 'pipe tables must be parsed as controlled tables')
assert.deepEqual(table.rows, [
  ['Metric', 'Value'],
  ['Accuracy', '0.92'],
  ['Loss', '0.31'],
], 'table rows must be preserved')
const image = blocks.find(block => block.kind === 'image')
assert.ok(image && image.kind === 'image' && image.src === 'https://example.com/chart.png', 'https images must be preserved')
assert.ok(blocks.some(block => block.kind === 'paragraph' && block.text.includes('upstream source')), 'upstream links must stay in paragraphs')
assert.ok(blocks.some(block => block.kind === 'code' && block.language === 'ts'), 'code blocks must be preserved')
assert.ok(!blocks.some(block => block.kind === 'image' && block.src.startsWith('javascript:')), 'unsafe image schemes must be rejected')

console.log('Markdown preview check passed')
