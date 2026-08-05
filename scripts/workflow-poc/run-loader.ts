// @ts-nocheck
import { ProjectWorkflowRuntime } from '../../apps/mastra/src/mastra/workflow-runtime/loader.js'

const MastraConstructor = (await import('@mastra/core')).Mastra
const mastra = new MastraConstructor({})
const runtime = new ProjectWorkflowRuntime(mastra, { pollIntervalMs: 100_000 })
const projectId = process.argv[2] || '013493b8-9c3d-4789-b290-7bd3ae6728cc'
await runtime.scanProject(projectId)
console.log(JSON.stringify(runtime.graph(projectId), null, 2))
