import { describe, expect, it } from 'vitest'
import { parseBibTeX } from '../src/related-work/bibtex.js'

describe('BibTeX seed parsing', () => {
  it('extracts nested fields, filters "others", and normalizes identifiers', () => {
    const parsed = parseBibTeX(`@article{vaswani2017,
  author={Ashish Vaswani and Noam Shazeer and Niki Parmar and others},
  title={Attention Is All You Need},
  journal={Advances in Neural Information Processing Systems},
  year={2017},
  doi={https://doi.org/10.1000/ABC},
  abstract={The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.}
}`)
    expect(parsed.title).toBe('Attention Is All You Need')
    expect(parsed.authors).toEqual(['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'])
    expect(parsed.venue).toBe('Advances in Neural Information Processing Systems')
    expect(parsed.year).toBe(2017)
    expect(parsed.doi).toBe('10.1000/abc')
    expect(parsed.authors_truncated).toBe(true)
    expect(parsed.abstract).toContain('dominant sequence transduction')
  })

  it('reads arXiv eprint entries and keeps non-other authors', () => {
    const parsed = parseBibTeX(`@misc{example,
  author={Alice Example and Bob Sample},
  title={{A} {Nested} {Title}},
  archiveprefix={arXiv},
  eprint={2401.00001},
  year={2024}
}`)
    expect(parsed.title).toBe('A Nested Title')
    expect(parsed.arxiv_id).toBe('2401.00001')
    expect(parsed.authors).toHaveLength(2)
  })
})
