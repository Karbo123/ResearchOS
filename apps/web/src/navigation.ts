import type { ResearchArea, TabId } from './types.js'
import type { TranslationKey } from './i18n.js'
import { createElement } from 'react'
import { BarChart3, BookOpen, CalendarDays, CheckSquare, FilePenLine, FileText, FlaskConical, GitBranch, LayoutDashboard, MessageCircle, Network, Quote, Search, Waypoints } from 'lucide-react'

export const TAB_AREA: Record<TabId, ResearchArea> = {
  overview: 'overview',
  idea: 'overview',
  approvals: 'overview',
  reports: 'overview',
  literature: 'related_work',
  visualization: 'related_work',
  seed_expansion: 'related_work',
  method: 'implementation',
  reproduction: 'implementation',
  introduction: 'paper',
  paper_related_work: 'paper',
  paper_method: 'paper',
  paper_experiments: 'paper',
  conclusion: 'paper',
}

export const AREA_DEFAULT_TAB: Record<ResearchArea, TabId> = {
  overview: 'overview',
  related_work: 'literature',
  implementation: 'method',
  paper: 'introduction',
}

export const AREA_TABS: Record<ResearchArea, TabId[]> = {
  overview: ['overview', 'idea', 'approvals', 'reports'],
  related_work: ['literature', 'visualization', 'seed_expansion'],
  implementation: ['method', 'reproduction'],
  paper: ['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'],
}

export const TAB_LABEL_KEYS: Record<TabId, TranslationKey> = {
  overview: 'tab.overview',
  idea: 'tab.idea',
  approvals: 'tab.approvals',
  reports: 'tab.reports',
  literature: 'tab.literature',
  visualization: 'tab.visualization',
  seed_expansion: 'tab.seedExpansion',
  method: 'tab.method',
  reproduction: 'tab.reproduction',
  introduction: 'tab.introduction',
  paper_related_work: 'tab.paperRelatedWork',
  paper_method: 'tab.paperMethod',
  paper_experiments: 'tab.paperExperiments',
  conclusion: 'tab.conclusion',
}

export const AREA_LABEL_KEYS: Record<ResearchArea, TranslationKey> = {
  overview: 'nav.overview',
  related_work: 'nav.relatedWork',
  implementation: 'nav.implementation',
  paper: 'nav.paper',
}

export interface WorkspaceTabMeta {
  icon: React.ReactNode
  labelKey: TranslationKey
}

export const WORKSPACE_TAB_META: Record<TabId, WorkspaceTabMeta> = {
  overview: { icon: createElement(LayoutDashboard, { size: 15 }), labelKey: 'tab.overview' },
  idea: { icon: createElement(MessageCircle, { size: 15 }), labelKey: 'tab.idea' },
  approvals: { icon: createElement(CheckSquare, { size: 15 }), labelKey: 'tab.approvals' },
  reports: { icon: createElement(CalendarDays, { size: 15 }), labelKey: 'tab.reports' },
  literature: { icon: createElement(BookOpen, { size: 15 }), labelKey: 'tab.literature' },
  visualization: { icon: createElement(Network, { size: 15 }), labelKey: 'tab.visualization' },
  seed_expansion: { icon: createElement(Search, { size: 15 }), labelKey: 'tab.seedExpansion' },
  method: { icon: createElement(Waypoints, { size: 15 }), labelKey: 'tab.method' },
  reproduction: { icon: createElement(GitBranch, { size: 15 }), labelKey: 'tab.reproduction' },
  introduction: { icon: createElement(FilePenLine, { size: 15 }), labelKey: 'tab.introduction' },
  paper_related_work: { icon: createElement(Quote, { size: 15 }), labelKey: 'tab.paperRelatedWork' },
  paper_method: { icon: createElement(FlaskConical, { size: 15 }), labelKey: 'tab.paperMethod' },
  paper_experiments: { icon: createElement(BarChart3, { size: 15 }), labelKey: 'tab.paperExperiments' },
  conclusion: { icon: createElement(FileText, { size: 15 }), labelKey: 'tab.conclusion' },
}

export function workspaceScopeKey(area: ResearchArea, tab: TabId): string {
  return `${area}/${tab}`
}

const LEGACY_AREA_REDIRECT: Record<string, ResearchArea> = {
  method: 'implementation',
}

