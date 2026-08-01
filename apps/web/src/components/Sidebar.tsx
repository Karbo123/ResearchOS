import { Plus, Settings, Share2, Workflow } from 'lucide-react'
import type { ProjectSummary } from '../types'

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
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">R</span>
        <span>Research OS</span>
      </div>
      <button className="primary full" type="button" onClick={onNewProject}>
        <Plus size={17} />
        新研究项目
      </button>
      <div className="side-label">项目</div>
      <nav className="project-list" aria-label="研究项目">
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
          <div className="muted" style={{ padding: '4px 10px' }}>暂无项目</div>
        )}
      </nav>
      <div className="service-links">
        <a href="/api/mastra/open" target="_blank" rel="noreferrer" title="打开 Mastra Studio 工作流图">
          <Workflow size={17} />
          Mastra Workflows
        </a>
        <button className="side-service" type="button" onClick={onOpenMemory} title="项目语义记忆图">
          <Share2 size={17} />
          <span>项目记忆图</span>
        </button>
      </div>
      <button className="side-settings" type="button" onClick={onOpenSettings} title="模型配置">
        <Settings size={17} />
        <span>模型配置</span>
      </button>
    </aside>
  )
}
