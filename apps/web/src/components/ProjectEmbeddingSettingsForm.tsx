import { useEffect, useState } from 'react'
import { Database, Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ProjectEmbeddingSettingsResponse } from '../types'
import { ConfirmDialog, StatusDot } from './ui'

interface FormValues {
  mode: 'global' | 'custom'
  provider: 'local' | 'openai' | 'gemini'
  model: string
  dimensions: number
  base_url: string
  key: string
  key_configured: boolean
}

const EMPTY: FormValues = {
  mode: 'global',
  provider: 'local',
  model: 'Xenova/bge-m3',
  dimensions: 1024,
  base_url: '',
  key: '',
  key_configured: false,
}

export function ProjectEmbeddingSettingsForm({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [values, setValues] = useState<FormValues | null>(null)
  const [instance, setInstance] = useState<ProjectEmbeddingSettingsResponse['instance'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<ProjectEmbeddingSettingsResponse>(`/api/projects/${projectId}/embedding-settings`)
      setValues({
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        dimensions: result.dimensions,
        base_url: result.base_url,
        key: '',
        key_configured: result.key_configured,
      })
      setInstance(result.instance)
      setDirty(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectId) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const update = (field: keyof FormValues, value: string | number | boolean) => {
    setValues(previous => previous ? { ...previous, [field]: value } : previous)
    setDirty(true)
  }

  const save = async (resetData: boolean) => {
    if (!values || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api<ProjectEmbeddingSettingsResponse>(`/api/projects/${projectId}/embedding-settings`, {
        method: 'PUT',
        body: JSON.stringify({
          mode: values.mode,
          provider: values.provider,
          model: values.model.trim(),
          dimensions: Number(values.dimensions) || 1024,
          base_url: values.base_url.trim(),
          key: values.key,
          reset_data: resetData,
        }),
      })
      setValues(previous => previous ? { ...previous, key: '', key_configured: result.key_configured } : previous)
      setInstance(result.instance)
      setDirty(false)
      setConfirmReset(false)
      onChanged()
    } catch (err) {
      const message = errorMessage(err)
      if (!resetData && message.includes('embedding_requires_reset') || (!resetData && message.includes('全新数据目录'))) {
        setConfirmReset(true)
      } else {
        setError(`保存失败：${message}`)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="empty">正在读取项目 Embedding 配置…</div>
  if (!values) return <div className="form-error" role="alert">{error || '无法加载 Embedding 配置。'}</div>

  const custom = values.mode === 'custom'
  const remote = custom && values.provider !== 'local'
  const ready = custom && (values.provider === 'local' || Boolean(values.base_url && (values.key || values.key_configured)))

  return (
    <>
      <form className="model-settings-form" onSubmit={event => { event.preventDefault(); void save(false) }}>
        <section className="model-tier">
          <div className="model-tier-heading">
            <div>
              <h3>Embedding 提供方式</h3>
              <div className="tier-status">
                <StatusDot ready={ready} />
                {values.mode === 'global' ? '使用全局默认' : values.provider === 'local' ? '本地 ONNX 模型' : '远程 OpenAI-compatible API'}
              </div>
            </div>
            {instance?.mode === 'custom' && instance.port ? (
              <span className="tier-default">实例 :{instance.port}{instance.running ? ' · 运行中' : ' · 未运行'}
                {instance.shared_projects > 1 ? ` · 共享 ${instance.shared_projects} 个项目` : ''}
              </span>
            ) : null}
          </div>
          <div className="model-tier-grid">
            <label>
              配置模式
              <select
                value={values.mode}
                onChange={event => update('mode', event.target.value as FormValues['mode'])}
              >
                <option value="global">使用全局默认（.env）</option>
                <option value="custom">本项目独立配置</option>
              </select>
            </label>
            <label>
              Provider
              <select
                value={values.provider}
                disabled={!custom}
                onChange={event => update('provider', event.target.value as FormValues['provider'])}
              >
                <option value="local">local（本机 ONNX）</option>
                <option value="openai">openai（OpenAI-compatible）</option>
                <option value="gemini">gemini</option>
              </select>
            </label>
            <label>
              模型
              <input
                value={values.model}
                disabled={!custom}
                maxLength={300}
                placeholder={values.provider === 'local' ? 'Xenova/bge-m3' : '例如 Qwen3-Embedding-8B'}
                onChange={event => update('model', event.target.value)}
              />
            </label>
            <label>
              维度
              <input
                type="number"
                value={values.dimensions}
                disabled={!custom}
                min={1}
                max={4096}
                onChange={event => update('dimensions', Number(event.target.value))}
              />
            </label>
            {remote ? (
              <>
                <label>
                  基础 URL
                  <input
                    value={values.base_url}
                    maxLength={500}
                    placeholder="https://.../v1"
                    onChange={event => update('base_url', event.target.value)}
                  />
                </label>
                <label>
                  API key
                  <input
                    type="password"
                    value={values.key}
                    placeholder={values.key_configured ? '已配置，留空保持不变' : '输入 API key'}
                    autoComplete="new-password"
                    maxLength={2000}
                    onChange={event => update('key', event.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>
          <p className="settings-note">
            <Database size={16} />
            <span>
              相同配置的项目共享同一个 Supermemory 实例与数据目录（按配置池复用，端口 6770–6869），项目之间仍用
              container tag 隔离语义记忆；配置不同才启用新的配置池。默认推荐本地 Xenova/bge-m3（实测比远程 gitee 快约 10 倍）。
            </span>
          </p>
          <p className="settings-note">
            <ShieldCheck size={16} />
            <span>密钥只写入本机 runtime 文件，读取接口不会返回密钥；切换模型或维度会为项目分配新的配置池（旧池数据保留，语义记忆需重新摄入）。</span>
          </p>
        </section>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={() => void load()}>刷新</button>
          <button className="primary" type="submit" disabled={saving || !dirty}>
            <Save size={16} />
            保存配置
          </button>
        </div>
      </form>
      {confirmReset ? (
        <ConfirmDialog
          title="切换模型需要重建数据目录"
          description="切换 embedding 模型或维度后，该项目已有的语义记忆无法与新的向量空间混用，需要全新数据目录并重新摄入（旧数据目录会保留为备份）。确认继续吗？"
          confirmLabel="确认重建并保存"
          onConfirm={() => void save(true)}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </>
  )
}
