import { useState } from 'react'
import type { ProjectSummary } from '../types'
import { useTranslation } from '../i18n'
import { Modal } from './ui'

export function DeleteProjectDialog({
  project,
  busy,
  onClose,
  onConfirm,
}: {
  project: ProjectSummary
  busy: boolean
  onClose: () => void
  onConfirm: (title: string, confirmation: string) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const canDelete = title === project.title && confirmation === 'DELETE' && !busy

  return (
    <Modal
      eyebrow={t('deleteProject.eyebrow')}
      title={t('deleteProject.title')}
      description={t('deleteProject.description')}
      onClose={busy ? () => undefined : onClose}
    >
      <div className="delete-project-content">
        <div className="delete-project-target">
          <span>{t('deleteProject.projectLabel')}</span>
          <strong title={project.title}>{project.title}</strong>
        </div>
        <label className="field-label" htmlFor="delete-project-name">{t('deleteProject.nameLabel')}</label>
        <input
          id="delete-project-name"
          className="text-input"
          value={title}
          disabled={busy}
          placeholder={t('deleteProject.namePlaceholder')}
          onChange={event => setTitle(event.target.value)}
          autoComplete="off"
        />
        <label className="field-label" htmlFor="delete-project-confirmation">{t('deleteProject.confirmationLabel')}</label>
        <input
          id="delete-project-confirmation"
          className="text-input confirmation-input"
          value={confirmation}
          disabled={busy}
          placeholder={t('deleteProject.confirmationPlaceholder')}
          onChange={event => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="delete-project-warning">{t('deleteProject.warning')}</p>
        <div className="modal-actions">
          <button className="secondary" type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button className="reject" type="button" disabled={!canDelete} onClick={() => onConfirm(title, confirmation)}>
            {busy ? t('deleteProject.deleting') : t('deleteProject.confirm')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
