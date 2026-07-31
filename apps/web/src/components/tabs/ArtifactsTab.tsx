import type { ProjectDetail } from '../../types'
import { EmptyState, SectionHeading } from '../ui'
import { ArtifactCard } from '../previews'

export function ArtifactsTab({ project }: { project: ProjectDetail }) {
  return (
    <>
      <SectionHeading title="可视化与大文件产物" hint="产物记录 SHA-256、实验、Idea 版本、数据版本、配置、Run ID 和有效性。" />
      {project.artifacts?.length ? (
        <div className="artifact-grid">
          {project.artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} />)}
        </div>
      ) : (
        <EmptyState text="实验完成并同步后显示 PNG、PLY、JSON 和 PDF。" />
      )}
    </>
  )
}
