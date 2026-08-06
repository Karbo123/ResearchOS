import { useEffect, useState } from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ModelSettingsResponse, ModelTierSettings, ReasoningEffort, TierId } from '../types'
import { ModelProxySwitch, ModelTestButton, StatusDot } from './ui'
import { useTranslation, type TranslationKey } from '../i18n'
import { useModelCatalog } from '../hooks/useModelCatalog'
import { ModelSelect, ReasoningEffortSelect } from './ModelCatalogFields'

const TIERS: Array<{ id: TierId; labelKey: TranslationKey; descriptionKey: TranslationKey; defaultEffort: ReasoningEffort }> = [
  { id: 'simple', labelKey: 'settings.tierLight', descriptionKey: 'settings.tierLightDescription', defaultEffort: 'low' },
  { id: 'medium', labelKey: 'settings.tierGeneral', descriptionKey: 'settings.tierGeneralDescription', defaultEffort: 'medium' },
  { id: 'complex', labelKey: 'settings.tierPowerful', descriptionKey: 'settings.tierPowerfulDescription', defaultEffort: 'high' },
]

interface TierFormValues extends ModelTierSettings {
  key: string
  use_proxy: boolean
}

function sourceLabelKey(value?: string) {
  if (value === 'project_override') return 'settings.sourceProject'
  return value === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv'
}

export function CodeModelSettingsForm({
  projectId,
  onClose,
  onDirtyChange,
  onSaved,
}: {
  projectId: string
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<TierId, TierFormValues> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const simpleCatalog = useModelCatalog(projectId, values?.simple?.url || '', values?.simple?.key || '', 'simple', values?.simple?.use_proxy)
  const mediumCatalog = useModelCatalog(projectId, values?.medium?.url || '', values?.medium?.key || '', 'medium', values?.medium?.use_proxy)
  const complexCatalog = useModelCatalog(projectId, values?.complex?.url || '', values?.complex?.key || '', 'complex', values?.complex?.use_proxy)
  const catalogs = { simple: simpleCatalog, medium: mediumCatalog, complex: complexCatalog }

  useEffect(() => {
    setLoading(true)
    setError('')
    api<ModelSettingsResponse>(`/api/projects/${projectId}/settings/models`)
      .then(result => {
        const next = {} as Record<TierId, TierFormValues>
        for (const tier of TIERS) {
          const item = result.tiers[tier.id] || {}
          next[tier.id] = {
            model: item.model || '',
            url: item.url || '',
            key: '',
            reasoning_effort: item.reasoning_effort || tier.defaultEffort,
            use_proxy: Boolean(item.use_proxy),
            key_configured: item.key_configured,
            sources: item.sources,
          }
        }
        setValues(next)
        setDirty(false)
        onDirtyChange(false)
      })
      .catch(err => setError(errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const update = (tier: TierId, field: keyof TierFormValues, value: string | boolean | ReasoningEffort) => {
    setValues(previous => previous ? {
      ...previous,
      [tier]: { ...previous[tier], [field]: value },
    } : previous)
    setDirty(true)
    onDirtyChange(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!values || loading || saving) return
    setSaving(true)
    setError('')
    try {
      const payload = {} as Record<TierId, { model: string; url: string; key: string; reasoning_effort: ReasoningEffort; use_proxy: boolean }>
      for (const tier of TIERS) {
        const item = values[tier.id]
        payload[tier.id] = {
          model: item.model.trim(),
          url: item.url.trim(),
          key: item.key,
          reasoning_effort: item.reasoning_effort || tier.defaultEffort,
          use_proxy: item.use_proxy,
        }
      }
      const result = await api<ModelSettingsResponse>(`/api/projects/${projectId}/settings/models`, {
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
          use_proxy: Boolean(item.use_proxy),
          key_configured: item.key_configured,
          sources: item.sources,
        }
      }
      setValues(next)
      setDirty(false)
      onDirtyChange(false)
      onSaved()
    } catch (err) {
      setError(`${t('settings.saveFailed', { error: errorMessage(err) })}${t('settings.keyHint')}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="empty">{t('settings.loadingModels')}</div>
  if (!values) return <div className="form-error" role="alert">{error || t('settings.loadFailed')}</div>

  return (
    <form className="model-settings-form" onSubmit={save}>
      {TIERS.map(tier => {
        const item = values[tier.id]
        return (
          <section className="model-tier" key={tier.id}>
            <div className="model-tier-heading">
              <div>
                <h3>{t(tier.labelKey)}</h3>
                <p className="model-tier-description">{t(tier.descriptionKey)}</p>
                <div className="tier-status">
                  <StatusDot ready={Boolean(item.key_configured && item.url)} />
                  {item.key_configured ? t('settings.keyConfigured') : t('settings.keyPending')} · {item.url ? t('settings.urlReady') : t('settings.urlPending')}
                </div>
                <div className="tier-sources">
                  <span>{t('settings.urlLabel')} · {t(sourceLabelKey(item.sources?.url) as any)}</span>
                  <span>{t('settings.keyLabel')} · {t(sourceLabelKey(item.sources?.key) as any)}</span>
                </div>
              </div>
              <div className="model-tier-tools">
                <ModelProxySwitch
                  checked={item.use_proxy}
                  onChange={value => update(tier.id, 'use_proxy', value)}
                  label={t('settings.modelProxyLabel')}
                />
                <ModelTestButton kind={tier.id} projectId={projectId} useProxy={item.use_proxy} fields={{ model: item.model, url: item.url, key: item.key }} />
              </div>
            </div>
            <div className="model-tier-grid">
              <label>
                {t('settings.modelName')}
                <ModelSelect
                  catalog={catalogs[tier.id]}
                  value={item.model}
                  onChange={value => update(tier.id, 'model', value)}
                />
              </label>
              <label>
                <span className="model-tier-label">
                  <span>{t('settings.reasoningEffort')}</span>
                  <span className="tier-default">{t('settings.default')} {t(tier.defaultEffort === 'low' ? 'settings.low' : tier.defaultEffort === 'medium' ? 'settings.medium' : 'settings.high')}</span>
                </span>
                <ReasoningEffortSelect
                  efforts={catalogs[tier.id].reasoning_efforts}
                  value={item.reasoning_effort}
                  onChange={value => update(tier.id, 'reasoning_effort', value)}
                />
              </label>
              <label>
                {t('settings.modelUrl')}
                <input
                  type="url"
                  value={item.url}
                  required
                  maxLength={500}
                  placeholder="http://127.0.0.1:3000/v1"
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
        <button className="secondary" type="button" onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" type="submit" disabled={loading || saving}>
          <Save size={16} />
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}
