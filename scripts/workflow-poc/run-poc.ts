// @ts-nocheck
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AnyWorkflow } from '@mastra/core/workflows'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const sourcePath = resolve(repositoryRoot, 'scripts/workflow-poc/poc-project-workflow.ts')
const outputDir = resolve(repositoryRoot, 'runtime/workflow-poc')
const outputPath = resolve(outputDir, 'workflow-poc.mjs')
mkdirSync(outputDir, { recursive: true })

await build({
  entryPoints: [sourcePath],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outputPath,
  absWorkingDir: repositoryRoot,
  external: ['@mastra/core', '@mastra/core/workflows', 'zod'],
  sourcemap: false,
})

const moduleUrl = `${pathToFileURL(outputPath).href}?v=poc`
const module = await import(moduleUrl)
const workflow = module.default({ workflowId: 'project-poc-research', description: 'poc-v1' }) as AnyWorkflow

const graph = workflow.serializedStepGraph
const workflowInfo = {
  id: workflow.id,
  committed: workflow.committed,
  graphTypes: graph.map(entry => entry.type),
  graphStepIds: graph
    .filter(entry => entry.type === 'step')
    .map(entry => (entry as { step: { id: string } }).step.id),
}

const MastraConstructor = (await import('@mastra/core')).Mastra
const mastra: any = new (MastraConstructor as any)()
(workflow as unknown as { __registerMastra(mastra: unknown): void }).__registerMastra(mastra)
(workflow as { __registerPrimitives(primitives: { logger: unknown; storage?: unknown }): void }).__registerPrimitives({
  logger: mastra.getLogger(),
  storage: mastra.getStorage(),
})
const run = await workflow.createRun({ resourceId: 'project:poc' })
const directResult = await run.start({ inputData: { project_id: 'poc-project' } })
if (directResult.status !== 'success') throw new Error(`poc run failed: ${directResult.status}`)

const secondWorkflow = module.default({ workflowId: 'project-poc-research', description: 'poc-v2' }) as AnyWorkflow
mastra.addWorkflow(workflow, 'project:poc:research')
mastra.addWorkflow(secondWorkflow, 'project:poc:research')
const registeredAfterDuplicate = mastra.getWorkflow('project:poc:research')

console.log(JSON.stringify({
  workflowInfo,
  directRunStatus: directResult.status,
  directRunResult: directResult.result,
  duplicateKeyDescription: registeredAfterDuplicate.description,
}, null, 2))
