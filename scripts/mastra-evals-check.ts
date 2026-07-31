import { loadIdeaEvalCases, runIdeaQuickChecks, scoreIdeaContract } from '../apps/mastra/src/mastra/evals.js'

const cases = loadIdeaEvalCases()
const quickChecks = runIdeaQuickChecks(cases)
if (!quickChecks.passed) throw new Error(`Mastra Idea Dataset quick checks failed: ${JSON.stringify(quickChecks.checks)}`)

const accepted = scoreIdeaContract({
  draft: { title: 'A bounded research idea' },
  assistant_reply: '请确认研究问题和资源约束。',
  ready_for_confirmation: false,
  unresolved_items: ['dataset provenance'],
})
const rejected = scoreIdeaContract({ reply: 'not the public contract' })
if (accepted.score !== 1 || rejected.score !== 0) throw new Error('Mastra Idea contract scorer boundary failed')

console.log(JSON.stringify({ status: 'passed', dataset_version: '1.0', case_count: cases.length, quick_checks: quickChecks, scorer: { accepted: accepted.score, rejected: rejected.score } }, null, 2))
