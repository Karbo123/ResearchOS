import type { ResearchArea, TabId } from './types.js'

export const TAB_AREA: Record<TabId, ResearchArea> = {
  overview: 'overview',
  overview_spec: 'overview',
  overview_innovation: 'overview',
  overview_progress: 'overview',
  daily_reports: 'overview',
  weekly_reports: 'overview',
  feedback_inbox: 'overview',
  feedback_audit: 'overview',
  reports: 'overview',
  literature: 'related_work',
  research_status: 'related_work',
  citation_graph: 'related_work',
  reproduction: 'implementation',
  comparison: 'implementation',
  method_design: 'implementation',
  code_workspace: 'implementation',
  policies: 'implementation',
  approvals: 'implementation',
  experiments: 'implementation',
  experiment_queue: 'implementation',
  experiment_metrics: 'implementation',
  artifacts: 'implementation',
  lineage: 'implementation',
  paper: 'paper',
  paper_outline: 'paper',
  paper_citations: 'paper',
  paper_figures: 'paper',
  paper_data: 'paper',
  paper_compile: 'paper',
  paper_review: 'paper',
}

export const AREA_DEFAULT_TAB: Record<ResearchArea, TabId> = {
  overview: 'overview',
  related_work: 'literature',
  implementation: 'reproduction',
  paper: 'paper_outline',
}

export const AREA_TABS: Record<ResearchArea, TabId[]> = {
  overview: ['overview', 'overview_spec', 'overview_innovation', 'overview_progress', 'daily_reports', 'weekly_reports', 'feedback_inbox', 'feedback_audit', 'reports'],
  related_work: ['literature', 'research_status', 'citation_graph'],
  implementation: ['reproduction', 'comparison', 'method_design', 'code_workspace', 'policies', 'approvals', 'experiments', 'experiment_queue', 'experiment_metrics', 'artifacts', 'lineage'],
  paper: ['paper', 'paper_outline', 'paper_citations', 'paper_figures', 'paper_data', 'paper_compile', 'paper_review'],
}

const LEGACY_AREA_REDIRECT: Record<string, ResearchArea> = {
  method: 'implementation',
}

const LEGACY_TAB_REDIRECT: Partial<Record<TabId, TabId>> = {
  reports: 'daily_reports',
}

const RESEARCH_AREAS: ResearchArea[] = ['overview', 'related_work', 'implementation', 'paper']

export interface ResolvedWorkspaceHash {
  projectId: string
  area: ResearchArea
  tab: TabId
}

export function normalizeTab(tab: TabId): TabId {
  return LEGACY_TAB_REDIRECT[tab] || tab
}

export function workspaceHash(projectId: string, area: ResearchArea, tab: TabId): string {
  return `#project/${encodeURIComponent(projectId)}/${area}/${tab}`
}

export function resolveWorkspaceParts(hash: string): ResolvedWorkspaceHash | null {
  const match = hash.match(/^#project\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!match) return null
  const projectId = decodeURIComponent(match[1] || '')
  const rawArea = match[2] || ''
  const tab = normalizeTab(match[3] as TabId)
  if (!projectId || !TAB_AREA[tab]) return null
  if (rawArea !== 'method' && !RESEARCH_AREAS.includes(rawArea as ResearchArea)) return null
  const area = LEGACY_AREA_REDIRECT[rawArea] || TAB_AREA[tab]
  return { projectId, area, tab }
}

export function resolveWorkspaceHash(): ResolvedWorkspaceHash | null {
  return resolveWorkspaceParts(window.location.hash)
}
