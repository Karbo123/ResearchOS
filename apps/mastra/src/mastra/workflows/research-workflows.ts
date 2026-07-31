import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { approvalGateInputSchema, approvalGateOutputSchema, approvalGateResumeSchema, chatWorkflowInputSchema, reportWorkflowInputSchema, researchWorkflowInputSchema } from '../contracts.js'
import { apiJson } from './api-client.js'

const searchOutputSchema = z.object({
  project_id: z.string().uuid(), task_id: z.string().uuid(), idempotency_key: z.string(), search: z.unknown(),
}).strict()
const searchStep = createStep({
  id: 'search-literature-and-resources', inputSchema: researchWorkflowInputSchema, outputSchema: searchOutputSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    search: await apiJson('/api/search', {
      method: 'POST', body: JSON.stringify({ project_id: inputData.project_id, limit: 8 }),
    }),
  }),
})

const evidenceReviewOutputSchema = z.object({
  status: z.literal('evidence_review_ready'), project_id: z.string().uuid(), task_id: z.string().uuid(), review: z.unknown(),
}).strict()
const evidenceReviewStep = createStep({
  id: 'evaluate-evidence-coverage', inputSchema: searchOutputSchema, outputSchema: evidenceReviewOutputSchema,
  execute: async ({ inputData }) => ({
    status: 'evidence_review_ready' as const,
    project_id: inputData.project_id,
    task_id: inputData.task_id,
    review: await apiJson(`/api/projects/${inputData.project_id}/novelty`),
  }),
})
export const researchBootstrapWorkflow = createWorkflow({
  id: 'research-bootstrap', inputSchema: researchWorkflowInputSchema, outputSchema: evidenceReviewOutputSchema,
}).then(searchStep).then(evidenceReviewStep).commit()

const chatResultSchema = z.object({ result: z.unknown() }).strict()
const chatStep = createStep({
  id: 'run-project-chat-agent', inputSchema: chatWorkflowInputSchema, outputSchema: chatResultSchema,
  execute: async ({ inputData }) => ({
    result: await apiJson('/api/chat', { method: 'POST', body: JSON.stringify(inputData) }),
  }),
})
export const projectChatWorkflow = createWorkflow({
  id: 'project-chat', inputSchema: chatWorkflowInputSchema, outputSchema: chatResultSchema,
}).then(chatStep).commit()

const activeProjectsOutputSchema = z.object({
  period: z.enum(['daily', 'weekly']), projectIds: z.array(z.string().uuid()),
}).strict()
const listActiveProjectsStep = createStep({
  id: 'list-active-projects', inputSchema: reportWorkflowInputSchema, outputSchema: activeProjectsOutputSchema,
  execute: async ({ inputData }) => {
    const projects = z.array(z.object({ id: z.string().uuid() }).passthrough()).parse(
      await apiJson('/api/projects?status=active'),
    )
    return { period: inputData.period, projectIds: projects.map(project => project.id) }
  },
})
const reportsOutputSchema = z.object({
  period: z.enum(['daily', 'weekly']), reportIds: z.array(z.string().uuid()), projectCount: z.number().int().min(0),
}).strict()
const generateReportsStep = createStep({
  id: 'generate-project-reports', inputSchema: activeProjectsOutputSchema, outputSchema: reportsOutputSchema,
  execute: async ({ inputData }) => {
    const reportIds: string[] = []
    for (const projectId of inputData.projectIds) {
      const report = z.object({ id: z.string().uuid() }).passthrough().parse(await apiJson('/api/reports', {
        method: 'POST', body: JSON.stringify({ project_id: projectId, period: inputData.period }),
      }))
      reportIds.push(report.id)
    }
    return { period: inputData.period, reportIds, projectCount: inputData.projectIds.length }
  },
})
export const supervisionReportsWorkflow = createWorkflow({
  id: 'supervision-reports', inputSchema: reportWorkflowInputSchema, outputSchema: reportsOutputSchema,
  schedule: [
    { id: 'daily', cron: '0 9 * * *', timezone: 'Asia/Shanghai', inputData: { period: 'daily' } },
    { id: 'weekly', cron: '30 9 * * 1', timezone: 'Asia/Shanghai', inputData: { period: 'weekly' } },
  ],
}).then(listActiveProjectsStep).then(generateReportsStep).commit()

const approvalGateStep = createStep({
  id: 'human-approval',
  inputSchema: approvalGateInputSchema,
  outputSchema: approvalGateOutputSchema,
  suspendSchema: z.object({
    reason: z.string(), project_id: z.string().uuid(), proposal_id: z.string().uuid(), tool_name: z.string(), args_fingerprint: z.string(), policy_version: z.string(),
  }).strict(),
  resumeSchema: approvalGateResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return await suspend({
        reason: inputData.reason,
        project_id: inputData.project_id,
        proposal_id: inputData.proposal_id,
        tool_name: inputData.tool_name,
        args_fingerprint: inputData.args_fingerprint,
        policy_version: inputData.policy_version,
      })
    }
    const decision = await apiJson(`/api/proposals/${inputData.proposal_id}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: resumeData.approved ? 'approved' : 'rejected',
        actor: resumeData.actor,
        comment: resumeData.comment ?? null,
        mastra_run_id: inputData.mastra_run_id ?? null,
        tool_name: inputData.tool_name,
        args_fingerprint: inputData.args_fingerprint,
        policy_version: inputData.policy_version,
      }),
    })
    return {
      status: resumeData.approved ? 'approved' as const : 'rejected' as const,
      project_id: inputData.project_id,
      proposal_id: inputData.proposal_id,
      tool_name: inputData.tool_name,
      args_fingerprint: inputData.args_fingerprint,
      policy_version: inputData.policy_version,
      decision,
    }
  },
})

export const approvalGateWorkflow = createWorkflow({
  id: 'proposal-approval-gate', inputSchema: approvalGateInputSchema, outputSchema: approvalGateOutputSchema,
}).then(approvalGateStep).commit()
