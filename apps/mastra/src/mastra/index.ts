import './env.js'
import { Mastra } from '@mastra/core'
import { RequestContext } from '@mastra/core/request-context'
import { registerApiRoute } from '@mastra/core/server'
import { LibSQLStore } from '@mastra/libsql'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  configuredModel, experimentPlanningAgent, ideaClarificationAgent, supervisionIntentAgent,
} from './agents/research-agents.js'
import {
  adaptiveClarificationResultSchema, agentRequestContextSchema, clarifyRequestSchema,
  approvalGateRequestSchema, approvalGateResumeRequestSchema, experimentPlanRequestSchema, experimentPlanSchema, researchWorkflowInputSchema,
  supervisionIntentSchema, supervisionRequestSchema, type ModelTier,
} from './contracts.js'
import { loadModelConfig, ModelConfigurationError } from './model-config.js'
import { strictSupermemoryProcessors, SupermemoryConfigurationError } from './supermemory.js'
import { inspectIdeaDraft, inspectIdeaDraftTool } from './tools/inspect-idea-draft.js'
import { approvalGateWorkflow, projectChatWorkflow, researchBootstrapWorkflow, supervisionReportsWorkflow } from './workflows/research-workflows.js'
import { researchRoot } from './env.js'

const storage = new LibSQLStore({
  id: 'research-os-mastra-storage', url: `file:${resolve(researchRoot, 'runtime', 'mastra.db')}`,
})

function requestContext(tier: ModelTier, clarificationMode?: 'automatic' | 'detailed', projectId?: string | null, conversationId?: string | null) {
  const context = new RequestContext<z.infer<typeof agentRequestContextSchema>>()
  context.set('tier', tier)
  context.set('modelConfig', loadModelConfig(tier))
  if (clarificationMode) context.set('clarificationMode', clarificationMode)
  if (projectId) context.set('supermemoryProjectId', projectId)
  if (conversationId) context.set('supermemoryConversationId', conversationId)
  return context
}
function generationOptions(context: RequestContext<z.infer<typeof agentRequestContextSchema>>) {
  const config = context.get('modelConfig')
  const projectId = context.get('supermemoryProjectId')
  const conversationId = context.get('supermemoryConversationId')
  return {
    requestContext: context,
    model: configuredModel(context.get('tier')),
    maxRetries: 0,
    providerOptions: { openai: { reasoningEffort: config.reasoningEffort } },
    ...(projectId && conversationId ? strictSupermemoryProcessors(projectId, conversationId) : {}),
  }
}
function safeStatus(status: number): 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503 {
  return ([400, 401, 403, 404, 409, 422, 500, 502, 503].includes(status) ? status : 500) as ReturnType<typeof safeStatus>
}
function routeError(error: unknown, operation: string) {
  if (error instanceof ModelConfigurationError) return {
    status: 503,
    body: { code: 'llm_provider_not_configured', message: '当前模型层级配置无效，请检查模型设置。' },
  }
  if (error instanceof SupermemoryConfigurationError) return {
    status: 503,
    body: { code: error.code, message: error.message },
  }
  if (error instanceof z.ZodError) return {
    status: 422,
    body: { code: 'mastra_contract_invalid', message: `${operation}输入或结构化输出不符合契约。` },
  }
  return {
    status: 502,
    body: { code: 'llm_request_failed', message: `${operation}失败，请检查 Mastra 与模型服务状态后重试。` },
  }
}
async function parsedBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await c.req.json())
}

