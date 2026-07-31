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
