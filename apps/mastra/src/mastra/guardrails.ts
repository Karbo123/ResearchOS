import {
  PromptInjectionDetector,
  RegexFilterProcessor,
  SystemPromptScrubber,
  UnicodeNormalizer,
  type InputProcessor,
  type OutputProcessor,
} from '@mastra/core/processors'
import type { ModelTier } from './contracts.js'
import { configuredModel } from './agents/research-agents.js'

const SYSTEM_PROMPT_PATTERNS = [
  'system\\s+prompt',
  'developer\\s+message',
  'hidden\\s+instructions?',
  'internal\\s+policy',
  'reveal\\s+(?:the\\s+)?(?:prompt|instructions?)',
]

export function strictResearchProcessors(tier: ModelTier): {
  inputProcessors: InputProcessor[]
  outputProcessors: OutputProcessor[]
} {
  const detectorModel = configuredModel(tier)
  return {
    inputProcessors: [
      new UnicodeNormalizer({ stripControlChars: true, preserveEmojis: true, collapseWhitespace: true, trim: true }),
      new RegexFilterProcessor({ presets: ['secrets'], strategy: 'block', phase: 'input' }),
      new PromptInjectionDetector({
        model: detectorModel,
        strategy: 'block',
        threshold: 0.85,
        lastMessageOnly: true,
        includeScores: false,
      }),
    ],
    outputProcessors: [
      new RegexFilterProcessor({ presets: ['secrets'], strategy: 'block', phase: 'output' }),
      new SystemPromptScrubber({
        model: detectorModel,
        strategy: 'block',
        customPatterns: SYSTEM_PROMPT_PATTERNS,
        lastMessageOnly: true,
        includeDetections: false,
      }),
    ],
  }
}
