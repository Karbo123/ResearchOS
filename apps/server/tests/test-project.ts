import { randomProjectSlugSuffix } from '../src/project-slug.js'

export function testProjectSlug(prefix = 'test-fixture'): string {
  if (!/^[a-z]{2,32}-[a-z]{2,32}$/.test(prefix)) throw new Error('test_project_slug_prefix_invalid')
  return `${prefix}-${randomProjectSlugSuffix()}`
}
