import assert from 'node:assert/strict'
import { AREA_DEFAULT_TAB, AREA_TABS, TAB_AREA, resolveWorkspaceLocation, resolveWorkspaceParts, resolveWorkspacePath, workspacePath } from '../apps/web/src/navigation.js'

assert.deepEqual(AREA_TABS.overview, ['overview', 'idea', 'approvals', 'reports'], 'overview tabs must follow the new project-overview contract')
assert.deepEqual(AREA_TABS.related_work, ['literature', 'visualization', 'seed_expansion'], 'related work tabs must follow the new research tasks')
assert.deepEqual(AREA_TABS.implementation, ['method', 'reproduction'], 'implementation must keep only method and related-work implementation')
assert.deepEqual(AREA_TABS.paper, ['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'], 'paper tabs must follow the paper section contract')

assert.equal(AREA_DEFAULT_TAB.overview, 'overview')
assert.equal(AREA_DEFAULT_TAB.related_work, 'literature')
assert.equal(AREA_DEFAULT_TAB.implementation, 'method')
assert.equal(AREA_DEFAULT_TAB.paper, 'introduction')

for (const [area, tabs] of Object.entries(AREA_TABS)) {
  for (const tab of tabs) {
    assert.equal(TAB_AREA[tab as keyof typeof TAB_AREA], area, `${String(tab)} must stay inside ${area}`)
  }
}

const legacyMethod = resolveWorkspaceParts('#project/p1/method/method_design')
assert.deepEqual(legacyMethod, { projectId: 'p1', area: 'implementation', tab: 'method' })

const legacyPaperExperiments = resolveWorkspaceParts('#project/p1/paper/experiments')
assert.deepEqual(legacyPaperExperiments, { projectId: 'p1', area: 'implementation', tab: 'method' })

const legacyPaperReports = resolveWorkspaceParts('#project/p1/paper/daily_reports')
assert.deepEqual(legacyPaperReports, { projectId: 'p1', area: 'overview', tab: 'reports' })

const legacyReportsAlias = resolveWorkspaceParts('#project/p1/paper/reports')
assert.deepEqual(legacyReportsAlias, { projectId: 'p1', area: 'overview', tab: 'reports' })

const legacyPaperOutline = resolveWorkspaceParts('#project/p1/paper/paper_outline')
assert.deepEqual(legacyPaperOutline, { projectId: 'p1', area: 'paper', tab: 'introduction' })

const legacyPaperFigures = resolveWorkspaceParts('#project/p1/paper/paper_figures')
assert.deepEqual(legacyPaperFigures, { projectId: 'p1', area: 'paper', tab: 'paper_method' })

const legacySpec = resolveWorkspaceParts('#project/p1/overview/overview_spec')
assert.deepEqual(legacySpec, { projectId: 'p1', area: 'overview', tab: 'idea' })

assert.equal(workspacePath('mnist-cnn-example', 'overview', 'overview'), '/project/mnist-cnn-example/overview/overview')
assert.equal(workspacePath('mnist-cnn-example', 'overview', 'idea'), '/project/mnist-cnn-example/overview/idea')
assert.equal(workspacePath('mnist-cnn-example', 'paper', 'paper_method'), '/project/mnist-cnn-example/paper/paper-method')
assert.equal(workspacePath('mnist-cnn-example', 'related_work', 'seed_expansion'), '/project/mnist-cnn-example/related_work/seed-expansion')

assert.deepEqual(resolveWorkspacePath('/project/mnist-cnn-example/overview/overview'), {
  projectRef: 'mnist-cnn-example', area: 'overview', tab: 'overview', legacyHash: false,
})
assert.deepEqual(resolveWorkspacePath('/project/mnist-cnn-example/overview/idea'), {
  projectRef: 'mnist-cnn-example', area: 'overview', tab: 'idea', legacyHash: false,
})
assert.deepEqual(resolveWorkspacePath('/project/mnist-cnn-example/paper/related-work'), {
  projectRef: 'mnist-cnn-example', area: 'paper', tab: 'paper_related_work', legacyHash: false,
})
assert.deepEqual(resolveWorkspacePath('/project/p1/paper/experiments'), {
  projectRef: 'p1', area: 'implementation', tab: 'method', legacyHash: false,
})

assert.deepEqual(resolveWorkspaceLocation('/', '#project/p1/overview/overview'), {
  projectRef: 'p1', area: 'overview', tab: 'overview', legacyHash: true,
})

assert.equal(resolveWorkspaceParts('#project/p1/paper/not_a_tab'), null)
assert.equal(resolveWorkspaceParts('#project/p1/unknown/overview'), null)
assert.equal(resolveWorkspacePath('/project/p1/unknown/overview'), null)

console.log('navigation check passed')
