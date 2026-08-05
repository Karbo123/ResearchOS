import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectsRoot, repositoryRoot } from '../apps/server/src/paths.js'
import { ensureProjectGit } from '../apps/server/src/project-service.js'

const templatePath = resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')
const template = readFileSync(templatePath, 'utf8')

function runGit(projectRoot: string, args: string[]) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' })
}

async function main() {
  const projectDirectories = await import('node:fs/promises').then(fs => fs.readdir(projectsRoot, { withFileTypes: true }))
  const initialized: string[] = []
  const skipped: string[] = []
  for (const entry of projectDirectories) {
    if (!entry.isDirectory()) continue
    const projectRoot = resolve(projectsRoot, entry.name)
    const workflowPath = resolve(projectRoot, 'workflow.ts')
    if (existsSync(workflowPath)) {
      try {
        const tracked = runGit(projectRoot, ['ls-files', '--error-unmatch', 'workflow.ts']).trim()
        if (tracked) {
          skipped.push(entry.name)
          continue
        }
      } catch {
        // untracked or project git not initialized yet
      }
      ensureProjectGit(entry.name)
      runGit(projectRoot, ['add', 'workflow.ts'])
      try {
        runGit(projectRoot, ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: initialize project workflow'])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('nothing to commit')) throw error
      }
      initialized.push(entry.name)
      continue
    }
    ensureProjectGit(entry.name)
    writeFileSync(workflowPath, template, 'utf8')
    runGit(projectRoot, ['add', 'workflow.ts'])
    try {
      runGit(projectRoot, ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: initialize project workflow'])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('nothing to commit')) {
        skipped.push(entry.name)
        continue
      }
      throw error
    }
    initialized.push(entry.name)
  }
  console.log(JSON.stringify({ initialized, skipped }, null, 2))
}

await main()
