import './env.js'
import { Mastra } from '@mastra/core'
import { TripWire } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { registerApiRoute } from '@mastra/core/server'
import { LibSQLStore } from '@mastra/libsql'
import { MastraStorageExporter, Observability, SamplingStrategyType } from '@mastra/observability'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  configuredModel, configuredVisionModel, documentReplyAgent, experimentPlanningAgent, ideaClarificationAgent, paperRevisionAgent, paperTranslationAgent, projectSlugAgent, researchCoordinatorAgent, supervisionIntentAgent, visionModelName,
} from './agents/research-agents.js'
import {
  adaptiveClarificationResultSchema, agentRequestContextSchema, clarifyRequestSchema, documentReplyRequestSchema, documentReplyResultSchema, paperSectionReviseRequestSchema, paperSectionReviseResultSchema, paperSectionTranslateRequestSchema, paperSectionTranslateResultSchema, projectSlugRequestSchema, projectSlugResultSchema,
  approvalGateRequestSchema, approvalGateResumeRequestSchema, coordinatorRequestSchema, coordinatorResultSchema, experimentPlanRequestSchema, experimentPlanSchema, researchWorkflowInputSchema,
  supervisionIntentSchema, supervisionRequestSchema, type ModelTier,
} from './contracts.js'
import { loadModelConfig, ModelConfigurationError } from './model-config.js'
import { strictSupermemoryProcessors, SupermemoryConfigurationError } from './supermemory.js'
import { strictResearchProcessors } from './guardrails.js'
import { ensureIdeaDataset, ideaClarificationContractScorer, MastraEvalContractError } from './evals.js'
import { inspectIdeaDraft, inspectIdeaDraftTool } from './tools/inspect-idea-draft.js'
import { approvalGateWorkflow, projectChatWorkflow, researchBootstrapWorkflow, supervisionReportsWorkflow } from './workflows/research-workflows.js'
import { researchRoot } from './env.js'
import { structuredJsonValue } from './structured-json-input.js'

const storage = new LibSQLStore({
  id: 'research-os-mastra-storage', url: `file:${resolve(researchRoot, 'runtime', 'mastra.db')}`,
})

const observability = new Observability({
  sensitiveDataFilter: true,
  configs: {
    default: {
      serviceName: 'research-os-mastra',
      sampling: { type: SamplingStrategyType.ALWAYS },
      exporters: [new MastraStorageExporter({ maxRetries: 0, maxBatchSize: 20, maxBatchWaitMs: 500 })],
      requestContextKeys: ['supermemoryProjectId', 'supermemoryConversationId', 'tier'],
      serializationOptions: { maxStringLength: 2_000, maxDepth: 5, maxArrayLength: 30, maxObjectKeys: 40 },
    },
  },
})

function containsToolInvocation(content: unknown): boolean {
  return Array.isArray(content) && content.some(part => typeof part === 'object' && part !== null && 'type' in part && (part as { type?: unknown }).type === 'tool-invocation')
}

