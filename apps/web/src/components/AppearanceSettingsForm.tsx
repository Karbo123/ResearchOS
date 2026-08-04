import { useState } from 'react'
import { Languages, Palette, Save } from 'lucide-react'
import { LOCALE_OPTIONS, useTranslation, type Locale } from '../i18n'
import { THEME_OPTIONS, setTheme, useTheme, type Theme } from '../theme'

export function AppearanceSettingsForm({
  onChanged,
  onDirtyChange,
}: {
  onChanged: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { locale, t, setLocale } = useTranslation()
  const theme = useTheme()
  const [draftLocale, setDraftLocale] = useState<Locale>(locale)
  const [draftTheme, setDraftTheme] = useState<Theme>(theme)
  const [dirty, setDirty] = useState(false)

  const updateAppearance = (field: 'locale' | 'theme', value: string) => {
    if (field === 'locale') setDraftLocale(value as Locale)
    else setDraftTheme(value as Theme)
    setDirty(true)
    onDirtyChange?.(true)
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    setLocale(draftLocale)
    setTheme(draftTheme)
    setDirty(false)
    onDirtyChange?.(false)
    onChanged()
  }

  return (
    <form className="model-settings-form" onSubmit={save}>
      <section className="model-tier settings-general-card">
        <div className="model-tier-heading">
          <div>
            <h3>{t('settings.appearanceTitle')}</h3>
            <div className="tier-status">
              <span>{t('settings.appearanceDescription')}</span>
            </div>
          </div>
        </div>
        <div className="settings-field-row">
          <span className="settings-field-label">
            <Languages size={15} aria-hidden="true" />
            {t('settings.language')}
          </span>
          <div className="settings-segmented settings-language-segmented" role="radiogroup" aria-label={t('settings.language')}>
            {LOCALE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === draftLocale}
                className={option.value === draftLocale ? 'active' : ''}
                onClick={() => updateAppearance('locale', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-field-row">
          <span className="settings-field-label">
            <Palette size={15} aria-hidden="true" />
            {t('settings.theme')}
          </span>
          <div className="settings-segmented settings-theme-segmented" role="radiogroup" aria-label={t('settings.theme')}>
            {THEME_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === draftTheme}
                className={option === draftTheme ? 'active' : ''}
                onClick={() => updateAppearance('theme', option)}
              >
                {t(option === 'light' ? 'theme.light' : 'theme.dark')}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className="modal-actions">
        <button className="primary" type="submit" disabled={!dirty}>
          <Save size={16} />
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}
