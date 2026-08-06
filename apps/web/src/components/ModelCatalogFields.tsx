import { Loader2 } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../i18n'
import type { ReasoningEffort } from '../types'
import type { ModelCatalogState } from '../hooks/useModelCatalog'

const REASONING_KEYS: Record<string, TranslationKey> = {
  low: 'settings.low',
  medium: 'settings.medium',
  high: 'settings.high',
}

export function ModelSelect({
  catalog,
  value,
  onChange,
}: {
  catalog: ModelCatalogState
  value: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const hasCatalog = catalog.models.length > 0
  const showCurrent = Boolean(value) && !catalog.models.includes(value)
  const disabled = catalog.status === 'loading' && !hasCatalog

  return (
    <>
      <select value={value || ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {!value ? (
          <option value="">
            {catalog.status === 'loading' ? t('settings.modelCatalogLoading') : t('settings.modelCatalogPlaceholder')}
          </option>
        ) : null}
        {catalog.models.map(model => (
          <option key={model} value={model}>{model}</option>
        ))}
        {showCurrent ? <option value={value}>{value}</option> : null}
      </select>
      {catalog.status === 'loading' ? (
        <span className="model-catalog-status loading" role="status">
          <Loader2 size={12} className="spin" />
          {t('settings.modelCatalogLoading')}
        </span>
      ) : null}
      {catalog.status === 'error' ? (
        <span className="model-catalog-status error" role="alert" title={catalog.error}>
          {t('settings.modelCatalogUnavailable')}
        </span>
      ) : null}
      {catalog.status === 'ready' ? (
        <span className="model-catalog-status ok">{t('settings.modelCatalogReady', { count: catalog.models.length })}</span>
      ) : null}
    </>
  )
}

export function ReasoningEffortSelect({
  efforts,
  value,
  onChange,
}: {
  efforts: string[]
  value: string
  onChange: (next: ReasoningEffort) => void
}) {
  const { t } = useTranslation()
  const options = efforts.length ? efforts : ['low', 'medium', 'high']
  const showCurrent = Boolean(value) && !options.includes(value)
  return (
    <select value={value} onChange={event => onChange(event.target.value as ReasoningEffort)}>
      {options.map(effort => (
        <option key={effort} value={effort}>
          {REASONING_KEYS[effort] ? t(REASONING_KEYS[effort]) : effort}
        </option>
      ))}
      {showCurrent ? <option value={value}>{value}</option> : null}
    </select>
  )
}