const LEGACY_TAB_REDIRECT: Record<string, TabId> = {
  overview: 'overview',
  overview_spec: 'idea',
  overview_innovation: 'idea',
  overview_progress: 'overview',
  daily_reports: 'reports',
  weekly_reports: 'reports',
  feedback_inbox: 'reports',
  feedback_audit: 'reports',
  reports: 'reports',
  literature: 'literature',
  research_status: 'visualization',
  citation_graph: 'visualization',
  reproduction: 'reproduction',
  comparison: 'reproduction',
  method_design: 'method',
  code_workspace: 'method',
  policies: 'method',
  approvals: 'approvals',
  experiments: 'method',
  experiment_queue: 'method',
  experiment_metrics: 'method',
  artifacts: 'method',
  lineage: 'method',
  paper: 'introduction',
  paper_outline: 'introduction',
  paper_citations: 'paper_related_work',
  paper_figures: 'paper_method',
  paper_data: 'paper_experiments',
  paper_compile: 'conclusion',
  paper_review: 'conclusion',
}

const RESEARCH_AREAS: ResearchArea[] = ['overview', 'related_work', 'implementation', 'paper']

export interface ResolvedWorkspaceHash {
  projectId: string
  area: ResearchArea
  tab: TabId
}

export interface ResolvedWorkspaceLocation {
  projectRef: string
  area: ResearchArea
  tab: TabId
  legacyHash: boolean
}

export function normalizeTab(tab: string): TabId {
  return LEGACY_TAB_REDIRECT[tab] || tab as TabId
}

const URL_TAB_ALIASES: Record<string, TabId> = {
  idea: 'idea',
  'seed-expansion': 'seed_expansion',
  'related-work': 'paper_related_work',
  'paper-method': 'paper_method',
  'paper-experiments': 'paper_experiments',
}

function tabPathSegment(tab: TabId): string {
  if (tab === 'seed_expansion') return 'seed-expansion'
  if (tab === 'paper_related_work') return 'related-work'
  if (tab === 'paper_method') return 'paper-method'
  if (tab === 'paper_experiments') return 'paper-experiments'
  return tab
}

export function workspacePath(projectSlug: string, area: ResearchArea, tab: TabId): string {
  return `/project/${encodeURIComponent(projectSlug)}/${area}/${tabPathSegment(tab)}`
}

export function workspaceHash(projectId: string, area: ResearchArea, tab: TabId): string {
  return `#project/${encodeURIComponent(projectId)}/${area}/${tab}`
}

export function resolveWorkspaceParts(hash: string): ResolvedWorkspaceHash | null {
  const match = hash.match(/^#project\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!match) return null
  const projectId = decodeURIComponent(match[1] || '')
  const rawArea = match[2] || ''
  const rawTab = match[3] || ''
  const tab = URL_TAB_ALIASES[rawTab] || normalizeTab(rawTab)
  if (!projectId || !TAB_AREA[tab]) return null
  if (rawArea !== 'method' && !RESEARCH_AREAS.includes(rawArea as ResearchArea)) return null
  const area = LEGACY_AREA_REDIRECT[rawArea] || TAB_AREA[tab]
  return { projectId, area, tab }
}

export function resolveWorkspaceHash(): ResolvedWorkspaceHash | null {
  return resolveWorkspaceParts(window.location.hash)
}

export function resolveWorkspacePath(pathname: string): ResolvedWorkspaceLocation | null {
  const match = pathname.match(/^\/project\/([^/]+)\/([^/]+)\/([^/]+)\/?$/)
  if (!match) return null
  let projectRef: string
  try { projectRef = decodeURIComponent(match[1] || '') } catch { return null }
  const rawArea = match[2] || ''
  const rawTab = match[3] || ''
  const tab = URL_TAB_ALIASES[rawTab] || normalizeTab(rawTab)
  if (!projectRef || !TAB_AREA[tab]) return null
  if (rawArea !== 'method' && !RESEARCH_AREAS.includes(rawArea as ResearchArea)) return null
  return { projectRef, area: LEGACY_AREA_REDIRECT[rawArea] || TAB_AREA[tab], tab, legacyHash: false }
}

export function resolveWorkspaceLocation(pathname: string, hash: string): ResolvedWorkspaceLocation | null {
  const path = resolveWorkspacePath(pathname)
  if (path) return path
  const legacy = resolveWorkspaceParts(hash)
  return legacy ? { projectRef: legacy.projectId, area: legacy.area, tab: legacy.tab, legacyHash: true } : null
}
