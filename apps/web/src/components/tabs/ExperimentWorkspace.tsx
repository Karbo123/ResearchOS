import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Download,
  ExternalLink,
  FileCode2,
  FlaskConical,
  GitBranch,
  ListChecks,
  PackageCheck,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Waypoints,
} from 'lucide-react'
import { api, errorMessage, localizeFailure } from '../../api'
import type { Artifact, Experiment, ProjectDetail, ProjectWorkspaceDetail, Reproduction, ReproductionRun, Repository, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading, statusLabel } from '../ui'
import { ArtifactCard } from '../previews'
import { useTranslation } from '../../i18n'

export type ExperimentWorkspaceMode = 'method' | 'reproduction'

type FormState = {
  dependency_manifest: string
  entrypoint: string
  random_seeds: string
  config: string
}

type WorkspaceEntry = {
  id: string
  kind: 'method_workspace' | 'experiment' | 'reproduction' | 'reproduction_run'
  title: string
  meta: string
  status: string
  artifactCount: number
  experiment?: Experiment
  reproduction?: Reproduction
  repository?: Repository
  runs?: ReproductionRun[]
  run?: ReproductionRun
}

const defaultForm = (): FormState => ({ dependency_manifest: 'requirements.txt', entrypoint: '', random_seeds: '13,37,73', config: '{}' })

function lineageRunId(artifact: Artifact): string | null {
  const lineage = artifact.metadata?.lineage
  if (!lineage || typeof lineage !== 'object') return null
  const runId = (lineage as Record<string, unknown>).run_id
  return typeof runId === 'string' ? runId : null
}

function artifactCountFor(project: ProjectDetail, entry: WorkspaceEntry): number {
  const artifacts = project.artifacts || []
  if (entry.kind === 'method_workspace') return artifacts.length
  if (entry.kind === 'experiment') {
    return artifacts.filter(artifact =>
      artifact.experiment_id === entry.experiment?.id
      || (artifact.run_id && artifact.run_id === entry.experiment?.run_id)
      || (lineageRunId(artifact) && lineageRunId(artifact) === entry.experiment?.run_id),
    ).length
  }
  if (entry.kind === 'reproduction') {
    const runIds = new Set((entry.runs || []).map(run => run.id))
    return artifacts.filter(artifact => {
      const lineageId = lineageRunId(artifact)
      return Boolean(artifact.run_id && runIds.has(artifact.run_id)) || Boolean(lineageId && runIds.has(lineageId))
    }).length
  }
  if (entry.kind === 'reproduction_run') {
    return artifacts.filter(artifact => artifact.run_id === entry.run?.id || lineageRunId(artifact) === entry.run?.id).length
  }
  return 0
}

function buildEntries(project: ProjectDetail, mode: ExperimentWorkspaceMode): WorkspaceEntry[] {
  if (mode === 'method') {
    const entries: WorkspaceEntry[] = [
      {
        id: 'method:workspace',
        kind: 'method_workspace',
        title: project.spec?.idea?.title || project.title,
        meta: project.spec?.idea?.research_question || '',
        status: project.status,
        artifactCount: project.artifacts?.length || 0,
      },
    ]
    for (const experiment of project.experiments || []) {
      entries.push({
        id: `experiment:${experiment.id}`,
        kind: 'experiment',
        title: experiment.experiment_type,
        meta: experiment.run_id ? `Run ${experiment.run_id.slice(0, 8)}` : (experiment.config ? JSON.stringify(experiment.config) : ''),
        status: experiment.status,
        artifactCount: 0,
        experiment,
      })
    }
    return entries.map(entry => ({ ...entry, artifactCount: artifactCountFor(project, entry) }))
  }

  const repositories = project.repositories || []
  const reproductions = project.reproductions || []
  const runs = project.reproduction_runs || []
  const reproductionByRepository = new Map(reproductions.map(item => [item.repository_id, item]))
  const entries: WorkspaceEntry[] = []
  for (const repository of repositories) {
    const reproduction = reproductionByRepository.get(repository.id)
    const reproductionRuns = reproduction ? runs.filter(run => run.reproduction_id === reproduction.id) : []
    entries.push({
      id: `reproduction:${repository.id}`,
      kind: 'reproduction',
      title: repository.source_url,
      meta: reproduction
        ? `${reproduction.source_commit.slice(0, 8)} · ${reproduction.repository_relative_path}`
        : repository.commit_or_tag || '',
      status: reproduction?.status || (repository.verified_official ? 'verified' : 'review-required'),
      artifactCount: 0,
      repository,
      reproduction,
      runs: reproductionRuns,
    })
  }
  for (const reproduction of reproductions) {
    if (!reproductionByRepository.has(reproduction.repository_id)) {
      entries.push({
        id: `reproduction:${reproduction.id}`,
        kind: 'reproduction',
        title: reproduction.id.slice(0, 8),
        meta: `${reproduction.source_commit.slice(0, 8)} · ${reproduction.repository_relative_path}`,
        status: reproduction.status,
        artifactCount: 0,
        reproduction,
        runs: runs.filter(run => run.reproduction_id === reproduction.id),
      })
    }
  }
  for (const run of runs) {
    entries.push({
      id: `run:${run.id}`,
      kind: 'reproduction_run',
      title: `Run ${run.id.slice(0, 8)}`,
      meta: `${run.entrypoint} · ${run.random_seeds.join(', ')}`,
      status: run.status,
      artifactCount: 0,
      run,
    })
  }
  return entries.map(entry => ({ ...entry, artifactCount: artifactCountFor(project, entry) }))
}

