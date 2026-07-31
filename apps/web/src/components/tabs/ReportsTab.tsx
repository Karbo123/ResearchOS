import { useState } from 'react'
import { FileText } from 'lucide-react'
import { api, errorMessage } from '../../api'
import type { ProjectDetail } from '../../types'
import { ButtonRow, SectionHeading } from '../ui'

export function ReportsTab({
  project,
  showToast,
}: {
  project: ProjectDetail
  showToast: (message: string) => void
}) {
  const [content, setContent] = useState(project.reports?.[0]?.content || '')

  const generateReport = async (period: 'daily' | 'weekly') => {
    try {
      const result = await api<{ content: string }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ project_id: project.id, period }),
      })
      setContent(result.content)
    } catch (error) {
      showToast(errorMessage(error))
    }
  }

  return (
    <>
      <SectionHeading
        title="科研报告"
        extra={
          <ButtonRow>
            <button className="secondary" type="button" onClick={() => generateReport('daily')}>
              <FileText size={15} />
              日报
            </button>
            <button className="secondary" type="button" onClick={() => generateReport('weekly')}>
              <FileText size={15} />
              周报
            </button>
          </ButtonRow>
        }
      />
      <div className={`${content ? 'report' : 'empty'}`}>{content || '选择报告周期。'}</div>
      {project.reports && project.reports.length > 1 ? (
        <div className="section">
          <h3>历史报告</h3>
          <div className="data-list">
            {project.reports.slice(1).map(report => (
              <div className="data-row" key={report.id}>
                <div>
                  <h3>{report.period}</h3>
                  <p>{report.created_at}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
