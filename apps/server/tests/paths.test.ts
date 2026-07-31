import { describe, expect, it } from 'vitest'
import { pathInside, projectsRoot } from '../src/paths.js'

describe('fixed workspace paths', () => {
  it('accepts a project child', () => expect(pathInside(projectsRoot, crypto.randomUUID())).toContain('projects'))
  it('rejects path traversal', () => expect(() => pathInside(projectsRoot, '..', '.env')).toThrow('path_outside_allowed_root'))
})
