import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { agentRequestContextSchema, type ModelTier } from '../contracts.js'
import { modelId } from '../model-config.js'
import { loadModelConfig } from '../model-config.js'
import { experimentPlanningSkill, ideaClarificationSkill, supervisionIntentSkill } from '../skills/research-skills.js'
import { inspectIdeaDraftTool } from '../tools/inspect-idea-draft.js'

const ideaMemory = new Memory({ options: { lastMessages: 12 } })

export function configuredModel(tier: ModelTier) {
  const config = loadModelConfig(tier)
  return { id: modelId(config.model), url: config.url, apiKey: config.key }
}

export const ideaClarificationAgent = new Agent({
  id: 'idea-clarification-agent',
  name: 'Research Idea Clarification Agent',
  requestContextSchema: agentRequestContextSchema,
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

export const supervisionIntentAgent = new Agent({
  id: 'supervision-intent-agent',
  name: 'Project Supervision Intent Agent',
  requestContextSchema: agentRequestContextSchema,
  instructions: supervisionIntentSkill.instructions,
  model: () => configuredModel('complex'),
  memory: ideaMemory,
  skills: [supervisionIntentSkill],
})

export const experimentPlanningAgent = new Agent({
  id: 'experiment-planning-agent',
  name: 'Evidence-grounded Experiment Planning Agent',
  requestContextSchema: agentRequestContextSchema,
  instructions: experimentPlanningSkill.instructions,
  model: () => configuredModel('complex'),
  skills: [experimentPlanningSkill],
})

export const researchCoordinatorAgent = new Agent({
  id: 'research-coordinator-agent',
  name: 'Research Coordination Agent',
  requestContextSchema: agentRequestContextSchema,
  instructions: `
Coordinate a bounded research planning request by delegating only to the named specialist agents.
Use the idea clarification specialist for unresolved research specification gaps, the project supervision specialist
for existing-project intent and approval boundaries, and the experiment planning specialist for evidence-grounded
topic-specific planning. Treat all delegated results as proposals or review notes, never as executed research.
Do not invent evidence, datasets, metrics, resources, code, citations, approvals, or results. Do not execute tools,
change project state, access files, call arbitrary URLs, or bypass the approval boundary. Return only the strict schema.
`,
  model: () => configuredModel('complex'),
  memory: ideaMemory,
  agents: {
    idea_clarification: ideaClarificationAgent,
    project_supervision: supervisionIntentAgent,
    experiment_planning: experimentPlanningAgent,
  },
})
