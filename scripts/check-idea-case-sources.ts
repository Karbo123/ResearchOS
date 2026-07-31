import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { loadEnabledIdeaCases, repositoryRoot } from './idea-case-loader.js'

const cases = loadEnabledIdeaCases()
if (!cases.length) throw new Error('No enabled Idea cases were found.')

function collectTypeScriptFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = resolve(root, entry.name)
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(absolutePath))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(relative(repositoryRoot, absolutePath).replaceAll('\\', '/'))
  }
  return files
}

const sources = [
  ...collectTypeScriptFiles(resolve(repositoryRoot, 'scripts')).filter(source => !['scripts/idea-case-loader.ts', 'scripts/check-idea-case-sources.ts'].includes(source)),
  ...collectTypeScriptFiles(resolve(repositoryRoot, 'apps')).filter(source => /^apps\/.*\/tests\/.*\.ts$/.test(source)),
]
const violations: string[] = []
for (const source of sources) {
  const text = readFileSync(resolve(repositoryRoot, source), 'utf8')
  if (/\/api\/chat[\s\S]{0,300}(?:message|initial_message)\s*:\s*['"`][^$]/.test(text)) violations.push(`${source}: hard-coded Idea near /api/chat`)
}
if (violations.length) throw new Error(violations.join('\n'))
console.log(`IDEA_CASES_OK=${cases.length} ROOT=${resolve(repositoryRoot, 'tests', 'idea-cases')}`)
