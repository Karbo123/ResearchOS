import { z } from 'zod'

export const projectSlugSchema = z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/)
export type ProjectSlug = z.infer<typeof projectSlugSchema>

export const workflowCapabilitySchema = z.enum([
  'context.project_snapshot',
  'context.finalize',
  'conversation.agent_turn',
  'material.extract',
  'literature.search',
  'literature.review',
  'experiment.plan',
  'experiment.run',
  'paper.translate',
  'paper.revise',
  'paper.compile',
  'report.generate',
  'governance.approval',
  'workflow.edit',
  'noop',
])
export type WorkflowCapability = z.infer<typeof workflowCapabilitySchema>

export const workflowConcurrencySchema = z.enum(['thread-serial', 'project-serial', 'parallel'])
export type WorkflowConcurrency = z.infer<typeof workflowConcurrencySchema>

export const workflowRetrySchema = z.union([
  z.object({
    max_attempts: z.number().int().min(1).max(10).default(3),
    backoff_seconds: z.number().int().min(1).max(3600).default(5),
  }).strict(),
  z.literal('explicit'),
])

export const workflowGroupSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  label_key: z.string().trim().min(1).max(160),
  description_key: z.string().trim().min(1).max(240).optional(),
}).strict()
export type WorkflowGroup = z.infer<typeof workflowGroupSchema>

export const workflowNodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  group: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  capability: workflowCapabilitySchema,
  label_key: z.string().trim().min(1).max(160),
  description_key: z.string().trim().min(1).max(240).optional(),
  requires: z.array(z.string().regex(/^[a-z][a-z0-9_.-]*$/)).default([]),
  retry: workflowRetrySchema.default({ max_attempts: 3, backoff_seconds: 5 }),
  timeout_seconds: z.number().int().min(1).max(86_400).default(300),
  concurrency: workflowConcurrencySchema.default('thread-serial'),
}).strict()
export type WorkflowNode = z.infer<typeof workflowNodeSchema>

export const workflowEdgeSchema = z.object({
  from: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  to: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  condition: z.enum(['always', 'success']).default('success'),
}).strict()
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>

export const workflowEventTypeSchema = z.string().regex(/^[a-z][a-z0-9_.-]*$/)
export type WorkflowEventType = z.infer<typeof workflowEventTypeSchema>

export const workflowTriggerSchema = z.object({
  event_type: workflowEventTypeSchema,
  node_id: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  mode: z.enum(['root', 'follow']).default('root'),
}).strict()
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>

export const projectWorkflowDefinitionV2Schema = z.object({
  schemaVersion: z.literal(2),
  templateVersion: z.string().trim().min(1).max(200),
  groups: z.array(workflowGroupSchema).min(1),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema).default([]),
  triggers: z.array(workflowTriggerSchema).min(1),
}).strict().superRefine((definition, context) => {
  const nodeIds = new Set(definition.nodes.map(node => node.id))
  const groupIds = new Set(definition.groups.map(group => group.id))
  if (nodeIds.size !== definition.nodes.length) {
    context.addIssue({ code: 'custom', path: ['nodes'], message: 'workflow node ids must be unique' })
  }
  if (groupIds.size !== definition.groups.length) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'workflow group ids must be unique' })
  }
  for (const node of definition.nodes) {
    if (!groupIds.has(node.group)) {
      context.addIssue({ code: 'custom', path: ['nodes', node.id, 'group'], message: 'node group must exist' })
    }
    for (const requirement of node.requires) {
      if (!nodeIds.has(requirement)) {
        context.addIssue({ code: 'custom', path: ['nodes', node.id, 'requires'], message: 'required node must exist' })
      }
    }
  }
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      context.addIssue({ code: 'custom', path: ['edges'], message: 'edge endpoints must exist' })
    }
  }
  for (const trigger of definition.triggers) {
    if (!nodeIds.has(trigger.node_id)) {
      context.addIssue({ code: 'custom', path: ['triggers'], message: 'trigger node must exist' })
    }
  }
})
export type ProjectWorkflowDefinitionV2 = z.infer<typeof projectWorkflowDefinitionV2Schema>

export const workflowRuntimeStatusSchema = z.enum(['waiting', 'dispatching', 'blocked', 'failed', 'paused'])
export type WorkflowRuntimeStatus = z.infer<typeof workflowRuntimeStatusSchema>

export const workflowNodeRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
])
export type WorkflowNodeRunStatus = z.infer<typeof workflowNodeRunStatusSchema>

export const workflowTaskStatusSchema = z.enum(['queued', 'retrying', 'running', 'succeeded', 'failed', 'cancelled'])
export type WorkflowTaskStatus = z.infer<typeof workflowTaskStatusSchema>

export const workflowEventSchema = z.object({
  id: z.string().uuid(),
  project_id: projectSlugSchema,
  sequence: z.number().int().positive(),
  event_type: workflowEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  source: z.string().trim().min(1).max(200).default('api'),
  definition_version: z.number().int().positive(),
  causation_id: z.string().uuid().nullable().default(null),
  correlation_id: z.string().min(1).max(255),
  idempotency_key: z.string().trim().min(1).max(255),
  created_at: z.string(),
  processed_at: z.string().nullable(),
}).strict()
export type WorkflowEvent = z.infer<typeof workflowEventSchema>

export const workflowEventAppendInputSchema = z.object({
  event_type: workflowEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  source: z.string().trim().min(1).max(200).default('api'),
  correlation_id: z.string().min(1).max(255).optional(),
  idempotency_key: z.string().trim().min(1).max(255).optional(),
}).strict()
export type WorkflowEventAppendInput = z.infer<typeof workflowEventAppendInputSchema>

export const workflowGraphSnapshotSchema = z.object({
  project_id: projectSlugSchema,
  definition_version: z.number().int().positive(),
  source_hash: z.string().min(1).max(128),
  git_commit: z.string().min(1).max(120).nullable(),
  status: workflowRuntimeStatusSchema,
  last_error: z.string().nullable(),
  groups: z.array(workflowGroupSchema),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  triggers: z.array(workflowTriggerSchema),
  runtime: z.object({
    status: workflowRuntimeStatusSchema,
    state_version: z.number().int().nonnegative(),
    event_cursor: z.number().int().nonnegative(),
    coordinator_lease_token: z.string().nullable(),
    lease_until: z.string().nullable(),
    updated_at: z.string(),
  }).strict(),
  node_runs: z.array(z.object({
    id: z.string().uuid(),
    node_id: z.string(),
    status: workflowNodeRunStatusSchema,
    attempt: z.number().int().nonnegative(),
    error_code: z.string().nullable(),
    blocked_reason: z.string().nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    input_ref: z.record(z.string(), z.unknown()).nullable(),
    output_ref: z.record(z.string(), z.unknown()).nullable(),
    task_id: z.string().nullable(),
    definition_version: z.number().int().positive(),
  }).strict()),
  tasks: z.array(z.object({
    id: z.string().uuid(),
    node_id: z.string().nullable(),
    status: workflowTaskStatusSchema,
    attempts: z.number().int().nonnegative(),
    error: z.string().nullable(),
    worker_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  }).strict()),
  events: z.array(z.object({
    sequence: z.number().int().positive(),
    event_type: workflowEventTypeSchema,
    correlation_id: z.string(),
    source: z.string(),
    definition_version: z.number().int().positive(),
    created_at: z.string(),
  }).strict()),
}).strict()
export type WorkflowGraphSnapshot = z.infer<typeof workflowGraphSnapshotSchema>
