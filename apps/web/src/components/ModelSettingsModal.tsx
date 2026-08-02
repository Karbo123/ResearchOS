import { useEffect, useState } from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ModelSettingsResponse, ModelTierSettings, ReasoningEffort, TierId } from '../types'
import { ConfirmDialog, Modal, StatusDot } from './ui'
import { ProjectEmbeddingSettingsForm } from './ProjectEmbeddingSettingsForm'
import { useTranslation } from '../i18n'

const TIERS: Array<{ id: TierId; label: string; defaultEffort: ReasoningEffort }> = [
  { id: 'simple', label: 'Luna', defaultEffort: 'low' },
  { id: 'medium', label: 'Terra', defaultEffort: 'medium' },
  { id: 'complex', label: 'Sol', defaultEffort: 'high' },
]

interface TierFormValues extends ModelTierSettings {
  key: string
}

function sourceLabelKey(value?: string) {
  return value === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv'
}

export function ModelSettingsModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string | null }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'models' | 'embedding'>('models')
  const [values, setValues] = useState<Record<TierId, TierFormValues> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('models')
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

  const switchTab = (next: 'models' | 'embedding') => {
    if (dirty) {
      setConfirmClose(true)
      return
    }
    setError('')
    setTab(next)
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
      setError(`${t('settings.saveFailed', { error: errorMessage(err) })}${t('settings.keyHint')}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={tab === 'models'
          ? t('settings.modelsDescription')
          : t('settings.embeddingDescription')}
        onClose={requestClose}
      >
        <div className="settings-tabs" role="tablist">
          <button className={tab === 'models' ? 'active' : ''} type="button" onClick={() => switchTab('models')}>{t('settings.modelsTab')}</button>
          <button className={tab === 'embedding' ? 'active' : ''} type="button" onClick={() => switchTab('embedding')}>{t('settings.embeddingTab')}</button>
        </div>
        {tab === 'embedding' ? (
          projectId ? (
            <ProjectEmbeddingSettingsForm
              projectId={projectId}
              onChanged={() => setDirty(false)}
            />
          ) : (
            <div className="empty">{t('settings.openProjectFirst')}</div>
          )
        ) : loading ? (
          <div className="empty">{t('settings.loadingModels')}</div>
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
                        {item.key_configured ? t('settings.keyConfigured') : t('settings.keyPending')} · {item.url ? t('settings.urlReady') : t('settings.urlPending')}
                      </div>
                      <div className="tier-sources">
                        <span>URL：{t(sourceLabelKey(item.sources?.url) as any)}</span>
                        <span>key：{t(sourceLabelKey(item.sources?.key) as any)}</span>
                      </div>
                    </div>
                    <span className="tier-default">{t('settings.default')} {tier.defaultEffort}</span>
                  </div>
                  <div className="model-tier-grid">
                    <label>
                      {t('settings.modelName')}
                      <input
                        value={item.model}
                        required
                        maxLength={200}
                        onChange={event => update(tier.id, 'model', event.target.value)}
                      />
                    </label>
                    <label>
                      {t('settings.reasoningEffort')}
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
                      {t('settings.modelUrl')}
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
                      {t('settings.apiKey')}
                      <input
                        type="password"
                        value={item.key}
                        placeholder={item.key_configured ? t('settings.keyKeep') : t('settings.keyPlaceholder')}
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
              <span>{t('settings.securityNote')}</span>
            </p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={requestClose}>{t('common.cancel')}</button>
              <button className="primary" type="submit" disabled={saving}>
                <Save size={16} />
                {t('settings.save')}
              </button>
            </div>
          </form>
        ) : (
          <div className="form-error" role="alert">{error || t('settings.loadFailed')}</div>
        )}
      </Modal>
      {confirmClose ? (
        <ConfirmDialog
          title={t('settings.discardTitle')}
          description={t('settings.discardDescription')}
          confirmLabel={t('settings.discardConfirm')}
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
