import { useEffect, type CSSProperties } from 'react'
import { useTranslation } from '../i18n'
import { HomeSidebar, type HomeSidebarProps } from './HomeSidebar'

export function HomeDrawer({
  open,
  drawerWidth,
  onOpenChange,
  ...sidebarProps
}: HomeSidebarProps & {
  open: boolean
  drawerWidth: number
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const label = open ? t('projectDrawer.close') : t('projectDrawer.open')

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.project-drawer-region')) {
        onOpenChange(false)
      }
    }
    const closeOnFocusOutside = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.project-drawer-region')) {
        onOpenChange(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    document.addEventListener('focusin', closeOnFocusOutside, true)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      document.removeEventListener('focusin', closeOnFocusOutside, true)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [open, onOpenChange])

  return (
    <div
      className={`project-drawer-region home-drawer-region${open ? ' open' : ''}`}
      style={{ '--project-drawer-width': `${drawerWidth}px` } as CSSProperties}
    >
      <div className="project-drawer-shell home-drawer-shell" id="home-drawer-panel" aria-label={t('projectDrawer.projects')}>
        <HomeSidebar {...sidebarProps} />
      </div>
      {open ? (
        <button
          className="project-drawer-scrim home-drawer-scrim"
          type="button"
          aria-label={label}
          tabIndex={-1}
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      <button
        className="project-drawer-toggle home-drawer-toggle"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="home-drawer-panel"
        title={label}
        onClick={() => onOpenChange(!open)}
      />
    </div>
  )
}
