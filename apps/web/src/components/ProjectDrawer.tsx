import type { CSSProperties } from 'react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'
import { Sidebar } from './Sidebar'

function DrawerArrow() {
  return (
    <span className="project-drawer-arrow" aria-hidden="true">
      <svg width="14" height="18" viewBox="0 0 14 18" focusable="false">
        <path
          d="M4.3 4.4 L10 9 L4.3 13.6 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export function ProjectDrawer({
  open,
  drawerWidth,
  onOpenChange,
  ...sidebarProps
}: {
  open: boolean
  drawerWidth: number
  onOpenChange: (open: boolean) => void
  projects: ProjectSummary[]
  activeProjectId: string | null
  onNewProject: () => void
  onOpenProject: (id: string) => void
  onOpenMemory: () => void
  onOpenSettings: () => void
  onDeleteProject: (project: ProjectSummary) => void
  onPinProject: (project: ProjectSummary) => void
  onReorderProjects: (projectIds: string[]) => Promise<void>
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { t } = useTranslation()
  const label = open ? t('projectDrawer.close') : t('projectDrawer.open')

  return (
    <div
      className={`project-drawer-region${open ? ' open' : ''}`}
      style={{ '--project-drawer-width': `${drawerWidth}px` } as CSSProperties}
    >
      <div className="project-drawer-shell" id="project-drawer-panel" aria-label={t('projectDrawer.projects')}>
        <Sidebar {...sidebarProps} />
      </div>
      {open ? (
        <button
          className="project-drawer-scrim"
          type="button"
          aria-label={label}
          tabIndex={-1}
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      <button
        className="project-drawer-toggle"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="project-drawer-panel"
        title={label}
        onClick={() => onOpenChange(!open)}
      >
        <DrawerArrow />
      </button>
    </div>
  )
}
