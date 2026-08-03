import { useEffect, useState } from 'react'
import { FileText, Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { DocumentModelSettings } from '../types'
import { StatusDot } from './ui'
import { useTranslation } from '../i18n'

interface FormValues extends DocumentModelSettings {
  key: string
}

export function DocumentModelSettingsForm({
  onChanged,
  onDirtyChange,
}: {
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
      const result = await api<DocumentModelSettings>('/api/settings/document')
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
  }, [])

  const update = (field: 'model' | 'url' | 'key', value: string) => {
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
      const result = await api<DocumentModelSettings>('/api/settings/document', {
        method: 'PUT',
        body: JSON.stringify({
          model: values.model.trim(),
          url: values.url.trim(),
          key: values.key,
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
            <h3>{t('documentModel.title')}</h3>
            <div className="tier-status">
              <StatusDot ready={ready} />
              {values.key_configured ? t('settings.keyConfigured') : t('settings.keyPending')} · {values.url ? t('settings.urlReady') : t('settings.urlPending')}
            </div>
            <div className="tier-sources">
              <span>{t('settings.urlLabel')} · {t(values.source === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv')}</span>
              <span>{t('settings.keyLabel')} · {t(values.source === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv')}</span>
            </div>
          </div>
          <span className="tier-default">{t('documentModel.defaultModel')}</span>
        </div>
        <div className="model-tier-grid">
          <label>
            {t('settings.modelName')}
            <input
              value={values.model}
              required
              maxLength={200}
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
              placeholder="http://127.0.0.1:3000/v1"
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
        </div>
        <p className="settings-note">
          <FileText size={16} />
          <span>{t('documentModel.description')}</span>
        </p>
        <p className="settings-note">
          <ShieldCheck size={16} />
          <span>{t('settings.securityNote')}</span>
        </p>
      </section>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={() => void load()}>{t('topbar.refresh')}</button>
        <button className="primary" type="submit" disabled={saving || !dirty}>
          <Save size={16} />
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}