const apiRoutes = [
  registerApiRoute('/health', {
    method: 'GET', handler: async c => c.json({ status: 'ok', runtime: 'mastra', secrets_exposed: false }),
  }),
  registerApiRoute('/internal/agents/clarify', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, clarifyRequestSchema)
        const context = requestContext(body.tier, body.clarification_mode, body.memory_resource?.startsWith('project:') ? body.memory_resource.slice('project:'.length) : null, body.memory_thread?.startsWith('session:') ? body.memory_thread.slice('session:'.length) : null)
        const gapResult = inspectIdeaDraft(body.current_draft)
        const payload = {
          latest_user_message: body.message,
          current_structured_draft: body.current_draft,
          recent_conversation: body.transcript,
          clarification_mode: body.clarification_mode,
          uploaded_materials: body.attachment_context,
          deterministic_schema_gaps: gapResult.gaps,
        }
        const content = [
          { type: 'text' as const, text: JSON.stringify(payload) },
          ...body.attachment_images.map(image => ({ type: 'image' as const, image: image.data_url })),
        ]
        const response = await ideaClarificationAgent.generate([{ role: 'user', content }], {
          ...generationOptions(context),
          ...(body.memory_resource && body.memory_thread ? {
            memory: { resource: body.memory_resource, thread: body.memory_thread },
          } : {}),
          structuredOutput: { schema: adaptiveClarificationResultSchema, errorStrategy: 'strict' },
        })
        const result = adaptiveClarificationResultSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: body.tier, model: config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, 'Idea 澄清模型调用')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/agents/supervision-intent', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, supervisionRequestSchema)
        const context = requestContext(body.tier, undefined, body.memory_resource?.startsWith('project:') ? body.memory_resource.slice('project:'.length) : null, body.memory_thread?.startsWith('session:') ? body.memory_thread.slice('session:'.length) : null)
        const response = await supervisionIntentAgent.generate(JSON.stringify({
          latest_user_message: body.message,
          project_context: body.project_context,
          recent_conversation: body.transcript,
        }), {
          ...generationOptions(context),
          ...(body.memory_resource && body.memory_thread ? {
            memory: { resource: body.memory_resource, thread: body.memory_thread },
          } : {}),
          structuredOutput: { schema: supervisionIntentSchema, errorStrategy: 'strict' },
        })
        const result = supervisionIntentSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: body.tier, model: config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, '项目消息意图分类')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/agents/experiment-plan', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, experimentPlanRequestSchema)
        const context = requestContext('complex', undefined, body.project_id, `planning-${body.project_id}-${body.idea_version}`)
        const response = await experimentPlanningAgent.generate(JSON.stringify({
          project_id: body.project_id, idea_version: body.idea_version, planning_context: body.planning_context,
        }), {
          ...generationOptions(context),
          structuredOutput: { schema: experimentPlanSchema, errorStrategy: 'strict' },
        })
        return c.json({ result: experimentPlanSchema.parse(response.object) })
      } catch (error) {
        const failure = routeError(error, '实验计划模型调用')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/workflows/research-bootstrap', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, researchWorkflowInputSchema)
        const run = await c.get('mastra').getWorkflow('researchBootstrapWorkflow').createRun()
        const result = await run.start({ inputData: body })
        if (result.status !== 'success') {
          return c.json({ code: 'workflow_failed', message: '研究启动工作流执行失败。' }, 502)
        }
        return c.json(result.result)
      } catch (error) {
        const failure = routeError(error, '研究启动工作流')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/workflows/approval-gate', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, approvalGateRequestSchema)
        const workflow = c.get('mastra').getWorkflow('approvalGateWorkflow')
        const run = await workflow.createRun(body.run_id ? { runId: body.run_id, resourceId: body.project_id } : { resourceId: body.project_id })
        const { run_id: _runId, ...input } = body
        const result = await run.start({ inputData: { ...input, mastra_run_id: run.runId } })
        if (result.status === 'suspended') {
          const stepId = result.suspended[0]
          const stepKey = stepId.at(-1) || ''
          const step = (result.steps as Record<string, { suspendPayload?: unknown }>)[stepKey]
          return c.json({ status: 'suspended', run_id: run.runId, suspended: result.suspended, suspend_payload: step?.suspendPayload ?? null })
        }
        if (result.status !== 'success') return c.json({ code: 'approval_workflow_failed', message: '审批工作流执行失败。' }, 502)
        return c.json({ status: result.result.status, run_id: run.runId, result: result.result })
      } catch (error) {
        const failure = routeError(error, 'Proposal 审批工作流')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/workflows/approval-gate/resume', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, approvalGateResumeRequestSchema)
        const workflow = c.get('mastra').getWorkflow('approvalGateWorkflow')
        const run = await workflow.createRun({ runId: body.run_id })
        const result = await run.resume({ step: 'human-approval', resumeData: { approved: body.approved, actor: body.actor, comment: body.comment ?? null } })
        if (result.status === 'suspended') return c.json({ status: 'suspended', run_id: run.runId, suspended: result.suspended })
        if (result.status !== 'success') return c.json({ code: 'approval_workflow_failed', message: '审批工作流恢复失败。' }, 502)
        return c.json({ status: result.result.status, run_id: run.runId, result: result.result })
      } catch (error) {
        const failure = routeError(error, 'Proposal 审批工作流恢复')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
]

export const mastra = new Mastra({
  storage,
  logger: false,
  agents: { ideaClarificationAgent, supervisionIntentAgent, experimentPlanningAgent },
  tools: { inspectIdeaDraftTool },
  workflows: { researchBootstrapWorkflow, projectChatWorkflow, supervisionReportsWorkflow, approvalGateWorkflow },
  server: {
    host: '127.0.0.1', port: 4111, studioHost: '127.0.0.1', studioPort: 4111,
    build: { swaggerUI: true, openAPIDocs: true }, apiRoutes,
  },
})