function metricRows(value: unknown): Array<{ name: string; detail: string }> {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const aggregate = record.aggregate
  if (aggregate && typeof aggregate === 'object') {
    return Object.entries(aggregate as Record<string, unknown>).map(([name, item]) => {
      const summary = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const parts = ['mean', 'population_std', 'min', 'max'].filter(key => typeof summary[key] === 'number')
        .map(key => `${key} ${Number(summary[key]).toPrecision(6)}`)
      return { name, detail: parts.join(' · ') || JSON.stringify(item) }
    })
  }
  return Object.entries(record).map(([name, item]) => ({ name, detail: typeof item === 'number' ? Number(item).toPrecision(6) : JSON.stringify(item) }))
}

export function ExperimentWorkspace({
  project,
  mode,
  onNavigate,
  onRefresh,
  showToast,
}: {
  project: ProjectDetail
  mode: ExperimentWorkspaceMode
  onNavigate: (tab: TabId) => void
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, FormState>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<ProjectWorkspaceDetail | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const entries = useMemo(() => buildEntries(project, mode), [project, mode])
  const selected = entries.find(entry => entry.id === selectedId) || entries[0] || null

  useEffect(() => {
    setSelectedId(null)
  }, [mode])

  useEffect(() => {
    if (!selectedId || !entries.some(entry => entry.id === selectedId)) {
      setSelectedId(entries[0]?.id || null)
    }
  }, [selectedId, entries])

  const workspaceScope = selected?.kind === 'method_workspace'
    ? 'method' as const
    : selected?.kind === 'reproduction' && selected.reproduction
      ? 'reproduction' as const
      : null
  const reproductionWorkspaceId = workspaceScope === 'reproduction' ? selected?.reproduction?.id : undefined

  useEffect(() => {
    let active = true
    setWorkspace(null)
    setWorkspaceError(null)
    if (!workspaceScope) return undefined
    const params = new URLSearchParams({ scope: workspaceScope })
    if (reproductionWorkspaceId) params.set('reproductionId', reproductionWorkspaceId)
    api<ProjectWorkspaceDetail>(`/api/projects/${project.id}/workspace?${params.toString()}`)
      .then(data => { if (active) setWorkspace(data) })
      .catch(error => { if (active) setWorkspaceError(errorMessage(error)) })
    return () => { active = false }
  }, [project.id, workspaceScope, reproductionWorkspaceId])

  function formFor(reproduction: Reproduction): FormState {
    return forms[reproduction.id] || { ...defaultForm(), entrypoint: reproduction.entrypoint || '' }
  }

  const updateForm = (reproductionId: string, field: keyof FormState, value: string) => {
    setForms(current => ({ ...current, [reproductionId]: { ...formFor(project.reproductions?.find(item => item.id === reproductionId) || { id: reproductionId } as Reproduction), [field]: value } }))
  }

  const createExperimentPlan = async () => {
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/experiment-plan`, { method: 'POST' })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('experiment.toastPlan', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const runDiagnostics = async () => {
    setBusy('diagnostics')
    try {
      await api(`/api/projects/${project.id}/diagnostics`, { method: 'POST' })
      await onRefresh()
      showToast(t('experiment.diagDone'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const syncExperiment = async (experimentId: string) => {
    setBusy(`sync:${experimentId}`)
    try {
      await api(`/api/experiments/${experimentId}/sync`, { method: 'POST' })
      await onRefresh()
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const cancelExperiment = async (experimentId: string) => {
    setBusy(`cancel:${experimentId}`)
    try {
      await api(`/api/experiments/${experimentId}/cancel`, { method: 'POST' })
      await onRefresh()
      showToast(t('experiment.cancelled'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const proposeCheckpointRerun = async (experimentId: string) => {
    const checkpoint = (project.checkpoints || []).find(item =>
      item.state?.run_id === experimentId
      && (item.stage === 'experiment_succeeded' || item.stage === 'experiment_failed'),
    )
    if (!checkpoint) return
    const reason = window.prompt(t('experiment.rerunPrompt'), t('experiment.rerunDefault'))
    if (!reason || reason.trim().length < 5) return
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${project.id}/checkpoints/${checkpoint.id}/rerun`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      await onRefresh()
      onNavigate('approvals')
      showToast(t('experiment.rerunToast', { id: result.proposal_id.slice(0, 8) }))
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  const verifyRepository = async (repository: Repository) => {
    setBusy(`verify:${repository.id}`)
    try {
      await api(`/api/projects/${project.id}/repositories/${repository.id}/verify`, { method: 'POST' })
      await onRefresh()
      showToast(t('reproduction.verifyDone'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const requestDownload = async (repository: Repository) => {
    setBusy(`download:${repository.id}`)
    try {
      await api(`/api/projects/${project.id}/repositories/${repository.id}/download`, { method: 'POST' })
      await onRefresh()
      showToast(t('reproduction.downloadProposalCreated'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const requestDependencies = async (reproduction: Reproduction) => {
    const form = formFor(reproduction)
    setBusy(`dependency:${reproduction.id}`)
    try {
      await api(`/api/projects/${project.id}/reproductions/${reproduction.id}/dependency-plan`, {
        method: 'POST',
        body: JSON.stringify({ dependency_manifest: form.dependency_manifest.trim(), reason: t('reproduction.dependencyReason') }),
      })
      await onRefresh()
      showToast(t('reproduction.dependencyProposalCreated'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const requestRun = async (reproduction: Reproduction) => {
    const form = formFor(reproduction)
    let config: unknown
    try { config = JSON.parse(form.config || '{}') } catch { showToast(t('reproduction.configJsonInvalid')); return }
    const randomSeeds = form.random_seeds.split(',').map(item => Number(item.trim())).filter(Number.isInteger)
    if (!form.entrypoint.trim() || !randomSeeds.length || !config || typeof config !== 'object' || Array.isArray(config)) {
      showToast(t('reproduction.formInvalid'))
      return
    }
    setBusy(`run:${reproduction.id}`)
    try {
      await api(`/api/projects/${project.id}/reproductions/${reproduction.id}/run-plan`, {
        method: 'POST',
        body: JSON.stringify({ entrypoint: form.entrypoint.trim(), random_seeds: randomSeeds, config, timeout_seconds: 3600, reason: t('reproduction.runReason') }),
      })
      await onRefresh()
      showToast(t('reproduction.runProposalCreated'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const relevantProposalKinds = mode === 'method'
    ? ['experiment_plan', 'code_patch', 'config_change', 'dependency_install']
    : ['repository_download', 'repository_dependency_install', 'repository_reproduction_run', 'repository_artifact_write']
  const proposals = (project.proposals || []).filter(proposal => relevantProposalKinds.includes(proposal.kind))
  const queueRows = mode === 'method'
    ? (project.experiments || []).filter(experiment => ['queued', 'running', 'waiting-approval'].includes(experiment.status))
    : (project.reproduction_runs || []).filter(run => ['queued', 'running', 'waiting-approval'].includes(run.status))
  const artifacts = (project.artifacts || []).filter(artifact => {
    if (!selected) return false
    if (selected.kind === 'method_workspace') return true
    if (selected.kind === 'experiment') {
      return artifact.experiment_id === selected.experiment?.id
        || (artifact.run_id !== null && artifact.run_id === selected.experiment?.run_id)
        || (lineageRunId(artifact) !== null && lineageRunId(artifact) === selected.experiment?.run_id)
    }
    if (selected.kind === 'reproduction') {
      const runIds = new Set((selected.runs || []).map(run => run.id))
      return Boolean(artifact.run_id && runIds.has(artifact.run_id)) || Boolean(lineageRunId(artifact) && runIds.has(lineageRunId(artifact)!))
    }
    return artifact.run_id === selected.run?.id || lineageRunId(artifact) === selected.run?.id
  })

  const idea = project.spec?.idea
  const boundPaper = selected?.repository?.paper_id
    ? (project.papers || []).find(paper => paper.id === selected.repository?.paper_id)
    : null

  return (
    <section className="experiment-workspace" aria-label={mode === 'method' ? t('workspace.listMethod') : t('workspace.listReproduction')}>
      <div className="workspace-head">
        <SectionHeading
          title={mode === 'method' ? t('workspace.methodTitle') : t('workspace.reproductionTitle')}
          hint={mode === 'method' ? t('workspace.methodHint') : t('workspace.reproductionHint')}
          extra={
            <ButtonRow>
              {mode === 'method' ? (
                <>
                  <button className="secondary" type="button" onClick={() => { void createExperimentPlan() }}>
                    <ListChecks size={15} />
                    {t('experiment.plan')}
                  </button>
                  <button className="secondary" type="button" disabled={busy === 'diagnostics'} onClick={() => { void runDiagnostics() }}>
                    <Activity size={15} />
                    {t('experiment.diagnostics')}
                  </button>
                </>
              ) : (
                <button className="secondary" type="button" onClick={() => onNavigate('literature')}>
                  <GitBranch size={15} />
                  {t('reproduction.addFromLiterature')}
                </button>
              )}
            </ButtonRow>
          }
        />
      </div>
      <div className="workspace-split">
        <aside className="workspace-list-pane" aria-label={mode === 'method' ? t('workspace.listMethod') : t('workspace.listReproduction')}>
          <div className="workspace-pane-heading">
            <strong>{mode === 'method' ? t('workspace.listMethod') : t('workspace.listReproduction')}</strong>
            <Badge>{t('workspace.workCount', { count: entries.length })}</Badge>
          </div>
          <div className="workspace-entry-list">
            {entries.map(entry => (
              <button
                key={entry.id}
                type="button"
                className={`workspace-entry${selected?.id === entry.id ? ' active' : ''}`}
                data-active={selected?.id === entry.id ? 'true' : 'false'}
                aria-current={selected?.id === entry.id ? 'true' : undefined}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className="workspace-entry-icon">
                  {entry.kind === 'method_workspace' ? <Waypoints size={15} /> : entry.kind === 'experiment' ? <FlaskConical size={15} /> : entry.kind === 'reproduction' ? <GitBranch size={15} /> : <Play size={14} />}
                </span>
                <span className="workspace-entry-copy">
                  <strong>{entry.title}</strong>
                  <small>{entry.meta || t('common.unrecorded')}</small>
                </span>
                <span className="workspace-entry-side">
                  <Badge status={entry.status} />
                  {entry.artifactCount ? <em>{entry.artifactCount}</em> : null}
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div className="workspace-detail-pane" aria-live="polite">
          {!selected ? (
            <EmptyState text={mode === 'method' ? t('workspace.emptyMethod') : t('workspace.emptyReproduction')} />
          ) : (
            <>
              <div className="workspace-detail-head">
                <div className="workspace-detail-title">
                  <div className="eyebrow">{selected.kind === 'method_workspace' ? t('workspace.methodDesign') : selected.kind === 'experiment' ? t('workspace.experimentItem') : selected.kind === 'reproduction' ? t('workspace.reproductionItem') : t('workspace.runItem')}</div>
                  <h3>{selected.title}</h3>
                  <p className="muted">{selected.meta || t('common.unrecorded')}</p>
                </div>
                <Badge status={selected.status}>{statusLabel(selected.status, t)}</Badge>
              </div>

              {selected.kind === 'method_workspace' ? (
                <>
                  <div className="data-list workspace-detail-list">
                    <div className="data-row"><div><h3>{t('workspace.purpose')}</h3><p>{idea?.research_question || t('common.notConfirmed')}</p></div><Badge status={idea?.research_question ? 'recorded' : 'unresolved'} /></div>
                    <div className="data-row"><div><h3>{t('workspace.basis')}</h3><p>{idea?.hypotheses?.join('；') || t('common.notConfirmed')}</p></div><Badge status={idea?.hypotheses?.length ? 'recorded' : 'unresolved'} /></div>
                    <div className="data-row"><div><h3>{t('workspace.goal')}</h3><p>{idea?.success_criteria?.join('；') || t('common.notConfirmed')}</p></div><Badge status={idea?.success_criteria?.length ? 'recorded' : 'unresolved'} /></div>
                    <div className="data-row"><div><h3>{t('workspace.method')}</h3><p>{idea?.expected_contributions?.join('；') || t('common.notConfirmed')}</p></div><Badge status={idea?.expected_contributions?.length ? 'candidate' : 'unresolved'} /></div>
                  </div>
                  <WorkspaceFiles workspace={workspace} workspaceError={workspaceError} />
                </>
              ) : null}

              {selected.kind === 'experiment' && selected.experiment ? (
                <>
                  <div className="data-list workspace-detail-list">
                    <div className="data-row"><div><h3>{t('workspace.experimentStatus')}</h3><p>{selected.experiment.proposal_id ? `Proposal ${selected.experiment.proposal_id.slice(0, 8)}` : t('common.unrecorded')}</p></div><Badge status={selected.experiment.status} /></div>
                    {selected.experiment.run_id ? <div className="data-row"><div><h3>{t('workspace.runId')}</h3><p><code>{selected.experiment.run_id}</code></p></div><Badge status="recorded" /></div> : null}
                    {selected.experiment.error ? <div className="inline-warning"><AlertTriangle size={15} /> {localizeFailure(selected.experiment.status, selected.experiment.error)}</div> : null}
                  </div>
                  <DetailSection title={t('workspace.metrics')}>
                    {metricRows(selected.experiment.metrics).length ? (
                      <div className="data-list">{metricRows(selected.experiment.metrics).map(row => <div className="data-row compact-row" key={row.name}><div><strong>{row.name}</strong><p>{row.detail}</p></div><Badge status="calculated" /></div>)}</div>
                    ) : <EmptyState text={t('workspace.noMetrics')} />}
                  </DetailSection>
                  <DetailSection title={t('workspace.actions')}>
                    <ButtonRow>
                      <button className="secondary" type="button" disabled={busy === `sync:${selected.experiment.id}`} onClick={() => { void syncExperiment(selected.experiment!.id) }}><RefreshCw size={15} />{t('experiment.sync')}</button>
                      {['queued', 'running'].includes(selected.experiment.status) ? <button className="reject" type="button" disabled={busy === `cancel:${selected.experiment.id}`} onClick={() => { void cancelExperiment(selected.experiment!.id) }}><Square size={15} />{t('common.cancel')}</button> : null}
                      {(project.checkpoints || []).some(item => item.state?.run_id === selected.experiment?.id) ? <button className="secondary" type="button" onClick={() => { void proposeCheckpointRerun(selected.experiment!.id) }}><RotateCcw size={15} />{t('experiment.rerun')}</button> : null}
                    </ButtonRow>
                  </DetailSection>
                </>
              ) : null}

              {selected.kind === 'reproduction' && selected.repository ? (
                <>
                  <div className="data-list workspace-detail-list">
                    <div className="data-row">
                      <div><h3>{t('workspace.repo')}</h3><p><a href={selected.repository.source_url} target="_blank" rel="noreferrer">{selected.repository.source_url}</a> <ExternalLink size={12} aria-hidden="true" /></p></div>
                      <Badge status={selected.repository.verified_official ? 'verified' : 'review-required'} />
                    </div>
                    {boundPaper ? <div className="data-row"><div><h3>{t('workspace.boundPaper')}</h3><p>{boundPaper.title}</p></div><Badge status={boundPaper.confirmed ? 'confirmed' : 'metadata-only'} /></div> : null}
                    {selected.reproduction ? (
                      <>
                        <div className="data-row"><div><h3>{t('workspace.commit')}</h3><p><code>{selected.reproduction.source_commit}</code></p></div><Badge status="recorded" /></div>
                        <div className="data-row"><div><h3>{t('workspace.sourcePath')}</h3><p><code>{selected.reproduction.repository_relative_path}</code></p></div><Badge status={selected.reproduction.status === 'ready' ? 'ready' : 'pending'} /></div>
                        <div className="data-row"><div><h3>{t('workspace.env')}</h3><p><code>{selected.reproduction.venv_relative_path}</code> · {selected.reproduction.dependency_manifest}</p></div><Badge status={selected.reproduction.status} /></div>
                      </>
                    ) : (
                      <div className="data-row"><div><h3>{t('workspace.commit')}</h3><p>{selected.repository.commit_or_tag || t('reproduction.commitUnlocked')}</p></div><Badge status="unresolved" /></div>
                    )}
                  </div>
                  <DetailSection title={t('workspace.actions')}>
                    <ButtonRow>
                      <button className="secondary" type="button" disabled={busy === `verify:${selected.repository.id}`} onClick={() => { void verifyRepository(selected.repository!) }}><RefreshCw size={15} />{t('reproduction.reverify')}</button>
                      {selected.repository.verified_official && !selected.reproduction ? <button className="secondary" type="button" disabled={busy === `download:${selected.repository.id}`} onClick={() => { void requestDownload(selected.repository!) }}><Download size={15} />{t('reproduction.createDownloadApproval')}</button> : null}
                    </ButtonRow>
                  </DetailSection>
                  {selected.reproduction ? (
                    <>
                      {['source_downloaded', 'dependency_failed'].includes(selected.reproduction.status) ? (
                        <DetailSection title={t('workspace.dependencyForm')}>
                          <div className="reproduction-form">
                            <label>{t('reproduction.dependencyManifest')}<input value={formFor(selected.reproduction).dependency_manifest} onChange={event => updateForm(selected.reproduction!.id, 'dependency_manifest', event.target.value)} /></label>
                            <button className="secondary" type="button" disabled={busy === `dependency:${selected.reproduction.id}`} onClick={() => { void requestDependencies(selected.reproduction!) }}><PackageCheck size={15} />{t('reproduction.createDependencyApproval')}</button>
                          </div>
                        </DetailSection>
                      ) : null}
                      {selected.reproduction.status === 'ready' ? (
                        <DetailSection title={t('workspace.runForm')}>
                          <div className="reproduction-form">
                            <label>{t('reproduction.pythonEntry')}<input placeholder={t('reproduction.pythonEntryPlaceholder')} value={formFor(selected.reproduction).entrypoint} onChange={event => updateForm(selected.reproduction!.id, 'entrypoint', event.target.value)} /></label>
                            <label>{t('reproduction.seeds')}<input value={formFor(selected.reproduction).random_seeds} onChange={event => updateForm(selected.reproduction!.id, 'random_seeds', event.target.value)} /></label>
                            <label>{t('reproduction.structuredConfig')}<textarea rows={2} value={formFor(selected.reproduction).config} onChange={event => updateForm(selected.reproduction!.id, 'config', event.target.value)} /></label>
                            <button className="secondary" type="button" disabled={busy === `run:${selected.reproduction.id}`} onClick={() => { void requestRun(selected.reproduction!) }}><Play size={15} />{t('reproduction.createRunApproval')}</button>
                          </div>
                        </DetailSection>
                      ) : null}
                      <WorkspaceFiles workspace={workspace} workspaceError={workspaceError} />
                    </>
                  ) : null}
                </>
              ) : null}

              {selected.kind === 'reproduction_run' && selected.run ? (
                <>
                  <div className="data-list workspace-detail-list">
                    <div className="data-row"><div><h3>{t('workspace.runId')}</h3><p><code>{selected.run.id}</code></p></div><Badge status={selected.run.status} /></div>
                    <div className="data-row"><div><h3>{t('workspace.commit')}</h3><p><code>{selected.run.source_commit}</code></p></div><Badge status="recorded" /></div>
                    <div className="data-row"><div><h3>{t('workspace.entrypoint')}</h3><p><code>{selected.run.entrypoint}</code></p></div><Badge status="recorded" /></div>
                    <div className="data-row"><div><h3>{t('workspace.seedLabel')}</h3><p>{selected.run.random_seeds.join(', ')}</p></div><Badge status="calculated" /></div>
                    <div className="data-row"><div><h3>{t('workspace.config')}</h3><p><code>{JSON.stringify(selected.run.config || {})}</code></p></div><Badge status="recorded" /></div>
                    {selected.run.error ? <div className="inline-warning"><AlertTriangle size={15} /> {localizeFailure(selected.run.status, selected.run.error)}</div> : null}
                  </div>
                  <DetailSection title={t('workspace.metrics')}>
                    {metricRows(selected.run.metrics).length ? (
                      <div className="data-list">{metricRows(selected.run.metrics).map(row => <div className="data-row compact-row" key={row.name}><div><strong>{row.name}</strong><p>{row.detail}</p></div><Badge status="calculated" /></div>)}</div>
                    ) : <EmptyState text={t('workspace.noMetrics')} />}
                  </DetailSection>
                  {selected.run.output_manifest?.length ? (
                    <DetailSection title={t('workspace.outputManifest')}>
                      <div className="data-list">{selected.run.output_manifest.map(file => <div className="data-row compact-row" key={file.path}><code>{file.path}</code><span className="muted">{file.size_bytes} B · {file.mime_type}</span></div>)}</div>
                    </DetailSection>
                  ) : null}
                </>
              ) : null}

              <DetailSection title={t('workspace.queue')}>
                {queueRows.length ? (
                  <div className="data-list">{queueRows.map(item => {
                    const title = mode === 'method' && 'experiment_type' in item
                      ? item.experiment_type
                      : `Run ${item.id.slice(0, 8)}`
                    return <div className="data-row compact-row" key={item.id}><div><strong>{title}</strong><p>{mode === 'method' ? item.run_id || t('queue.runUnassigned') : `${item.entrypoint} · ${item.random_seeds.join(', ')}`}</p></div><Badge status={item.status} /></div>
                  })}</div>
                ) : <EmptyState text={t('workspace.noQueue')} />}
              </DetailSection>

              {mode === 'reproduction' ? (
                <DetailSection title={t('workspace.boundaryTitle')}>
                  <div className="workspace-boundary">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <p>{t('workspace.boundaryText')}</p>
                  </div>
                </DetailSection>
              ) : null}

              <DetailSection title={t('workspace.proposals')}>
                {proposals.length ? (
                  <div className="data-list">{proposals.map(proposal => <div className="data-row compact-row" key={proposal.id}><div><strong>{proposal.summary}</strong><p>{proposal.kind} · {proposal.reason || t('common.unrecorded')}</p></div><Badge status={proposal.status} /></div>)}</div>
                ) : <EmptyState text={t('workspace.noProposals')} />}
              </DetailSection>

              <DetailSection title={t('workspace.artifacts')}>
                {artifacts.length ? (
                  <div className="artifact-grid workspace-artifact-grid">{artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} />)}</div>
                ) : <EmptyState text={t('workspace.noArtifacts')} />}
              </DetailSection>

              {selected.kind === 'method_workspace' ? (
                <DetailSection title={t('workspace.lineage')}>
                  <div className="data-list">
                    <div className="data-row"><div><h3>{t('lineage.hint')}</h3><p>{t('workspace.lineageCount', { count: artifacts.length })}</p></div><Badge status={artifacts.length ? 'valid' : 'empty'} /></div>
                  </div>
                </DetailSection>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="workspace-section">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

function WorkspaceFiles({ workspace, workspaceError }: { workspace: ProjectWorkspaceDetail | null; workspaceError: string | null }) {
  const { t } = useTranslation()
  return (
    <DetailSection title={t('workspace.fileTree')}>
      {workspaceError ? <EmptyState text={t('code.error', { error: workspaceError })} /> : null}
      {workspace ? (
        <>
          <div className="data-list workspace-detail-list">
            <div className="data-row"><div><h3>{t('code.workspace')}</h3><p><code>{workspace.code_relative_path}</code></p></div><Badge status={workspace.code_directory_exists ? 'project-scoped' : 'missing'} /></div>
            <div className="data-row"><div><h3>{t('code.gitBaseline')}</h3><p>{workspace.source_commit || workspace.branch || t('common.unknown')} · {workspace.head || t('code.noCommit')}</p></div><Badge status={workspace.dirty ? 'dirty' : 'clean'} /></div>
          </div>
          {workspace.files?.length ? (
            <div className="workspace-file-tree">
              {workspace.files.map(file => (
                <div className="workspace-file-row" key={file.path}>
                  <FileCode2 size={13} aria-hidden="true" />
                  <code>{file.kind === 'directory' ? `${file.path}/` : file.path}</code>
                  <span className="muted">{file.size_bytes} B</span>
                </div>
              ))}
            </div>
          ) : <EmptyState text={t('code.emptyDir')} />}
          {workspace.diff ? (
            <>
              <h4>{t('workspace.diff')}</h4>
              <pre className="code-block workspace-diff">{workspace.diff}</pre>
            </>
          ) : null}
        </>
      ) : !workspaceError ? <EmptyState text={t('code.loading')} /> : null}
    </DetailSection>
  )
}
