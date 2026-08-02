import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const scanRoots = ['apps', 'scripts'].map(name => resolve(root, name))
const forbiddenExtensions = new Set(['.py', '.pyc', '.pyo', '.ipynb'])
const ignoredDirectories = new Set(['.git', '.mastra', '.venv', 'dist', 'node_modules'])
const legacyPathPattern = /(?:D:[\\/]auto-related-work|[\\/]auto-related-work[\\/](?:backend|cache|old_files)|(?:^|[\\/])pipeline_output(?:[\\/]|$)|(?:^|[\\/])final_results\.json$|(?:^|[\\/])\.pytest_cache(?:[\\/]|$)|(?:^|[\\/])__pycache__(?:[\\/]|$))/i
const violations: string[] = []
let scannedFiles = 0

function visit(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      visit(path)
      continue
    }
    if (!entry.isFile()) continue
    scannedFiles += 1
    const relativePath = relative(root, path)
    if (relativePath === 'scripts/check-language-boundary.ts') continue
    if (forbiddenExtensions.has(extname(entry.name).toLowerCase())) {
      violations.push(`${relativePath}: forbidden runtime file extension ${extname(entry.name)}`)
    }
    if (legacyPathPattern.test(relativePath)) {
      violations.push(`${relativePath}: legacy project/cache path is inside the application boundary`)
    }
    if (statSync(path).size > 5_000_000) continue
    const contents = readFileSync(path, 'utf8')
    if (legacyPathPattern.test(contents)) {
      violations.push(`${relativePath}: contains a legacy project/cache runtime reference`)
    }
  }
}

for (const directory of scanRoots) visit(directory)

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log(`Language boundary check passed: scanned ${scannedFiles} files; no legacy Python runtime or project/cache reference found.`)
