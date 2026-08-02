import { Languages, Palette, RefreshCw } from 'lucide-react'
import { LOCALE_OPTIONS, useTranslation, type Locale } from '../i18n'
import { THEME_OPTIONS, setTheme, useTheme, type Theme } from '../theme'

export function Topbar({
  title,
  meta,
  health,
  onRefresh,
}: {
  title: string
  meta: string
  health: 'connecting' | 'online' | 'offline'
  onRefresh: () => void
}) {
  const { locale, t, setLocale } = useTranslation()
  const theme = useTheme()
  const healthLabel = health === 'online' ? t('topbar.connected') : health === 'offline' ? t('topbar.offline') : t('topbar.connecting')
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <div className="muted">{meta}</div>
      </div>
      <div className="top-actions">
        <label className="control-pill" title={t('topbar.language')}>
          <Languages size={15} aria-hidden="true" />
          <span className="sr-only">{t('topbar.language')}</span>
          <select value={locale} aria-label={t('topbar.language')} onChange={event => setLocale(event.target.value as Locale)}>
            {LOCALE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="control-pill" title={t('topbar.theme')}>
          <Palette size={15} aria-hidden="true" />
          <span className="sr-only">{t('topbar.theme')}</span>
          <select value={theme} aria-label={t('topbar.theme')} onChange={event => setTheme(event.target.value as Theme)}>
            {THEME_OPTIONS.map(option => <option key={option} value={option}>{t(
              option === 'light'
                ? 'theme.light'
                : 'theme.dark',
            )}</option>)}
          </select>
        </label>
        <span className={`health ${health === 'online' ? 'ok' : ''}`}>
          <span />
          {healthLabel}
        </span>
        <button className="icon-btn" type="button" onClick={onRefresh} title={t('topbar.refresh')} aria-label={t('topbar.refresh')}>
          <RefreshCw size={17} />
        </button>
      </div>
    </header>
  )
}
