import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../api'
import type { ModelSettingsResponse, ModelTierSettings, ReasoningEffort, TierId } from '../types'
import { ConfirmDialog, Modal, StatusDot } from './ui'
import { GeneralSettingsForm } from './GeneralSettingsForm'
import { ProjectEmbeddingSettingsForm } from './ProjectEmbeddingSettingsForm'
import { VoiceSettingsForm } from './VoiceSettingsForm'
import { useTranslation, type TranslationKey } from '../i18n'

const TIERS: Array<{ id: TierId; label: string; defaultEffort: ReasoningEffort }> = [
  { id: 'simple', label: 'Luna', defaultEffort: 'low' },
  { id: 'medium', label: 'Terra', defaultEffort: 'medium' },
  { id: 'complex', label: 'Sol', defaultEffort: 'high' },
]

type SettingsTab = 'general' | 'models' | 'voice' | 'embedding'

const TABS: Array<{ id: SettingsTab; labelKey: TranslationKey }> = [
  { id: 'general', labelKey: 'settings.generalTab' },
  { id: 'models', labelKey: 'settings.modelsTab' },
  { id: 'voice', labelKey: 'settings.voiceTab' },
  { id: 'embedding', labelKey: 'settings.embeddingTab' },
]

interface TierFormValues extends ModelTierSettings {
  key: string
}

function sourceLabelKey(value?: string) {
  return value === 'runtime_override' ? 'settings.sourceRuntime' : 'settings.sourceEnv'
}

function SettingsSlidingNav({ active, onChange }: { active: SettingsTab; onChange: (next: SettingsTab) => void }) {
  const { t } = useTranslation()
  const navRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return undefined
    const measure = () => {
      const activeTab = nav.querySelector<HTMLElement>('button[data-active="true"]')
      if (!activeTab) return
      setIndicator({ left: activeTab.offsetLeft, width: activeTab.offsetWidth, ready: true })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(nav)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active])

  return (
    <div ref={navRef} className="sliding-nav settings-tabs" role="tablist" aria-label={t('settings.title')}>
      <span
        className={`sliding-tab-indicator${indicator.ready ? ' ready' : ''}`}
        aria-hidden="true"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          data-active={tab.id === active ? 'true' : 'false'}
          onClick={() => onChange(tab.id)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  )
}

export function ModelSettingsModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string | null }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [values, setValues] = useState<Record<TierId, TierFormValues> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmSwitchTo, setConfirmSwitchTo] = useState<SettingsTab | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('general')
    setValues(null)
    setDirty(false)
    setError('')
    setConfirmSwitchTo(null)
    setConfirmOpen(false)
  }, [open])

  useEffect(() => {
    if (!open || tab !== 'models') return
    setLoading(true)
    setError('')
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
  }, [open, tab])

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
      setConfirmSwitchTo(null)
      setConfirmOpen(true)
      return
    }
    onClose()
  }

  const switchTab = (next: SettingsTab) => {
    if (tab === 'models' && dirty && next !== 'models') {
      setConfirmSwitchTo(next)
      setConfirmOpen(true)
      return
    }
    if (next === 'models') setValues(null)
    setError('')
    setTab(next)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!values || loading) return
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
    }
  }

  const description = tab === 'general'
    ? t('settings.generalDescription')
    : tab === 'models'
      ? t('settings.modelsDescription')
      : tab === 'voice'
        ? t('settings.voiceDescription')
        : t('settings.embeddingDescription')

  return (
    <>
      <Modal
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={description}
        onClose={requestClose}
      >
        <SettingsSlidingNav active={tab} onChange={switchTab} />
        {tab === 'general' ? (
          <GeneralSettingsForm onChanged={() => setDirty(false)} />
        ) : tab === 'embedding' ? (
          projectId ? (
            <ProjectEmbeddingSettingsForm
              projectId={projectId}
              onChanged={() => setDirty(false)}
            />
          ) : (
            <div className="empty">{t('settings.openProjectFirst')}</div>
          )
        ) : tab === 'voice' ? (
          <VoiceSettingsForm onChanged={() => setDirty(false)} />
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
                        <span>{t('settings.urlLabel')} · {t(sourceLabelKey(item.sources?.url) as any)}</span>
                        <span>{t('settings.keyLabel')} · {t(sourceLabelKey(item.sources?.key) as any)}</span>
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
                        <option value="low">{t('settings.low')}</option>
                        <option value="medium">{t('settings.medium')}</option>
                        <option value="high">{t('settings.high')}</option>
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
              <button className="primary" type="submit" disabled={loading}>
                <Save size={16} />
                {t('settings.save')}
              </button>
            </div>
          </form>
        ) : (
          <div className="form-error" role="alert">{error || t('settings.loadFailed')}</div>
        )}
      </Modal>
      {confirmOpen ? (
        <ConfirmDialog
          title={t('settings.discardTitle')}
          description={t('settings.discardDescription')}
          confirmLabel={t('settings.discardConfirm')}
          onConfirm={() => {
            const target = confirmSwitchTo
            setConfirmSwitchTo(null)
            setConfirmOpen(false)
            setDirty(false)
            if (target) {
              if (target === 'models') setValues(null)
              setError('')
              setTab(target)
            } else {
              onClose()
            }
          }}
          onCancel={() => {
            setConfirmSwitchTo(null)
            setConfirmOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
