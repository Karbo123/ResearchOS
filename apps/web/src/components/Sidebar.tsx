import { Plus, Settings, Share2, Workflow } from 'lucide-react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'

export function Sidebar({
  projects,
  activeProjectId,
  onNewProject,
  onOpenProject,
  onOpenMemory,
  onOpenSettings,
}: {
  projects: ProjectSummary[]
  activeProjectId: string | null
  onNewProject: () => void
  onOpenProject: (id: string) => void
  onOpenMemory: () => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
        <span>Research OS</span>
      </div>
      <button className="primary full" type="button" onClick={onNewProject}>
        <Plus size={17} />
        {t('sidebar.newProject')}
      </button>
      <div className="side-label">{t('sidebar.projects')}</div>
      <nav className="project-list" aria-label={t('sidebar.projects')}>
        {projects.length ? (
          projects.map(project => (
            <button
              key={project.id}
              type="button"
              className={project.id === activeProjectId ? 'active' : ''}
              aria-current={project.id === activeProjectId ? 'page' : undefined}
              title={project.title}
              onClick={() => onOpenProject(project.id)}
            >
              {project.title}
            </button>
          ))
        ) : (
          <div className="muted" style={{ padding: '4px 10px' }}>{t('sidebar.noProjects')}</div>
        )}
      </nav>
      <div className="service-links">
        <a href="/api/mastra/open" target="_blank" rel="noreferrer" title={t('sidebar.mastraWorkflows')}>
          <Workflow size={17} />
          {t('sidebar.mastraWorkflows')}
        </a>
        <button className="side-service" type="button" onClick={onOpenMemory} title={t('sidebar.memoryGraph')}>
          <Share2 size={17} />
          <span>{t('sidebar.memoryGraph')}</span>
        </button>
      </div>
      <button className="side-settings" type="button" onClick={onOpenSettings} title={t('sidebar.modelSettings')}>
        <Settings size={17} />
        <span>{t('sidebar.modelSettings')}</span>
      </button>
    </aside>
  )
}
