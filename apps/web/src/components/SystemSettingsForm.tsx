import { useEffect, useState } from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useTranslation } from '../i18n'
import type { ProxySettings } from '../types'
import { StatusDot } from './ui'

const EMPTY_PROXY: ProxySettings = { enabled: false, url: '' }

export function SystemSettingsForm({
  onChanged,
  onDirtyChange,
}: {
  onChanged: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const [proxy, setProxy] = useState<ProxySettings>(EMPTY_PROXY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<ProxySettings>('/api/settings/proxy')
      setProxy(result)
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

  const updateProxy = (field: 'enabled' | 'url', value: boolean | string) => {
    setProxy(previous => ({ ...previous, [field]: value }))
    setDirty(true)
    onDirtyChange?.(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api<ProxySettings>('/api/settings/proxy', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: proxy.enabled,
          url: proxy.url.trim(),
        }),
      })
      setProxy(result)
      setDirty(false)
      onDirtyChange?.(false)
      onChanged()
    } catch (err) {
      setError(t('settings.saveFailed', { error: errorMessage(err) }))
    } finally {
      setSaving(false)
    }
  }

  const proxyReady = !proxy.enabled || Boolean(proxy.url)

  return (
    <form className="model-settings-form" onSubmit={save}>
      <section className="model-tier settings-proxy-card">
        <div className="model-tier-heading">
          <div>
            <h3>{t('settings.proxyTitle')}</h3>
            <div className="tier-status">
              <StatusDot ready={proxyReady} />
              {loading ? t('common.waiting') : proxy.enabled ? t('settings.proxyEnabled') : t('settings.proxyDisabled')}
            </div>
          </div>
          <span className="tier-default">{t('settings.default')} {proxy.enabled ? t('settings.proxyEnabled') : t('settings.proxyDisabled')}</span>
        </div>
        <div className="settings-proxy-row">
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={proxy.enabled}
              disabled={loading}
              onChange={event => updateProxy('enabled', event.target.checked)}
            />
            <span className="settings-switch-track" aria-hidden="true"><span /></span>
            <span>{t('settings.proxyEnabled')}</span>
          </label>
          {proxy.enabled ? (
            <label className="settings-proxy-url">
              <span>{t('settings.proxyUrl')}</span>
              <input
                type="url"
                value={proxy.url}
                disabled={loading}
                maxLength={500}
                placeholder="http://127.0.0.1:7890"
                onChange={event => updateProxy('url', event.target.value)}
              />
            </label>
          ) : (
            <span className="settings-proxy-state">{t('settings.proxyDisabled')}</span>
          )}
        </div>
        <p className="settings-note">
          <ShieldCheck size={16} />
          <span>{t('settings.proxyNote')}</span>
        </p>
      </section>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={() => void load()}>{t('topbar.refresh')}</button>
        <button className="primary" type="submit" disabled={saving || !dirty || loading}>
          <Save size={16} />
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}
