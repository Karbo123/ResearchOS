import { useMemo, useState } from 'react'
import { AlertTriangle, Download, ExternalLink, GitBranch, PackageCheck, Play, RefreshCw } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, Reproduction, ReproductionRun, Repository, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'
import { useTranslation, type TranslationKey } from '../../i18n'

type FormState = {
  dependency_manifest: string
  entrypoint: string
  random_seeds: string
  config: string
}

const defaultForm = (): FormState => ({ dependency_manifest: 'requirements.txt', entrypoint: '', random_seeds: '13,37,73', config: '{}' })

function statusText(status: string): string {
  const labels: Record<string, TranslationKey> = {
    source_downloaded: 'reproduction.sourceDownloaded',
    dependency_pending: 'reproduction.dependencyPending',
    dependency_installing: 'reproduction.dependencyInstalling',
    dependency_failed: 'reproduction.dependencyFailed',
    ready: 'reproduction.ready',
    queued: 'reproduction.queued',
    running: 'reproduction.running',
    awaiting_artifact_approval: 'reproduction.awaitingArtifact',
    completed: 'reproduction.completed',
    artifact_rejected: 'reproduction.artifactRejected',
    failed: 'reproduction.runFailed',
    invalidated: 'reproduction.invalidated',
  }
  return labels[status] || status
}

