import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Languages, Palette, RefreshCw } from 'lucide-react'
import { LOCALE_OPTIONS, useTranslation, type Locale } from '../i18n'
import { THEME_OPTIONS, setTheme, useTheme, type Theme } from '../theme'

type MenuOption = { value: string; label: string }

function TopbarMenu({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: ReactNode
  label: string
  value: string
  options: MenuOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(Math.max(0, options.findIndex(option => option.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const currentIndex = Math.max(0, options.findIndex(option => option.value === value))
  const currentOption = options[currentIndex] || options[0]

  useEffect(() => {
    if (!open) return
    setHighlightedIndex(currentIndex)
    const frame = window.requestAnimationFrame(() => itemRefs.current[currentIndex]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [currentIndex, open])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const closeMenu = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const choose = (option: MenuOption) => {
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const moveHighlight = (nextIndex: number) => {
    const boundedIndex = (nextIndex + options.length) % options.length
    setHighlightedIndex(boundedIndex)
    itemRefs.current[boundedIndex]?.focus()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(currentIndex)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight(highlightedIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight(highlightedIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveHighlight(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveHighlight(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[highlightedIndex]
      if (option) choose(option)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="topbar-menu" ref={rootRef} data-open={open ? 'true' : 'false'}>
      <button
        ref={triggerRef}
        className="control-pill control-menu-trigger"
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="control-menu-leading" aria-hidden="true">{icon}</span>
        <span className="control-menu-value">{currentOption?.label}</span>
        <ChevronDown className="control-menu-chevron" size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="control-menu-popover" id={menuId} role="listbox" aria-label={label} onKeyDown={handleMenuKeyDown}>
          {options.map((option, index) => (
            <button
              ref={element => { itemRefs.current[index] = element }}
              className="control-menu-option"
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-highlighted={highlightedIndex === index ? 'true' : 'false'}
              key={option.value}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check className="control-menu-check" size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

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
      <div className="topbar-title">
        <h1 title={title}>{title}</h1>
        <div className="muted">{meta}</div>
      </div>
      <div className="top-actions">
        <TopbarMenu
          icon={<Languages size={15} />}
          label={t('topbar.language')}
          value={locale}
          options={LOCALE_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
          onChange={value => setLocale(value as Locale)}
        />
        <TopbarMenu
          icon={<Palette size={15} />}
          label={t('topbar.theme')}
          value={theme}
          options={THEME_OPTIONS.map(option => ({ value: option, label: t(option === 'light' ? 'theme.light' : 'theme.dark') }))}
          onChange={value => setTheme(value as Theme)}
        />
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