function requestContext(tier: ModelTier, clarificationMode?: 'automatic' | 'detailed', projectId?: string | null, conversationId?: string | null) {
  const context = new RequestContext<z.infer<typeof agentRequestContextSchema>>()
  context.set('tier', tier)
  context.set('modelConfig', loadModelConfig(tier, projectId ?? undefined))
  if (clarificationMode) context.set('clarificationMode', clarificationMode)
  if (projectId) context.set('supermemoryProjectId', projectId)
  if (conversationId) context.set('supermemoryConversationId', conversationId)
  return context
}
function generationOptions(context: RequestContext<z.infer<typeof agentRequestContextSchema>>, vision = false) {
  const config = context.get('modelConfig')
  const projectId = context.get('supermemoryProjectId')
  const conversationId = context.get('supermemoryConversationId')
  const guardrails = strictResearchProcessors(context.get('tier'))
  const memory = projectId && conversationId ? strictSupermemoryProcessors(projectId, conversationId) : {}
  return {
    requestContext: context,
    model: vision ? configuredVisionModel(projectId) : configuredModel(context.get('tier'), projectId),
    modelSettings: { maxRetries: 0 },
    // The fixed gateway does not resolve server-side Responses item references.
    // Expand tool history into ordinary input items so every request is self-contained.
    providerOptions: vision
      ? { openai: { store: false } }
      : { openai: { reasoningEffort: config.reasoningEffort, strictJsonSchema: true, store: false } },
    inputProcessors: [...guardrails.inputProcessors, ...(memory.inputProcessors || [])],
    outputProcessors: [...guardrails.outputProcessors, ...(memory.outputProcessors || [])],
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
  if (error instanceof TripWire) return {
    status: 422,
    body: { code: 'mastra_guardrail_blocked', message: '请求或模型输出未通过安全处理器，已直接阻断。' },
  }
  if (error instanceof MastraEvalContractError) return {
    status: 422,
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
          { type: 'text' as const, text: structuredJsonValue(payload) },
          ...body.attachment_images.map(image => ({ type: 'image' as const, image: image.data_url })),
        ]
        const vision = body.attachment_images.length > 0
        const response = await ideaClarificationAgent.generate([{ role: 'user', content }], {
          ...generationOptions(context, vision),
          ...(body.memory_resource && body.memory_thread ? {
            memory: { resource: body.memory_resource, thread: body.memory_thread },
          } : {}),
          structuredOutput: { schema: adaptiveClarificationResultSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        const result = adaptiveClarificationResultSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: vision ? 'vision' : body.tier, model: vision ? visionModelName(context.get('supermemoryProjectId')) : config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, 'Idea 澄清模型调用')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/agents/project-slug', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, projectSlugRequestSchema)
        const context = requestContext(body.tier)
        const response = await projectSlugAgent.generate(structuredJsonValue({ confirmed_idea: body.idea }), {
          ...generationOptions(context),
          structuredOutput: { schema: projectSlugResultSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        const result = projectSlugResultSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: body.tier, model: config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, '项目语义标识模型调用')
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
        const response = await supervisionIntentAgent.generate(structuredJsonValue({
          latest_user_message: body.message,
          project_context: body.project_context,
          recent_conversation: body.transcript,
        }), {
          ...generationOptions(context),
          ...(body.memory_resource && body.memory_thread ? {
            memory: { resource: body.memory_resource, thread: body.memory_thread },
          } : {}),
          structuredOutput: { schema: supervisionIntentSchema, errorStrategy: 'strict', jsonPromptInjection: false },
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
  registerApiRoute('/internal/agents/document-reply', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, documentReplyRequestSchema)
        const context = requestContext('document', undefined, body.project_id)
        const response = await documentReplyAgent.generate(structuredJsonValue({
          user_message: body.user_message,
          context: body.context,
          draft_reply: body.draft_reply,
          purpose: body.purpose,
        }), {
          ...generationOptions(context),
          structuredOutput: { schema: documentReplyResultSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        const result = documentReplyResultSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: 'document', model: config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, '文档文本回复模型调用')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/agents/paper-translate', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, paperSectionTranslateRequestSchema)
        const context = requestContext('document', undefined, body.project_id)
        const response = await paperTranslationAgent.generate(structuredJsonValue({
          section_id: body.section_id,
          heading: body.heading,
          source: body.source,
        }), {
          ...generationOptions(context),
          structuredOutput: { schema: paperSectionTranslateResultSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        const result = paperSectionTranslateResultSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: 'document', model: config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, '论文章节中译模型调用')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/agents/paper-revise', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, paperSectionReviseRequestSchema)
        const context = requestContext('document', undefined, body.project_id)
        const response = await paperRevisionAgent.generate(structuredJsonValue({
          section_id: body.section_id,
          heading: body.heading,
          source: body.source,
          project_context: body.project_context,
        }), {
          ...generationOptions(context),
          structuredOutput: { schema: paperSectionReviseResultSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        const result = paperSectionReviseResultSchema.parse(response.object)
        const config = context.get('modelConfig')
        return c.json({ result, route: { tier: 'document', model: config.model, reasoning_effort: config.reasoningEffort } })
      } catch (error) {
        const failure = routeError(error, '论文章节修订模型调用')
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
        const response = await experimentPlanningAgent.generate(structuredJsonValue({
          project_id: body.project_id, idea_version: body.idea_version, planning_context: body.planning_context,
        }), {
          ...generationOptions(context),
          structuredOutput: { schema: experimentPlanSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        return c.json({ result: experimentPlanSchema.parse(response.object) })
      } catch (error) {
        const failure = routeError(error, '实验计划模型调用')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/agents/coordinator', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, coordinatorRequestSchema)
        const context = requestContext(body.tier, undefined, body.project_id, body.memory_thread || `coordinator-${body.project_id}`)
        const response = await researchCoordinatorAgent.generate(structuredJsonValue({
          project_id: body.project_id,
          task: body.task,
          planning_context: body.planning_context,
        }), {
          ...generationOptions(context),
          maxSteps: 4,
          disableBackgroundTasks: true,
          memory: body.memory_resource && body.memory_thread ? { resource: body.memory_resource, thread: body.memory_thread } : undefined,
          delegation: {
            includeSubAgentToolResultsInModelContext: false,
            messageFilter: ({ messages }) => messages.filter(message => !containsToolInvocation(message.content)).slice(-6),
            onDelegationStart: ({ primitiveId, params }) => {
              if (!['idea_clarification', 'project_supervision', 'experiment_planning'].includes(primitiveId)) return { proceed: false, rejectionReason: '未经允许的专业 Agent 委派。' }
              if (typeof params.maxSteps === 'number' && params.maxSteps > 2) return { proceed: false, rejectionReason: '专业 Agent 单次最多执行 2 步。' }
              return { modifiedInstructions: '只返回审查结果或提案，不执行任何外部操作，不生成未经证实的事实。' }
            },
          },
          structuredOutput: { schema: coordinatorResultSchema, errorStrategy: 'strict', jsonPromptInjection: false },
        })
        return c.json({ result: coordinatorResultSchema.parse(response.object), route: { tier: body.tier, model: context.get('modelConfig').model, reasoning_effort: context.get('modelConfig').reasoningEffort, max_steps: 4 } })
      } catch (error) {
        const failure = routeError(error, '研究协调 Agent')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/evals/idea-dataset', {
    method: 'GET',
    handler: async c => {
      try {
        return c.json(await ensureIdeaDataset(mastra))
      } catch (error) {
        const failure = routeError(error, 'Idea Dataset')
        return c.json(failure.body, safeStatus(failure.status))
      }
    },
  }),
  registerApiRoute('/internal/evals/idea-contract', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await parsedBody(c, z.object({
          input: z.unknown(),
          output: z.unknown(),
          ground_truth: z.unknown().optional(),
        }).strict())
        const result = await ideaClarificationContractScorer.run({ input: body.input, output: body.output, groundTruth: body.ground_truth })
        return c.json({ scorer_id: ideaClarificationContractScorer.id, score: result.score, reason: result.reason, run_id: result.runId })
      } catch (error) {
        const failure = routeError(error, 'Idea 输出评估')
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
  observability,
  logger: false,
  agents: { ideaClarificationAgent, projectSlugAgent, supervisionIntentAgent, experimentPlanningAgent, researchCoordinatorAgent },
  scorers: { ideaClarificationContractScorer },
  tools: { inspectIdeaDraftTool },
  workflows: { researchBootstrapWorkflow, projectChatWorkflow, supervisionReportsWorkflow, approvalGateWorkflow },
  server: {
    host: '127.0.0.1', port: 4111, studioHost: '127.0.0.1', studioPort: 4111,
    build: { swaggerUI: true, openAPIDocs: true }, apiRoutes,
  },
})
