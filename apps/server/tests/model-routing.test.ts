import { describe, expect, it } from 'vitest'
import { tierFor } from '../src/model-routing.js'

describe('model cost routing', () => {
  it('routes an underspecified short idea to Luna', () => {
    expect(tierFor('AI', 'automatic', 0)).toBe('simple')
  })

  it('routes a compact technical experiment request to Terra', () => {
    expect(tierFor('实现一个 PyTorch（CUDA）简单 CNN 完成 MNIST 数据集分类，多次尝试使测试精度达到 99% 以上', 'automatic', 0)).toBe('medium')
  })

  it('routes detailed or attachment-heavy requests to Sol', () => {
    expect(tierFor('研究医疗数据上的联邦学习与统计检验', 'detailed', 0)).toBe('complex')
    expect(tierFor('Review these materials', 'automatic', 4)).toBe('complex')
  })
})