export function ReproductionTab({
  project,
  onNavigate,
  onRefresh,
  showToast,
}: {
  project: ProjectDetail
  onNavigate: (tab: TabId) => void
  onRefresh: () => Promise<void>
  showToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const repositories = project.repositories || []
  const reproductions = project.reproductions || []
  const runs = project.reproduction_runs || []
  const [forms, setForms] = useState<Record<string, FormState>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const reproductionByRepository = useMemo(() => new Map(reproductions.map(item => [item.repository_id, item])), [reproductions])
  const runByReproduction = useMemo(() => {
    const map = new Map<string, ReproductionRun[]>()
    for (const run of runs) map.set(run.reproduction_id, [...(map.get(run.reproduction_id) || []), run])
    return map
  }, [runs])

  function formFor(reproduction: Reproduction): FormState {
    return forms[reproduction.id] || { ...defaultForm(), entrypoint: reproduction.entrypoint || '' }
  }

  const verifyRepository = async (repository: Repository) => {
    setBusy(`verify:${repository.id}`)
    try {
      await api(`/api/projects/${project.id}/repositories/${repository.id}/verify`, { method: 'POST' })
      await onRefresh()
      showToast(t('reproduction.verifyDone'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally { setBusy(null) }
  }

  const requestDownload = async (repository: Repository) => {
    setBusy(`download:${repository.id}`)
    try {
      await api(`/api/projects/${project.id}/repositories/${repository.id}/download`, { method: 'POST' })
      await onRefresh()
      showToast(t('reproduction.downloadProposalCreated'))
    } catch (error) {
      showToast(errorMessage(error))
    } finally { setBusy(null) }
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
    } finally { setBusy(null) }
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
    } finally { setBusy(null) }
  }

  const updateForm = (reproductionId: string, field: keyof FormState, value: string) => {
    setForms(current => ({ ...current, [reproductionId]: { ...formFor(reproductions.find(item => item.id === reproductionId)!), [field]: value } }))
  }

  return (
    <>
      <SectionHeading
        title={t('reproduction.title')}
        hint={t('reproduction.hint')}
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={() => onNavigate('literature')}>
              <GitBranch size={15} />
              {t('reproduction.addFromLiterature')}
            </button>
          </ButtonRow>
        }
      />
      {repositories.length ? (
        <div className="data-list">
          {repositories.map(repository => {
            const download = repository.metadata?.download
            const verification = repository.metadata?.verification || {}
            const reproduction = reproductionByRepository.get(repository.id)
            const reproductionRuns = reproduction ? runByReproduction.get(reproduction.id) || [] : []
            return (
              <article className="data-row reproduction-card" key={repository.id}>
                <div className="reproduction-main">
                  <h3>
                    <a href={repository.source_url} target="_blank" rel="noreferrer">{repository.source_url}</a>
                    <ExternalLink size={13} aria-hidden="true" />
                  </h3>
                  <p>
                    {repository.commit_or_tag || t('reproduction.commitUnlocked')} · {repository.license_spdx || verification.license_status || t('reproduction.licensePending')} ·
                    {download?.source_relative_path ? ` ${t('reproduction.entered')} ${download.source_relative_path}` : ` ${t('reproduction.notDownloaded')}`}
                  </p>
                  <div className="button-row reproduction-actions">
                    <Badge status={repository.verified_official ? 'verified' : 'review-required'}>{repository.verified_official ? t('reproduction.verified') : t('reproduction.pendingVerification')}</Badge>
                    <button className="secondary" type="button" disabled={busy === `verify:${repository.id}`} onClick={() => { void verifyRepository(repository) }}>
                      <RefreshCw size={15} />
                      {t('reproduction.reverify')}
                    </button>
                    {repository.verified_official && !reproduction ? (
                      <button className="secondary" type="button" disabled={busy === `download:${repository.id}`} onClick={() => { void requestDownload(repository) }}>
                        <Download size={15} />
                        {t('reproduction.createDownloadApproval')}
                      </button>
                    ) : null}
                  </div>
                </div>
                {reproduction ? (
                  <div className="reproduction-detail">
                    <div className="data-row compact-row">
                      <div><strong>{t('reproduction.environment')}</strong><p><code>{reproduction.repository_relative_path}</code> · <code>{reproduction.venv_relative_path}</code></p></div>
                      <Badge status={reproduction.status}>{t(statusText(reproduction.status) as TranslationKey)}</Badge>
                    </div>
                    {reproduction.error ? <div className="inline-warning"><AlertTriangle size={15} /> {reproduction.error}</div> : null}
                    {['source_downloaded', 'dependency_failed'].includes(reproduction.status) ? (
                      <div className="reproduction-form">
                        <label>{t('reproduction.dependencyManifest')}<input value={formFor(reproduction).dependency_manifest} onChange={event => updateForm(reproduction.id, 'dependency_manifest', event.target.value)} /></label>
                        <button className="secondary" type="button" disabled={busy === `dependency:${reproduction.id}`} onClick={() => { void requestDependencies(reproduction) }}><PackageCheck size={15} />{t('reproduction.createDependencyApproval')}</button>
                      </div>
                    ) : null}
                    {reproduction.status === 'ready' ? (
                      <div className="reproduction-form">
                        <label>{t('reproduction.pythonEntry')}<input placeholder={t('reproduction.pythonEntryPlaceholder')} value={formFor(reproduction).entrypoint} onChange={event => updateForm(reproduction.id, 'entrypoint', event.target.value)} /></label>
                        <label>Seeds<input value={formFor(reproduction).random_seeds} onChange={event => updateForm(reproduction.id, 'random_seeds', event.target.value)} /></label>
                        <label>{t('reproduction.structuredConfig')}<textarea rows={2} value={formFor(reproduction).config} onChange={event => updateForm(reproduction.id, 'config', event.target.value)} /></label>
                        <button className="secondary" type="button" disabled={busy === `run:${reproduction.id}`} onClick={() => { void requestRun(reproduction) }}><Play size={15} />{t('reproduction.createRunApproval')}</button>
                      </div>
                    ) : null}
                    {reproductionRuns.length ? <div className="reproduction-runs">{reproductionRuns.map(run => <div className="data-row compact-row" key={run.id}><div><strong>Run {run.id.slice(0, 8)}</strong><p>{run.entrypoint} · seeds {run.random_seeds.join(', ')}{run.error ? ` · ${run.error}` : ''}</p></div><Badge status={run.status}>{t(statusText(run.status) as TranslationKey)}</Badge></div>)}</div> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          text={t('reproduction.empty')}
          action={<button className="secondary" type="button" onClick={() => onNavigate('literature')}><GitBranch size={15} />{t('reproduction.openLiterature')}</button>}
        />
      )}
      <div className="section">
        <SectionHeading title={t('reproduction.boundaryTitle')} hint={t('reproduction.boundaryHint')} />
      </div>
    </>
  )
}
