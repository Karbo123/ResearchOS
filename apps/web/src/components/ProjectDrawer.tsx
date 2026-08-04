import type { CSSProperties } from 'react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'
import { Sidebar } from './Sidebar'

function DrawerArrow() {
  return (
    <span className="project-drawer-arrow" aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" focusable="false">
        <path
          d="M4.1 2.6 L8.6 6 L4.1 9.4 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
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
