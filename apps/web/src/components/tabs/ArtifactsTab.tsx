import type { ProjectDetail } from '../../types'
import { EmptyState, SectionHeading } from '../ui'
import { ArtifactCard } from '../previews'
import { useTranslation } from '../../i18n'

export function ArtifactsTab({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation()
  return (
    <>
      <SectionHeading title={t('artifacts.title')} hint={t('artifacts.hint')} />
      {project.artifacts?.length ? (
        <div className="artifact-grid">
          {project.artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} />)}
        </div>
      ) : (
        <EmptyState text={t('artifacts.empty')} />
      )}
    </>
  )
}
