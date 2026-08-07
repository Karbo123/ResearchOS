import { useEffect, useState } from 'react'
import { Bell, CircleAlert, FilePlus2, LoaderCircle, Network, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'
import { api, errorMessage } from '../api'
import { formatDateTime, useTranslation, type TranslationKey } from '../i18n'
import type { KnowledgeImpactItem, KnowledgeImpactReport } from '../types'
import { Badge, EmptyState, SectionHeading } from './ui'

function PolicyIcon({ policy }: { policy: string }) {
  if (policy === 'notify') return <Bell size={15} />
  if (policy === 'regenerate_required') return <RefreshCw size={15} />
  if (policy === 'evidence_blocked') return <ShieldAlert size={15} />
  if (policy === 'rerun_required') return <RotateCcw size={15} />
  return <CircleAlert size={15} />
}

const POLICY_LABELS: Record<string, TranslationKey> = {
  notify: 'knowledge.policy.notify',
  review_required: 'knowledge.policy.reviewRequired',
  regenerate_required: 'knowledge.policy.regenerateRequired',
  evidence_blocked: 'knowledge.policy.evidenceBlocked',
  rerun_required: 'knowledge.policy.rerunRequired',
}

const REASON_LABELS: Record<string, TranslationKey> = {
  knowledge_external_edit: 'knowledge.reason.externalEdit',
  knowledge_document_changed: 'knowledge.reason.documentChanged',
  evidence_revoked: 'knowledge.reason.evidenceRevoked',
  upstream_changed: 'knowledge.reason.upstreamChanged',
}

function impactNodeLabel(item: KnowledgeImpactItem, t: (key: TranslationKey) => string): string {
  const type = item.node_type === 'knowledge_document' ? t('knowledge.nodeType.knowledgeDocument') : item.node_type
  return `${type} · ${item.node_id}`
}

export function KnowledgeImpactSheet({ projectId, onRefresh, showToast, onOpenGraph }: { projectId: string; onRefresh: () => Promise<void>; showToast: (message: string) => void; onOpenGraph: () => void }) {
  const { t, locale } = useTranslation()
  const [reports, setReports] = useState<KnowledgeImpactReport[]>([])
  const [loading, setLoading] = useState(true)
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [failure, setFailure] = useState('')

  const load = async () => {
    setLoading(true)
    setFailure('')
    try {
      const result = await api<{ reports: KnowledgeImpactReport[] }>(`/api/projects/${encodeURIComponent(projectId)}/knowledge/impacts?limit=20`)
      setReports(result.reports)
    } catch (error) {
      const message = errorMessage(error)
      setFailure(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [projectId])

  const createProposal = async (item: KnowledgeImpactItem) => {
    setBusyItem(item.id)
    try {
      const result = await api<{ proposal_id: string }>(`/api/projects/${encodeURIComponent(projectId)}/knowledge/impacts/${encodeURIComponent(item.id)}/proposal`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'local-user' }),
      })
      showToast(t('knowledge.impactProposalCreated', { id: result.proposal_id.slice(0, 8) }))
      await Promise.all([load(), onRefresh()])
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusyItem(null)
    }
  }

  const items = reports.flatMap(report => report.items.map(item => ({ report, item })))
  return (
    <section className="section knowledge-impact-sheet">
      <SectionHeading
        title={t('knowledge.impactTitle')}
        hint={t('knowledge.impactScope')}
        extra={(<div className="knowledge-impact-tools">
          <button className="icon-btn" type="button" onClick={onOpenGraph} title={t('knowledge.openGraph')} aria-label={t('knowledge.openGraph')}><Network size={15} /></button>
          <button className="icon-btn" type="button" onClick={() => void load()} title={t('topbar.refresh')} aria-label={t('topbar.refresh')} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>)}
      />
      {loading && !items.length ? <div className="knowledge-loading" role="status"><LoaderCircle size={17} className="spin" />{t('common.loading')}</div> : null}
      {failure ? <div className="form-error" role="alert">{failure}</div> : null}
      {!loading && !failure && !items.length ? <EmptyState text={t('knowledge.impactEmpty')} /> : null}
      {items.length ? (
        <div className="knowledge-impact-list">
          {items.map(({ report, item }) => (
            <article className={`knowledge-impact-row policy-${item.policy}`} key={item.id}>
              <div className="knowledge-impact-icon" aria-hidden="true"><PolicyIcon policy={item.policy} /></div>
              <div className="knowledge-impact-copy">
                <div className="knowledge-impact-titleline">
                  <h3>{impactNodeLabel(item, t)}</h3>
                  <Badge status={item.status} />
                </div>
                <p>{t(REASON_LABELS[item.reason] || 'knowledge.reason.upstreamChanged')}</p>
                <p className="muted">{t(POLICY_LABELS[item.policy] || 'knowledge.policy.reviewRequired')} · {t('knowledge.impactDepth', { depth: item.depth })} · {formatDateTime(report.created_at, locale)}</p>
              </div>
              <div className="knowledge-impact-action">
                {item.status === 'open' ? (
                  <button className="secondary" type="button" onClick={() => void createProposal(item)} disabled={busyItem === item.id}>
                    {busyItem === item.id ? <LoaderCircle size={15} className="spin" /> : <FilePlus2 size={15} />}
                    {t('knowledge.createImpactProposal')}
                  </button>
                ) : item.proposal_id ? <code>{item.proposal_id.slice(0, 8)}</code> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
