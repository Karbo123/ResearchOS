import { useEffect, useState } from 'react'
import { ImagePlus, Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ImageGenerationQuality, ImageGenerationResolution, ImageGenerationSettings } from '../types'
import { ModelTestButton, StatusDot } from './ui'
import { useTranslation } from '../i18n'

interface FormValues extends ImageGenerationSettings {
  key: string
}

export function ImageGenerationSettingsForm({
  projectId,
  onChanged,
  onDirtyChange,
}: {
  projectId: string
  onChanged: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<FormValues | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<ImageGenerationSettings>(`/api/projects/${projectId}/settings/image-generation`)
      setValues({ ...result, key: '' })
      setDirty(false)
      onDirtyChange?.(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const update = (field: 'model' | 'url' | 'key' | 'resolution' | 'quality', value: string) => {
    setValues(previous => previous ? { ...previous, [field]: value } : previous)
    setDirty(true)
    onDirtyChange?.(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!values || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api<ImageGenerationSettings>(`/api/projects/${projectId}/settings/image-generation`, {
        method: 'PUT',
        body: JSON.stringify({
          model: values.model.trim(),
          url: values.url.trim(),
          key: values.key,
          resolution: values.resolution,
          quality: values.quality,
        }),
      })
      setValues({ ...result, key: '' })
      setDirty(false)
      onDirtyChange?.(false)
      onChanged()
    } catch (err) {
      setError(t('settings.saveFailed', { error: errorMessage(err) }))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="empty">{t('settings.loadingModels')}</div>
  if (!values) return <div className="form-error" role="alert">{error || t('settings.loadFailed')}</div>

  const ready = Boolean(values.url && values.key_configured)

  return (
    <form className="model-settings-form" onSubmit={save}>
      <section className="model-tier">
        <div className="model-tier-heading">
          <div>
            <h3>{t('imageModel.title')}</h3>
            <div className="tier-status">
              <StatusDot ready={ready} />
              {values.key_configured ? t('settings.keyConfigured') : t('settings.keyPending')} · {values.url ? t('settings.urlReady') : t('settings.urlPending')}
            </div>
            <div className="tier-sources">
              <span>{t('settings.urlLabel')} · {t(values.source === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv')}</span>
              <span>{t('settings.keyLabel')} · {t(values.source === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv')}</span>
            </div>
          </div>
          <span className="tier-default">{t('imageModel.defaultModel')}</span>
        </div>
        <div className="model-tier-grid">
          <label>
            {t('settings.modelName')}
            <input
              value={values.model}
              required
              maxLength={200}
              placeholder={t('imageModel.modelPlaceholder')}
              onChange={event => update('model', event.target.value)}
            />
          </label>
          <label>
            {t('settings.modelUrl')}
            <input
              type="url"
              value={values.url}
              required
              maxLength={500}
              placeholder={t('imageModel.urlPlaceholder')}
              onChange={event => update('url', event.target.value)}
            />
          </label>
          <label>
            {t('settings.apiKey')}
            <input
              type="password"
              value={values.key}
              placeholder={values.key_configured ? t('settings.keyKeep') : t('settings.keyPlaceholder')}
              autoComplete="new-password"
              maxLength={1000}
              onChange={event => update('key', event.target.value)}
            />
          </label>
          <label>
            {t('imageModel.resolution')}
            <select
              value={values.resolution}
              onChange={event => update('resolution', event.target.value as ImageGenerationResolution)}
            >
              <option value="1k">{t('imageModel.resolution1k')}</option>
              <option value="2k">{t('imageModel.resolution2k')}</option>
              <option value="4k">{t('imageModel.resolution4k')}</option>
            </select>
          </label>
          <label>
            {t('imageModel.quality')}
            <select
              value={values.quality}
              onChange={event => update('quality', event.target.value as ImageGenerationQuality)}
            >
              <option value="low">{t('imageModel.qualityLow')}</option>
              <option value="medium">{t('imageModel.qualityMedium')}</option>
              <option value="high">{t('imageModel.qualityHigh')}</option>
            </select>
          </label>
        </div>
        <p className="settings-note">
          <ImagePlus size={16} />
          <span>{t('imageModel.costNote')}</span>
        </p>
        <p className="settings-note">
          <ShieldCheck size={16} />
          <span>{t('imageModel.description')}</span>
        </p>
      </section>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="modal-actions">
        <ModelTestButton kind="image" projectId={projectId} fields={{ model: values.model, url: values.url, key: values.key }} />
        <button className="secondary" type="button" onClick={() => void load()}>{t('topbar.refresh')}</button>
        <button className="primary" type="submit" disabled={saving || !dirty}>
          <Save size={16} />
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}
