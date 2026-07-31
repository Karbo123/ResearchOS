import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readmes = ['README.md', 'README.zh-CN.md']
const requiredFacts = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'Mastra', 'TypeScript', 'Node.js 22', 'http://127.0.0.1:8080', 'http://127.0.0.1:4111', 'npm run typecheck', 'npm test']
const requiredEnv = ['RESEARCH_MODEL_SIMPLE', 'RESEARCH_MODEL_URL_SIMPLE', 'RESEARCH_MODEL_KEY_SIMPLE', 'RESEARCH_REASONING_SIMPLE', 'RESEARCH_MODEL_MEDIUM', 'RESEARCH_MODEL_URL_MEDIUM', 'RESEARCH_MODEL_KEY_MEDIUM', 'RESEARCH_REASONING_MEDIUM', 'RESEARCH_MODEL_COMPLEX', 'RESEARCH_MODEL_URL_COMPLEX', 'RESEARCH_MODEL_KEY_COMPLEX', 'RESEARCH_REASONING_COMPLEX', 'MODEL_REQUEST_TIMEOUT_SECONDS']
const versions = new Set<string>()
const errors: string[] = []
for (const name of readmes) {
  const text = readFileSync(resolve(root, name), 'utf8')
  const version = /<!-- DOCS_SYNC_VERSION: ([0-9-]+) -->/.exec(text)?.[1]
  if (!version) errors.push(`${name}: missing DOCS_SYNC_VERSION`); else versions.add(version)
  for (const fact of requiredFacts) if (!text.includes(fact)) errors.push(`${name}: missing ${fact}`)
  for (const env of requiredEnv) if (!text.includes(`\`${env}\``)) errors.push(`${name}: missing configuration reference ${env}`)
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!.split('#')[0]!.trim().replaceAll('%20', ' ')
    if (target && !/^(https?:|mailto:)/.test(target) && !existsSync(resolve(root, target))) errors.push(`${name}: missing local link ${target}`)
  }
}
if (versions.size !== 1) errors.push('README sync markers differ')
const envText = readFileSync(resolve(root, '.env.example'), 'utf8')
for (const env of requiredEnv) if (!new RegExp(`^${env}=`, 'm').test(envText)) errors.push(`.env.example: missing ${env}`)
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`Documentation synchronization check passed: version=${[...versions][0]}`)
