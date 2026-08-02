import { FileQuestion, House } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n'

interface NotFoundViewProps {
  path: string
  onGoHome: () => void
}

export function NotFoundView({ path, onGoHome }: NotFoundViewProps) {
  const { t } = useTranslation()
  const [seconds, setSeconds] = useState(3)
  const onGoHomeRef = useRef(onGoHome)

  useEffect(() => {
    onGoHomeRef.current = onGoHome
  }, [onGoHome])

  useEffect(() => {
    const countdown = window.setInterval(() => {
      setSeconds(value => Math.max(0, value - 1))
    }, 1000)
    const redirect = window.setTimeout(() => onGoHomeRef.current(), 3000)
    return () => {
      window.clearInterval(countdown)
      window.clearTimeout(redirect)
    }
  }, [])

  return (
    <main className="not-found-shell">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <div className="not-found-icon" aria-hidden="true">
          <FileQuestion size={34} strokeWidth={1.7} />
        </div>
        <p className="not-found-badge">{t('notFound.badge')}</p>
        <p className="not-found-code" aria-label="404">404</p>
        <h1 id="not-found-title">{t('notFound.title')}</h1>
        <p className="not-found-description">{t('notFound.description')}</p>
        <div className="not-found-path-wrap">
          <span className="not-found-path-label">{t('notFound.pathLabel')}</span>
          <code className="not-found-path">{path}</code>
        </div>
        <p className="not-found-countdown" aria-live="polite">
          {t('notFound.redirect', { seconds })}
        </p>
        <button className="not-found-home primary" type="button" onClick={onGoHome}>
          <House size={16} aria-hidden="true" />
          {t('notFound.home')}
        </button>
      </section>
    </main>
  )
}
