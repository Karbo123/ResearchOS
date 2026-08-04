import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Modal, ConfirmDialog } from './ui'
import { AppearanceSettingsForm } from './AppearanceSettingsForm'
import { SystemSettingsForm } from './SystemSettingsForm'
import { CodeModelSettingsForm } from './CodeModelSettingsForm'
import { DocumentModelSettingsForm } from './DocumentModelSettingsForm'
import { VisionModelSettingsForm } from './VisionModelSettingsForm'
import { ImageGenerationSettingsForm } from './ImageGenerationSettingsForm'
import { ProjectEmbeddingSettingsForm } from './ProjectEmbeddingSettingsForm'
import { VoiceSettingsForm } from './VoiceSettingsForm'
import { useTranslation, type TranslationKey } from '../i18n'

type SettingsTab = 'general' | 'models' | 'system'
type ModelSubTab = 'code' | 'document' | 'vision' | 'image' | 'embedding' | 'voice'
type PendingSwitch = { kind: 'tab' | 'subtab'; value: string } | null

const TABS: Array<{ id: SettingsTab; labelKey: TranslationKey }> = [
  { id: 'general', labelKey: 'settings.generalTab' },
  { id: 'models', labelKey: 'settings.modelsTab' },
  { id: 'system', labelKey: 'settings.systemTab' },
]

const MODEL_TABS: Array<{ id: ModelSubTab; labelKey: TranslationKey }> = [
  { id: 'code', labelKey: 'settings.codeModelsTab' },
  { id: 'document', labelKey: 'settings.documentTab' },
  { id: 'vision', labelKey: 'settings.visionTab' },
  { id: 'image', labelKey: 'settings.imageTab' },
  { id: 'embedding', labelKey: 'settings.embeddingTab' },
  { id: 'voice', labelKey: 'settings.voiceTab' },
]

function SettingsSlidingNav({
  active,
  onChange,
  items,
  className = '',
  ariaLabel,
}: {
  active: string
  onChange: (next: string) => void
  items: Array<{ id: string; labelKey: TranslationKey }>
  className?: string
  ariaLabel: string
}) {
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
  }, [active, items])

  return (
    <div ref={navRef} className={`sliding-nav settings-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      <span
        className={`sliding-tab-indicator${indicator.ready ? ' ready' : ''}`}
        aria-hidden="true"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === active}
          data-active={item.id === active ? 'true' : 'false'}
          onClick={() => onChange(item.id)}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  )
}

export function ModelSettingsModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string | null }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [subTab, setSubTab] = useState<ModelSubTab>('code')
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<PendingSwitch>(null)

  useEffect(() => {
    if (!open) return
    setTab('general')
    setSubTab('code')
    setDirty(false)
    setPending(null)
  }, [open])

  if (!open) return null

  const requestClose = () => {
    if (dirty) {
      setPending({ kind: 'tab', value: 'close' })
      return
    }
    onClose()
  }

  const switchTopTab = (next: SettingsTab) => {
    if (dirty && next !== tab) {
      setPending({ kind: 'tab', value: next })
      return
    }
    setDirty(false)
    setTab(next)
  }

  const switchSubTab = (next: ModelSubTab) => {
    if (dirty && next !== subTab) {
      setPending({ kind: 'subtab', value: next })
      return
    }
    setDirty(false)
    setSubTab(next)
  }

  const confirmPending = () => {
    if (!pending) return
    if (pending.kind === 'tab' && pending.value === 'close') {
      onClose()
    } else if (pending.kind === 'tab') {
      setTab(pending.value as SettingsTab)
    } else {
      setSubTab(pending.value as ModelSubTab)
    }
    setDirty(false)
    setPending(null)
  }

  const description = tab === 'general'
    ? t('settings.appearanceDescription')
    : tab === 'system'
      ? t('settings.systemDescription')
      : subTab === 'code'
        ? t('settings.codeModelsDescription')
        : subTab === 'document'
          ? t('settings.documentDescription')
          : subTab === 'vision'
            ? t('settings.visionDescription')
            : subTab === 'image'
              ? t('settings.imageDescription')
              : subTab === 'embedding'
                ? t('settings.embeddingDescription')
                : t('settings.voiceDescription')

  return (
    <>
      <Modal
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={description}
        onClose={requestClose}
      >
        <SettingsSlidingNav
          active={tab}
          onChange={next => switchTopTab(next as SettingsTab)}
          items={TABS}
          ariaLabel={t('settings.title')}
        />
        {tab === 'general' ? (
          <AppearanceSettingsForm onChanged={() => setDirty(false)} onDirtyChange={setDirty} />
        ) : tab === 'system' ? (
          <SystemSettingsForm onChanged={() => setDirty(false)} onDirtyChange={setDirty} />
        ) : projectId ? (
          <>
            <SettingsSlidingNav
              active={subTab}
              onChange={next => switchSubTab(next as ModelSubTab)}
              items={MODEL_TABS}
              className="settings-model-sections"
              ariaLabel={t('settings.modelsTab')}
            />
            {subTab === 'code' ? (
              <CodeModelSettingsForm
                projectId={projectId}
                onClose={requestClose}
                onDirtyChange={setDirty}
                onSaved={() => setDirty(false)}
              />
            ) : subTab === 'document' ? (
              <DocumentModelSettingsForm
                projectId={projectId}
                onChanged={() => setDirty(false)}
                onDirtyChange={setDirty}
              />
            ) : subTab === 'vision' ? (
              <VisionModelSettingsForm
                projectId={projectId}
                onChanged={() => setDirty(false)}
                onDirtyChange={setDirty}
              />
            ) : subTab === 'image' ? (
              <ImageGenerationSettingsForm
                projectId={projectId}
                onChanged={() => setDirty(false)}
                onDirtyChange={setDirty}
              />
            ) : subTab === 'embedding' ? (
              <ProjectEmbeddingSettingsForm
                projectId={projectId}
                onChanged={() => setDirty(false)}
              />
            ) : (
              <VoiceSettingsForm projectId={projectId} onChanged={() => setDirty(false)} />
            )}
          </>
        ) : (
          <div className="empty">{t('settings.openProjectFirst')}</div>
        )}
      </Modal>
      {pending ? (
        <ConfirmDialog
          title={t('settings.discardTitle')}
          description={t('settings.discardDescription')}
          confirmLabel={t('settings.discardConfirm')}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  )
}
