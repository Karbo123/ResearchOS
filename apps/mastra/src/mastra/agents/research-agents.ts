import { createOpenAI } from '@ai-sdk/openai'
import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { agentRequestContextSchema, type ModelTier } from '../contracts.js'
import { loadModelConfig, ModelConfigurationError } from '../model-config.js'
import { proxyFetch } from '../proxy-fetch.js'
import { documentReplySkill, experimentPlanningSkill, ideaClarificationSkill, paperRevisionSkill, paperTranslationSkill, projectSlugSkill, supervisionIntentSkill, workflowEditSkill } from '../skills/research-skills.js'
import { inspectIdeaDraftTool } from '../tools/inspect-idea-draft.js'

const ideaMemory = new Memory({ options: { lastMessages: 12 } })

export function configuredModel(tier: ModelTier, projectId?: string) {
  const config = loadModelConfig(tier, projectId)
  const model = config.model.replace(/^openai\//i, '').trim()
  if (!model || model.includes('/')) {
    throw new ModelConfigurationError(`${tier} Responses 模型名无效`)
  }
  return createOpenAI({ baseURL: config.url, apiKey: config.key, fetch: proxyFetch() }).responses(model)
}

export function configuredVisionModel(projectId?: string) {
  return configuredModel('vision', projectId)
}

export function visionModelName(projectId?: string): string {
  return loadModelConfig('vision', projectId).model
}

export const ideaClarificationAgent = new Agent({
  id: 'idea-clarification-agent',
  name: 'Research Idea Clarification Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: ({ requestContext }) => {
    const mode = requestContext.get('clarificationMode') === 'detailed'
      ? 'Ask four to eight concise grouped questions only across relevant unresolved dimensions.'
      : 'Minimize interruption and ask no more than two compact groups of materially blocking questions.'
    return `${ideaClarificationSkill.instructions}\n${mode}`
  },
  model: () => configuredModel('complex'),
  memory: ideaMemory,
  skills: [ideaClarificationSkill],
  tools: { inspectIdeaDraftTool },
})

export const projectSlugAgent = new Agent({
  id: 'semantic-project-slug-agent',
  name: 'Semantic Project Slug Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: projectSlugSkill.instructions,
  model: () => configuredModel('medium'),
  skills: [projectSlugSkill],
})

export const supervisionIntentAgent = new Agent({
  id: 'supervision-intent-agent',
  name: 'Project Supervision Intent Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: supervisionIntentSkill.instructions,
  model: () => configuredModel('complex'),
  memory: ideaMemory,
  skills: [supervisionIntentSkill],
})

export const documentReplyAgent = new Agent({
  id: 'document-reply-agent',
  name: 'Readable Document Reply Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: documentReplySkill.instructions,
  model: () => configuredModel('document'),
  skills: [documentReplySkill],
})

export const paperTranslationAgent = new Agent({
  id: 'paper-section-translation-agent',
  name: 'Paper Section Chinese Translation Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: paperTranslationSkill.instructions,
  model: () => configuredModel('document'),
  skills: [paperTranslationSkill],
})

export const paperRevisionAgent = new Agent({
  id: 'paper-section-revision-agent',
  name: 'Paper Section Revision Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: paperRevisionSkill.instructions,
  model: () => configuredModel('document'),
  skills: [paperRevisionSkill],
})

export const experimentPlanningAgent = new Agent({
  id: 'experiment-planning-agent',
  name: 'Evidence-grounded Experiment Planning Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: experimentPlanningSkill.instructions,
  model: () => configuredModel('complex'),
  skills: [experimentPlanningSkill],
})

export const workflowEditAgent = new Agent({
  id: 'workflow-edit-agent',
  name: 'Project Workflow Edit Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: workflowEditSkill.instructions,
  model: () => configuredModel('complex'),
  skills: [workflowEditSkill],
})

export const researchCoordinatorAgent = new Agent({
  id: 'research-coordinator-agent',
  name: 'Research Coordination Agent',
  requestContextSchema: agentRequestContextSchema,
  maxRetries: 0,
  instructions: `
Coordinate a bounded research planning request by delegating only to the named specialist agents.
Use the idea clarification specialist for unresolved research specification gaps, the project supervision specialist
for existing-project intent and approval boundaries, and the experiment planning specialist for evidence-grounded
topic-specific planning. Treat all delegated results as proposals or review notes, never as executed research.
Do not invent evidence, datasets, metrics, resources, code, citations, approvals, or results. Do not execute tools,
change project state, access files, call arbitrary URLs, or bypass the approval boundary. Return only the requested strict JSON object.
`,
  model: () => configuredModel('complex'),
  memory: ideaMemory,
  agents: {
    idea_clarification: ideaClarificationAgent,
    project_supervision: supervisionIntentAgent,
    experiment_planning: experimentPlanningAgent,
  },
})
