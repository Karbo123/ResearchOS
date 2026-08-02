import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const scanRoot = join(root, 'apps/web/src')
const violations: string[] = []
let scannedFiles = 0
const visibleAttributeNames = new Set(['aria-label', 'placeholder', 'title', 'alt'])
const obviousEnglishLabels = new Set([
  'artifact',
  'commit',
  'delta',
  'evidence',
  'field provenance',
  'mastra workflows',
  'material',
  'medium',
  'paper',
  'pdf artifact',
  'project scope',
  'project_scoped',
  'provider',
  'researchidea / projectspec',
  'resource',
  'robots',
  'run',
  'seed',
  'seeds',
  'std',
  'unresolved',
  'unknown',
  'low',
  'high',
])

function hasJsxAncestor(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxFragment(current) || ts.isJsxAttribute(current)) return true
    current = current.parent
  }
  return false
}

function isVisibleEnglish(text: string, node: ts.Node): boolean {
  if (!hasJsxAncestor(node)) return false
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return false

  const parent = node.parent
  if (ts.isStringLiteral(node) && ts.isJsxAttribute(parent)) {
    const attributeName = parent.name.getText()
    return visibleAttributeNames.has(attributeName)
      && /[A-Za-z]{3,}/.test(normalized)
      && !/^https?:\/\//.test(normalized)
      && !normalized.startsWith('@')
  }

  if (ts.isJsxText(node)) {
    const lower = normalized.toLowerCase()
    if (obviousEnglishLabels.has(lower)) return true
    return /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(normalized) && !/^Research OS$/i.test(normalized)
  }
  return false
}

function visitDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      visitDirectory(join(directory, entry.name))
      continue
    }
    if (!entry.isFile() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))) continue

    const path = join(directory, entry.name)
    if (relative(scanRoot, path) === 'i18n.ts') continue
    scannedFiles += 1

    const sourceText = readFileSync(path, 'utf8')
    const sourceFile = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    function visit(node: ts.Node): void {
      let text: string | undefined
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        text = node.text
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        text = node.text
      } else if (ts.isJsxText(node)) {
        text = node.text
      }

      if (text && (/[一-鿿]/.test(text) || isVisibleEnglish(text, node))) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        violations.push(`${relative(root, path)}:${line + 1}: hardcoded UI text "${text.trim()}"`)
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }
}

visitDirectory(scanRoot)

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log(`UI i18n check passed: scanned ${scannedFiles} files; no hardcoded Chinese or obvious English UI labels.`)
