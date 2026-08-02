import { useMemo, useState } from 'react'
import { AlertTriangle, Download, ExternalLink, GitBranch, PackageCheck, Play, RefreshCw } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail, Reproduction, ReproductionRun, Repository, TabId } from '../../types'
import { Badge, ButtonRow, EmptyState, SectionHeading } from '../ui'

type FormState = {
  dependency_manifest: string
  entrypoint: string
  random_seeds: string
  config: string
}

const defaultForm = (): FormState => ({ dependency_manifest: 'requirements.txt', entrypoint: '', random_seeds: '13,37,73', config: '{}' })

function statusText(status: string): string {
  const labels: Record<string, string> = {
    source_downloaded: '源码已下载',
    dependency_pending: '等待依赖计划',
    dependency_installing: '正在安装依赖',
    dependency_failed: '依赖安装失败',
    ready: '可运行',
    queued: '等待运行',
    running: '正在运行',
    awaiting_artifact_approval: '等待产物审批',
    completed: '产物已登记',
    artifact_rejected: '产物登记被拒绝',
    failed: '运行失败',
    invalidated: '上游已失效',
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
      showToast('代码仓库验证完成')
    } catch (error) {
      showToast(errorMessage(error))
    } finally { setBusy(null) }
  }

  const requestDownload = async (repository: Repository) => {
    setBusy(`download:${repository.id}`)
    try {
      await api(`/api/projects/${project.id}/repositories/${repository.id}/download`, { method: 'POST' })
      await onRefresh()
      showToast('下载 Proposal 已创建，请在审批页批准后继续')
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
        body: JSON.stringify({ dependency_manifest: form.dependency_manifest.trim(), reason: '为已固定 commit 的代码复现创建独立依赖环境' }),
      })
      await onRefresh()
      showToast('依赖安装 Proposal 已创建')
    } catch (error) {
      showToast(errorMessage(error))
    } finally { setBusy(null) }
  }

  const requestRun = async (reproduction: Reproduction) => {
    const form = formFor(reproduction)
    let config: unknown
    try { config = JSON.parse(form.config || '{}') } catch { showToast('运行配置必须是有效 JSON'); return }
    const randomSeeds = form.random_seeds.split(',').map(item => Number(item.trim())).filter(Number.isInteger)
    if (!form.entrypoint.trim() || !randomSeeds.length || !config || typeof config !== 'object' || Array.isArray(config)) {
      showToast('请填写 Python 入口、至少一个整数 seed 和 JSON 对象配置')
      return
    }
    setBusy(`run:${reproduction.id}`)
    try {
      await api(`/api/projects/${project.id}/reproductions/${reproduction.id}/run-plan`, {
        method: 'POST',
        body: JSON.stringify({ entrypoint: form.entrypoint.trim(), random_seeds: randomSeeds, config, timeout_seconds: 3600, reason: '运行已安装依赖的固定代码复现入口' }),
      })
      await onRefresh()
      showToast('复现运行 Proposal 已创建')
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
        title="代码复现候选"
        hint="复现源码只进入当前项目的 experiment/reproductions 区域；下载、依赖安装、运行和产物登记分别审批。"
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={() => onNavigate('literature')}>
              <GitBranch size={15} />
              从文献添加仓库
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
                    {repository.commit_or_tag || '提交未锁定'} · {repository.license_spdx || verification.license_status || '许可证待核验'} ·
                    {download?.source_relative_path ? ` 已进入 ${download.source_relative_path}` : ' 尚未下载'}
                  </p>
                  <div className="button-row reproduction-actions">
                    <Badge status={repository.verified_official ? 'verified' : 'review-required'}>{repository.verified_official ? '已验证' : '待验证'}</Badge>
                    <button className="secondary" type="button" disabled={busy === `verify:${repository.id}`} onClick={() => { void verifyRepository(repository) }}>
                      <RefreshCw size={15} />
                      重新验证
                    </button>
                    {repository.verified_official && !reproduction ? (
                      <button className="secondary" type="button" disabled={busy === `download:${repository.id}`} onClick={() => { void requestDownload(repository) }}>
                        <Download size={15} />
                        创建下载审批
                      </button>
                    ) : null}
                  </div>
                </div>
                {reproduction ? (
                  <div className="reproduction-detail">
                    <div className="data-row compact-row">
                      <div><strong>复现环境</strong><p><code>{reproduction.repository_relative_path}</code> · <code>{reproduction.venv_relative_path}</code></p></div>
                      <Badge status={reproduction.status}>{statusText(reproduction.status)}</Badge>
                    </div>
                    {reproduction.error ? <div className="inline-warning"><AlertTriangle size={15} /> {reproduction.error}</div> : null}
                    {['source_downloaded', 'dependency_failed'].includes(reproduction.status) ? (
                      <div className="reproduction-form">
                        <label>依赖清单<input value={formFor(reproduction).dependency_manifest} onChange={event => updateForm(reproduction.id, 'dependency_manifest', event.target.value)} /></label>
                        <button className="secondary" type="button" disabled={busy === `dependency:${reproduction.id}`} onClick={() => { void requestDependencies(reproduction) }}><PackageCheck size={15} />创建依赖安装审批</button>
                      </div>
                    ) : null}
                    {reproduction.status === 'ready' ? (
                      <div className="reproduction-form">
                        <label>Python 入口<input placeholder="例如 scripts/evaluate.py" value={formFor(reproduction).entrypoint} onChange={event => updateForm(reproduction.id, 'entrypoint', event.target.value)} /></label>
                        <label>Seeds<input value={formFor(reproduction).random_seeds} onChange={event => updateForm(reproduction.id, 'random_seeds', event.target.value)} /></label>
                        <label>结构化配置<textarea rows={2} value={formFor(reproduction).config} onChange={event => updateForm(reproduction.id, 'config', event.target.value)} /></label>
                        <button className="secondary" type="button" disabled={busy === `run:${reproduction.id}`} onClick={() => { void requestRun(reproduction) }}><Play size={15} />创建运行审批</button>
                      </div>
                    ) : null}
                    {reproductionRuns.length ? <div className="reproduction-runs">{reproductionRuns.map(run => <div className="data-row compact-row" key={run.id}><div><strong>Run {run.id.slice(0, 8)}</strong><p>{run.entrypoint} · seeds {run.random_seeds.join(', ')}{run.error ? ` · ${run.error}` : ''}</p></div><Badge status={run.status}>{statusText(run.status)}</Badge></div>)}</div> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          text="尚无代码复现候选。请先在相关文献页面添加论文代码仓库。"
          action={<button className="secondary" type="button" onClick={() => onNavigate('literature')}><GitBranch size={15} />打开相关文献</button>}
        />
      )}
      <div className="section">
        <SectionHeading title="复现边界" hint="系统只接受固定的相对入口和结构化计划；不会执行模型传入的 shell、cwd、任意路径或网络命令。复现进程是受监督的本机 Linux 进程，不等同于虚拟机隔离。" />
      </div>
    </>
  )
}
