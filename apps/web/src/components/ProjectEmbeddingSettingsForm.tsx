import { useEffect, useState } from 'react'
import { Database, Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ProjectEmbeddingSettingsResponse } from '../types'
import { ConfirmDialog, EmbeddingTestButton, ModelProxySwitch, StatusDot } from './ui'
import { useTranslation } from '../i18n'

interface FormValues {
  mode: 'global' | 'custom'
  provider: 'local' | 'openai'
  model: string
  dimensions: number
  base_url: string
  env_base_url: string
  key: string
  use_proxy: boolean
  key_configured: boolean
}

const EMPTY: FormValues = {
  mode: 'global',
  provider: 'local',
  model: 'Xenova/bge-m3',
  dimensions: 1024,
  base_url: '',
  env_base_url: '',
  key: '',
  use_proxy: false,
  key_configured: false,
}

export function ProjectEmbeddingSettingsForm({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { t } = useTranslation()
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
        env_base_url: result.env_base_url || '',
        key: '',
        use_proxy: Boolean(result.use_proxy),
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

  const updateProvider = (provider: FormValues['provider']) => {
    setValues(previous => previous ? {
      ...previous,
      provider,
      base_url: provider === 'openai' ? (previous.base_url || previous.env_base_url || '') : '',
    } : previous)
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
          use_proxy: values.use_proxy,
          reset_data: resetData,
        }),
      })
      setValues(previous => previous ? { ...previous, key: '', use_proxy: Boolean(result.use_proxy), key_configured: result.key_configured } : previous)
      setInstance(result.instance)
      setDirty(false)
      setConfirmReset(false)
      onChanged()
    } catch (err) {
      const message = errorMessage(err)
      if (!resetData && message.includes('embedding_requires_reset')) {
        setConfirmReset(true)
      } else {
        setError(t('settings.saveFailed', { error: message }))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="empty">{t('embedding.loading')}</div>
  if (!values) return <div className="form-error" role="alert">{error || t('settings.loadFailed')}</div>

  const custom = values.mode === 'custom'
  const remote = custom && values.provider !== 'local'
  const ready = custom && (values.provider === 'local' || Boolean(values.base_url && (values.key || values.key_configured)))

  return (
    <>
      <form className="model-settings-form" onSubmit={event => { event.preventDefault(); void save(false) }}>
        <section className="model-tier">
          <div className="model-tier-heading">
            <div>
              <h3>{t('embedding.providerTitle')}</h3>
              <div className="tier-status">
                <StatusDot ready={ready} />
                {values.mode === 'global' ? t('embedding.globalDefault') : values.provider === 'local' ? t('embedding.localOnnx') : t('embedding.remoteApi')}
              </div>
            </div>
            <div className="model-tier-tools">
              {custom ? (
                <ModelProxySwitch
                  checked={values.use_proxy}
                  onChange={value => update('use_proxy', value)}
                  label={t('settings.modelProxyLabel')}
                />
              ) : null}
              <EmbeddingTestButton
                projectId={projectId}
                fields={{
                  mode: values.mode,
                  provider: values.provider,
                  model: values.model,
                  dimensions: values.dimensions,
                  base_url: values.base_url,
                  key: values.key,
                }}
                useProxy={values.use_proxy}
              />
              {instance?.mode === 'custom' && instance.port ? (
                <span className="tier-default">{t('embedding.instance')} :{instance.port}{instance.running ? t('embedding.running') : t('embedding.notRunning')}
                  {instance.shared_projects > 1 ? t('embedding.sharedProjects', { count: instance.shared_projects }) : ''}
                </span>
              ) : null}
            </div>
          </div>
          <div className="model-tier-grid">
            <label>
              {t('embedding.mode')}
              <select
                value={values.mode}
                onChange={event => update('mode', event.target.value as FormValues['mode'])}
              >
                <option value="global">{t('embedding.modeGlobal')}</option>
                <option value="custom">{t('embedding.modeCustom')}</option>
              </select>
            </label>
            <label>
              {t('embedding.provider')}
              <select
                value={values.provider}
                disabled={!custom}
                onChange={event => updateProvider(event.target.value as FormValues['provider'])}
              >
                <option value="local">local ({t('embedding.localOnnx')})</option>
                <option value="openai">openai ({t('embedding.openaiCompatible')})</option>
              </select>
            </label>
            <label>
              {t('embedding.model')}
              <input
                value={values.model}
                disabled={!custom}
                maxLength={300}
                placeholder={values.provider === 'local' ? 'Xenova/bge-m3' : t('embedding.modelPlaceholder')}
                onChange={event => update('model', event.target.value)}
              />
            </label>
            <label>
              {t('embedding.dimensions')}
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
                  {t('embedding.baseUrl')}
                  <input
                    value={values.base_url}
                    maxLength={500}
                    placeholder="https://.../v1"
                    onChange={event => update('base_url', event.target.value)}
                  />
                </label>
                <label>
                  {t('settings.apiKey')}
                  <input
                    type="password"
                    value={values.key}
                    placeholder={values.key_configured ? t('settings.keyKeep') : t('settings.keyPlaceholder')}
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
              {t('embedding.poolNote')}
            </span>
          </p>
          <p className="settings-note">
            <ShieldCheck size={16} />
            <span>{t('embedding.securityNote')}</span>
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
      {confirmReset ? (
        <ConfirmDialog
          title={t('embedding.resetTitle')}
          description={t('embedding.resetDescription')}
          confirmLabel={t('embedding.resetConfirm')}
          onConfirm={() => void save(true)}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </>
  )
}
