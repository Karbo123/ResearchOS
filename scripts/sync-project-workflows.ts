import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectsRoot, repositoryRoot } from '../apps/server/src/paths.js'
import { ensureProjectGit } from '../apps/server/src/project-service.js'

// SHA-256 of the pre-workflow-edit template that every legacy test project used.
const legacyTemplateHash = '1567445f95af6ca880803d08eabf764756db66e0a7f776bca8474a3324beb4b2'
const templatePath = resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')
const template = readFileSync(templatePath, 'utf8')

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function main(): Promise<void> {
  const entries = await import('node:fs/promises').then(fs => fs.readdir(projectsRoot, { withFileTypes: true }))
  const synced: string[] = []
  const skipped: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const workflowPath = resolve(projectsRoot, entry.name, 'workflow.ts')
    if (existsSync(workflowPath) && sha256(readFileSync(workflowPath, 'utf8')) !== legacyTemplateHash && !readFileSync(workflowPath, 'utf8').includes('workflow_edit_proposal')) {
      skipped.push(`${entry.name}:customized`)
      continue
    }
    ensureProjectGit(entry.name)
    try {
      writeFileSync(workflowPath, template, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'EACCES') {
        skipped.push(`${entry.name}:readonly`)
        continue
      }
      throw error
    }
    const workflowStatus = execFileSync('git', ['status', '--porcelain', '--', 'workflow.ts'], { cwd: resolve(projectsRoot, entry.name), encoding: 'utf8' }).trim()
    if (!workflowStatus) {
      skipped.push(`${entry.name}:already_current`)
      continue
    }
    execFileSync('git', ['add', 'workflow.ts'], { cwd: resolve(projectsRoot, entry.name), encoding: 'utf8' })
    try {
      execFileSync('git', ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: sync project workflow template'], { cwd: resolve(projectsRoot, entry.name), encoding: 'utf8' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('nothing to commit') || message.includes('no changes added to commit')) {
        skipped.push(`${entry.name}:already_current`)
        continue
      }
      throw error
    }
    synced.push(entry.name)
  }
  console.log(JSON.stringify({ synced, skipped }, null, 2))
}

await main()
