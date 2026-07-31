export type ModelTier = 'simple' | 'medium' | 'complex'

const technicalExperimentSignal = /(?:\b(?:ablation|active learning|benchmark|classification|cnn|cuda|dataset|evaluation|experiment|federated learning|pytorch|statistical test|tensorflow)\b|主动学习|分类|数据集|联邦学习|多智能体|消融|统计检验|实验|精度|准确率)/iu

function threshold(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function tierFor(message: string, mode: 'automatic' | 'detailed', attachments: number): ModelTier {
  const simpleMax = threshold('RESEARCH_ROUTER_SIMPLE_MAX', 2)
  const mediumMax = Math.max(simpleMax + 1, threshold('RESEARCH_ROUTER_MEDIUM_MAX', 7))
  const characterCount = Array.from(message.trim()).length
  let score = Math.max(1, Math.ceil(characterCount / 120)) + attachments * 2
  if (technicalExperimentSignal.test(message)) score += 3
  if (mode === 'detailed') score += mediumMax + 1
  if (score <= simpleMax) return 'simple'
  if (score <= mediumMax) return 'medium'
  return 'complex'
}
