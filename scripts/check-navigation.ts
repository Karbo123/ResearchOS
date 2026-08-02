import assert from 'node:assert/strict'
import { AREA_DEFAULT_TAB, AREA_TABS, TAB_AREA, resolveWorkspaceLocation, resolveWorkspaceParts, resolveWorkspacePath, workspacePath } from '../apps/web/src/navigation.js'

const experimentTabs = ['experiments', 'experiment_queue', 'experiment_metrics', 'artifacts', 'lineage']
const reportTabs = ['daily_reports', 'weekly_reports', 'feedback_inbox', 'feedback_audit', 'reports']
const implementationTabs = AREA_TABS.implementation || []
const overviewTabs = AREA_TABS.overview || []

for (const tab of experimentTabs) {
  assert.equal(TAB_AREA[tab as keyof typeof TAB_AREA], 'implementation', `${tab} must belong to implementation`)
  assert.ok(implementationTabs.includes(tab as (typeof implementationTabs)[number]), `${tab} must render inside implementation`)
}

for (const tab of reportTabs) {
  assert.equal(TAB_AREA[tab as keyof typeof TAB_AREA], 'overview', `${tab} must belong to overview`)
  assert.ok(overviewTabs.includes(tab as (typeof overviewTabs)[number]), `${tab} must render inside overview`)
}

for (const tab of ['reproduction', 'comparison', 'method_design', 'code_workspace', 'policies', 'approvals']) {
  assert.ok(implementationTabs.includes(tab as (typeof implementationTabs)[number]), `${tab} must render inside implementation`)
}

for (const tab of ['paper', 'paper_outline', 'paper_citations', 'paper_figures', 'paper_data', 'paper_compile', 'paper_review']) {
  assert.equal(TAB_AREA[tab as keyof typeof TAB_AREA], 'paper', `${tab} must stay in paper writing`)
}

assert.equal(AREA_DEFAULT_TAB.paper, 'paper_outline', 'paper area must default to outline')
assert.equal(AREA_DEFAULT_TAB.implementation, 'reproduction', 'implementation area must default to related-work reproduction')
assert.deepEqual(AREA_TABS.implementation.slice(0, 2), ['method_design', 'code_workspace'], 'implementation tabs must start with the method workspace')

const legacyMethod = resolveWorkspaceParts('#project/p1/method/method_design')
assert.deepEqual(legacyMethod, { projectId: 'p1', area: 'implementation', tab: 'method_design' })

const legacyPaperExperiments = resolveWorkspaceParts('#project/p1/paper/experiments')
assert.deepEqual(legacyPaperExperiments, { projectId: 'p1', area: 'implementation', tab: 'experiments' })

const legacyPaperReports = resolveWorkspaceParts('#project/p1/paper/daily_reports')
assert.deepEqual(legacyPaperReports, { projectId: 'p1', area: 'overview', tab: 'daily_reports' })

const legacyReportsAlias = resolveWorkspaceParts('#project/p1/paper/reports')
assert.deepEqual(legacyReportsAlias, { projectId: 'p1', area: 'overview', tab: 'daily_reports' })

const writingDeepLink = resolveWorkspaceParts('#project/p1/paper/paper_outline')
assert.deepEqual(writingDeepLink, { projectId: 'p1', area: 'paper', tab: 'paper_outline' })

assert.equal(workspacePath('mnist-cnn-example', 'overview', 'overview'), '/project/mnist-cnn-example/overview/idea')
assert.deepEqual(resolveWorkspacePath('/project/mnist-cnn-example/overview/idea'), {
  projectRef: 'mnist-cnn-example', area: 'overview', tab: 'overview', legacyHash: false,
})
assert.deepEqual(resolveWorkspaceLocation('/project/mnist-cnn-example/overview/idea', ''), {
  projectRef: 'mnist-cnn-example', area: 'overview', tab: 'overview', legacyHash: false,
})
assert.deepEqual(resolveWorkspaceLocation('/', '#project/p1/overview/overview'), {
  projectRef: 'p1', area: 'overview', tab: 'overview', legacyHash: true,
})

assert.equal(resolveWorkspaceParts('#project/p1/paper/not_a_tab'), null)
assert.equal(resolveWorkspaceParts('#project/p1/unknown/overview'), null)

console.log('navigation check passed')
