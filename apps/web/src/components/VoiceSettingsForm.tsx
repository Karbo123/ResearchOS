import { useEffect, useState } from 'react'
import { Mic, Save, ShieldCheck } from 'lucide-react'
import { ApiError, api, errorMessage } from '../api'
import type { VoiceProvider, VoiceSettingsResponse } from '../types'
import { StatusDot } from './ui'
import { useTranslation } from '../i18n'

interface FormValues {
  provider: VoiceProvider
  model: string
  url: string
  key_configured: boolean
}

export function VoiceSettingsForm({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation()
  const [values, setValues] = useState<FormValues | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const friendlyError = (err: unknown) => err instanceof ApiError && err.code === 'not_found'
    ? t('voice.endpointMissing')
    : errorMessage(err)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<VoiceSettingsResponse>('/api/settings/voice')
      setValues({
        provider: result.provider,
        model: result.model,
        url: result.url,
        key_configured: result.key_configured,
      })
      setDirty(false)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (field: keyof FormValues, value: string | boolean) => {
    setValues(previous => previous ? { ...previous, [field]: value } : previous)
    setDirty(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!values || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api<VoiceSettingsResponse>('/api/settings/voice', {
        method: 'PUT',
        body: JSON.stringify({
          provider: values.provider,
          model: values.model.trim(),
          url: values.url.trim(),
        }),
      })
      setValues(previous => previous ? { ...previous, ...result, key_configured: result.key_configured } : previous)
      setDirty(false)
      onChanged()
      window.dispatchEvent(new Event('researchos:voice-settings-changed'))
    } catch (err) {
      setError(t('settings.saveFailed', { error: friendlyError(err) }))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="empty">{t('voice.loading')}</div>
  if (!values) return <div className="form-error" role="alert">{error || t('settings.loadFailed')}</div>

  const groq = values.provider === 'groq'
  const ready = !groq || values.key_configured

  return (
    <form className="model-settings-form" onSubmit={save}>
      <section className="model-tier">
        <div className="model-tier-heading">
          <div>
            <h3>{t('voice.provider')}</h3>
            <div className="tier-status">
              <StatusDot ready={ready} />
              {groq ? (values.key_configured ? t('voice.keyConfigured') : t('voice.keyPending')) : t('voice.providerBrowser')}
            </div>
          </div>
          <span className="tier-default">{t('settings.default')} {t('voice.providerGroq')}</span>
        </div>
        <div className="model-tier-grid">
          <label>
            {t('voice.provider')}
            <select
              value={values.provider}
              onChange={event => update('provider', event.target.value as VoiceProvider)}
            >
              <option value="browser">{t('voice.providerBrowser')}</option>
              <option value="groq">{t('voice.providerGroq')}</option>
            </select>
          </label>
          <label>
            {t('voice.model')}
            <input
              value={values.model}
              disabled={!groq}
              maxLength={200}
              placeholder={t('voice.modelPlaceholder')}
              onChange={event => update('model', event.target.value)}
            />
          </label>
          <label>
            {t('voice.url')}
            <input
              type="url"
              value={values.url}
              disabled={!groq}
              maxLength={500}
              placeholder={t('voice.urlPlaceholder')}
              onChange={event => update('url', event.target.value)}
            />
          </label>
        </div>
        <p className="settings-note">
          <Mic size={16} />
          <span>{t('voice.securityNote')}</span>
        </p>
        <p className="settings-note">
          <ShieldCheck size={16} />
          <span>{t('voice.keyNote')}</span>
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
