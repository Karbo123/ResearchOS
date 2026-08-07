import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertKnowledgePathForKind,
  knowledgeDocumentFrontMatter,
  knowledgeDocumentFrontMatterJsonSchema,
  knowledgeDocumentId,
} from '../src/knowledge-document-contracts.js'
import { parseKnowledgeMarkdown } from '../src/knowledge-markdown-parser.js'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/memory-v2')
const projectId = 'fixture-memory-1a2b'

function fixture(name: string): string {
  return readFileSync(resolve(fixtureRoot, name), 'utf8')
}

describe('Memory v2 knowledge document contracts', () => {
  it('accepts readable IDs and rejects UUID-shaped document identities', () => {
    expect(knowledgeDocumentId.parse('paper:pointnet-2017')).toBe('paper:pointnet-2017')
    expect(knowledgeDocumentId.parse('experiment:method-ablation/plan')).toBe('experiment:method-ablation/plan')
    expect(() => knowledgeDocumentId.parse('paper:60145276-6a59-4a1d-880e-b5f0cc3db2e9')).toThrow(/UUID/)
  })

  it('keeps paths allowlisted by semantic kind', () => {
    expect(assertKnowledgePathForKind('research/idea/current.md', 'idea')).toBe('research/idea/current.md')
    expect(assertKnowledgePathForKind('research/experiments/method/ablation/runs/seed-13/result.md', 'run_result')).toContain('result.md')
    expect(() => assertKnowledgePathForKind('research/idea/other.md', 'idea')).toThrow('knowledge_path_kind_mismatch')
    expect(() => assertKnowledgePathForKind('../.env', 'idea')).toThrow('knowledge_path_invalid')
  })

  it('exports a strict JSON Schema for API and documentation consumers', () => {
    expect(knowledgeDocumentFrontMatterJsonSchema).toMatchObject({ type: 'object', additionalProperties: false })
    expect((knowledgeDocumentFrontMatterJsonSchema as { required?: string[] }).required).toEqual(expect.arrayContaining(['schema', 'project_id', 'id', 'kind', 'title', 'status']))
  })

  it('rejects unknown front matter fields', () => {
    expect(() => knowledgeDocumentFrontMatter.parse({
      schema: 'researchos/knowledge-document@1', project_id: projectId, id: 'idea:current', kind: 'idea', title: 'Idea', status: 'draft', hidden_command: 'rm',
    })).toThrow()
  })
})

describe('Memory v2 Markdown AST parser', () => {
  it('parses Chinese Idea content without collapsing Markdown structure', () => {
    const source = fixture('idea-current.zh-CN.md').replace(
      '分离建模局部几何不确定性和批次多样性，可以减少重复标注，并改善长尾类别的召回率。',
      Array.from({ length: 80 }, () => '分离建模局部几何不确定性和批次多样性。').join(''),
    )
    const parsed = parseKnowledgeMarkdown(source, projectId, 'research/idea/current.md', { target_tokens: 64, hard_max_tokens: 160 })
    expect(parsed.frontmatter).toMatchObject({ id: 'idea:current', kind: 'idea', status: 'reviewed' })
    expect(parsed.body).toContain('## Core hypothesis\n\n分离建模')
    expect(parsed.headings.map(item => item.title)).toContain('Proposed method')
    expect(parsed.chunks.every(chunk => chunk.token_count <= 160)).toBe(true)
    expect(parsed.chunks.some(chunk => chunk.heading_path.includes('Core hypothesis'))).toBe(true)
  })

  it('keeps tables and fenced code blocks intact when they fit the hard token limit', () => {
    const paper = parseKnowledgeMarkdown(fixture('paper-summary.en.md'), projectId, 'research/related-work/papers/geometric-sampling-2024.md', { target_tokens: 80, hard_max_tokens: 300 })
    const plan = parseKnowledgeMarkdown(fixture('experiment-plan.md'), projectId, 'research/experiments/method/method-ablation/plan.md', { target_tokens: 80, hard_max_tokens: 300 })
    expect(paper.chunks.some(chunk => chunk.content.includes('| ShapeSet-A | official | 5% |'))).toBe(true)
    expect(plan.chunks.some(chunk => chunk.content.includes("export const variants = ['diversity', 'geometry', 'combined']"))).toBe(true)
  })

  it('produces deterministic chunk identities and exact line locators', () => {
    const source = fixture('run-result.zh-CN.md').replace(
      '该文档只描述测试形状，不表示真实科研结果。',
      Array.from({ length: 80 }, () => '该文档只描述测试形状，不表示真实科研结果。').join(''),
    )
    const first = parseKnowledgeMarkdown(source, projectId, 'research/experiments/method/method-ablation/runs/seed-13/result.md', { target_tokens: 64, hard_max_tokens: 120 })
    const second = parseKnowledgeMarkdown(source, projectId, 'research/experiments/method/method-ablation/runs/seed-13/result.md', { target_tokens: 64, hard_max_tokens: 120 })
    expect(first.chunks.map(chunk => chunk.chunk_key)).toEqual(second.chunks.map(chunk => chunk.chunk_key))
    const metrics = first.chunks.find(chunk => chunk.content.includes('## Metrics'))
    expect(metrics).toBeDefined()
    expect(source.split('\n')[metrics!.line_start - 1]).toBe('## Metrics')
    expect(metrics!.line_end).toBeGreaterThanOrEqual(metrics!.line_start)
  })

  it('splits an oversized paragraph by token budget without silent tail loss', () => {
    const base = fixture('idea-current.zh-CN.md')
    const longText = Array.from({ length: 500 }, (_, index) => `术语${index}`).join('，')
    const source = base.replace('分离建模局部几何不确定性和批次多样性，可以减少重复标注，并改善长尾类别的召回率。', longText)
    const parsed = parseKnowledgeMarkdown(source, projectId, 'research/idea/current.md', { target_tokens: 64, hard_max_tokens: 80 })
    expect(parsed.chunks.every(chunk => chunk.token_count <= 80)).toBe(true)
    expect(parsed.chunks.map(chunk => chunk.content).join('')).toContain('术语499')
  })

  it('fails closed for project mismatch, duplicate YAML keys, and kind/path mismatch', () => {
    const source = fixture('idea-current.zh-CN.md')
    expect(() => parseKnowledgeMarkdown(source, 'another-project-2b3c', 'research/idea/current.md')).toThrow('knowledge_project_mismatch')
    expect(() => parseKnowledgeMarkdown(source.replace('status: reviewed', 'status: reviewed\nstatus: draft'), projectId, 'research/idea/current.md')).toThrow('knowledge_frontmatter_yaml_invalid')
    expect(() => parseKnowledgeMarkdown(source, projectId, 'research/related-work/papers/idea.md')).toThrow('knowledge_path_kind_mismatch')
  })
})
