import { useEffect, useState } from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ModelSettingsResponse, ModelTierSettings, ReasoningEffort, TierId } from '../types'
import { ConfirmDialog, Modal, StatusDot } from './ui'

const TIERS: Array<{ id: TierId; label: string; defaultEffort: ReasoningEffort }> = [
  { id: 'simple', label: 'Luna', defaultEffort: 'low' },
  { id: 'medium', label: 'Terra', defaultEffort: 'medium' },
  { id: 'complex', label: 'Sol', defaultEffort: 'high' },
]

interface TierFormValues extends ModelTierSettings {
  key: string
}

function sourceLabel(value?: string) {
  return value === 'runtime_override' ? '运行时覆盖' : '项目 .env 默认'
}

export function ModelSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [values, setValues] = useState<Record<TierId, TierFormValues> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    setDirty(false)
    api<ModelSettingsResponse>('/api/settings/models')
      .then(result => {
        const next = {} as Record<TierId, TierFormValues>
        for (const tier of TIERS) {
          const item = result.tiers[tier.id] || {}
          next[tier.id] = {
            model: item.model || '',
            url: item.url || '',
            key: '',
            reasoning_effort: item.reasoning_effort || tier.defaultEffort,
            key_configured: item.key_configured,
            sources: item.sources,
          }
        }
        setValues(next)
      })
      .catch(err => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const update = (tier: TierId, field: keyof TierFormValues, value: string | ReasoningEffort) => {
    setValues(previous => previous ? {
      ...previous,
      [tier]: { ...previous[tier], [field]: value },
    } : previous)
    setDirty(true)
  }

  const requestClose = () => {
    if (dirty) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!values || saving) return
    setSaving(true)
    setError('')
    try {
      const payload = {} as Record<TierId, { model: string; url: string; key: string; reasoning_effort: ReasoningEffort }>
      for (const tier of TIERS) {
        const item = values[tier.id]
        payload[tier.id] = {
          model: item.model.trim(),
          url: item.url.trim(),
          key: item.key,
          reasoning_effort: item.reasoning_effort || tier.defaultEffort,
        }
      }
      const result = await api<ModelSettingsResponse>('/api/settings/models', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      const next = {} as Record<TierId, TierFormValues>
      for (const tier of TIERS) {
        const item = result.tiers[tier.id] || {}
        next[tier.id] = {
          model: item.model || values[tier.id].model,
          url: item.url || '',
          key: '',
          reasoning_effort: item.reasoning_effort || tier.defaultEffort,
          key_configured: item.key_configured,
          sources: item.sources,
        }
      }
      setValues(next)
      setDirty(false)
      onClose()
    } catch (err) {
      setError(`保存失败：${errorMessage(err)}。已配置的 key 留空即可保留；模型调用失败不会切换或降级。`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        eyebrow="运行时设置"
        title="模型配置"
        description="Luna、Terra、Sol 三档分别生效。未单独覆盖时，默认使用项目 .env 中的 URL 和 key，保存后立即用于下一次请求。"
        onClose={requestClose}
      >
        {loading ? (
          <div className="empty">正在读取模型配置…</div>
        ) : values ? (
          <form className="model-settings-form" onSubmit={save}>
            {TIERS.map(tier => {
              const item = values[tier.id]
              return (
                <section className="model-tier" key={tier.id}>
                  <div className="model-tier-heading">
                    <div>
                      <h3>{tier.label}<span className="badge neutral">{tier.id}</span></h3>
                      <div className="tier-status">
                        <StatusDot ready={Boolean(item.key_configured && item.url)} />
                        {item.key_configured ? '已配置 key' : '待配置 key'} · {item.url ? 'URL 已就绪' : '待配置 URL'}
                      </div>
                      <div className="tier-sources">
                        <span>URL：{sourceLabel(item.sources?.url)}</span>
                        <span>key：{sourceLabel(item.sources?.key)}</span>
                      </div>
                    </div>
                    <span className="tier-default">默认 {tier.defaultEffort}</span>
                  </div>
                  <div className="model-tier-grid">
                    <label>
                      模型名称
                      <input
                        value={item.model}
                        required
                        maxLength={200}
                        onChange={event => update(tier.id, 'model', event.target.value)}
                      />
                    </label>
                    <label>
                      推理强度
                      <select
                        value={item.reasoning_effort}
                        onChange={event => update(tier.id, 'reasoning_effort', event.target.value as ReasoningEffort)}
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </label>
                    <label>
                      模型 URL
                      <input
                        type="url"
                        value={item.url}
                        required
                        maxLength={500}
                        placeholder="https://.../v1"
                        onChange={event => update(tier.id, 'url', event.target.value)}
                      />
                    </label>
                    <label>
                      API key
                      <input
                        type="password"
                        value={item.key}
                        placeholder={item.key_configured ? '已配置，留空保持不变' : '输入 API key'}
                        autoComplete="new-password"
                        maxLength={1000}
                        onChange={event => update(tier.id, 'key', event.target.value)}
                      />
                    </label>
                  </div>
                </section>
              )
            })}
            <p className="settings-note">
              <ShieldCheck size={16} />
              <span>密钥只写入本机 runtime 文件，读取接口不会返回密钥。留空已配置的 key 会保持不变。</span>
            </p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={requestClose}>取消</button>
              <button className="primary" type="submit" disabled={saving}>
                <Save size={16} />
                保存配置
              </button>
            </div>
          </form>
        ) : (
          <div className="form-error" role="alert">{error || '无法加载模型配置。'}</div>
        )}
      </Modal>
      {confirmClose ? (
        <ConfirmDialog
          title="放弃未保存的配置？"
          description="配置尚未保存，确定关闭吗？"
          confirmLabel="放弃修改"
          onConfirm={() => {
            setConfirmClose(false)
            setDirty(false)
            onClose()
          }}
          onCancel={() => setConfirmClose(false)}
        />
      ) : null}
    </>
  )
}
