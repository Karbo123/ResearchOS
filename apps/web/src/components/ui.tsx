import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock3, FileQuestion, Globe, Inbox, Loader2, LockKeyhole, RotateCw, X, Zap } from 'lucide-react'
import { api, ApiError, errorMessage } from '../api'
import type { ModelTestKind } from '../types'
import { useTranslation, type TranslationKey } from '../i18n'

export type BadgeKind = 'neutral' | 'live' | 'pending' | 'failed'

const STATUS_KEYS: Record<string, TranslationKey> = {
  accepted: 'status.accepted',
  active: 'status.active',
  approval_required: 'status.approvalRequired',
  approved: 'status.approved',
  awaiting_artifact_approval: 'status.awaitingArtifactApproval',
  blocked: 'status.blocked',
  calculated: 'status.calculated',
  cancel_requested: 'status.cancelRequested',
  candidate: 'status.candidate',
  candidate_exists: 'status.candidateExists',
  candidate_only: 'status.candidateOnly',
  cancelled: 'status.cancelled',
  claim_reviewed: 'status.claimReviewed',
  clean: 'status.clean',
  closed: 'status.closed',
  completed: 'status.completed',
  confirmed: 'status.confirmed',
  confirmed_paper: 'status.confirmedPaper',
  conflict: 'status.conflict',
  current: 'status.current',
  declared: 'status.declared',
  dependency_failed: 'status.dependencyFailed',
  dependency_installing: 'status.dependencyInstalling',
  dependency_pending: 'status.dependencyPending',
  dirty: 'status.dirty',
  disabled: 'status.disabled',
  draft: 'status.draft',
  done: 'common.done',
  empty: 'status.empty',
  enabled: 'status.enabled',
  enforced: 'status.enforced',
  evidence_required: 'status.evidenceRequired',
  failed: 'status.failed',
  fulltext_evidence: 'status.fulltextEvidence',
  invalid: 'common.invalid',
  invalid_response: 'status.invalidResponse',
  invalidated: 'status.invalidated',
  indexing: 'status.indexing',
  index_failed: 'status.indexFailed',
  index_stale: 'status.indexStale',
  legacy_unverified: 'status.legacyUnverified',
  license_review_required: 'status.licenseReviewRequired',
  located: 'status.located',
  manual: 'status.manual',
  max_total_reached: 'status.maxTotalReached',
  metadata_candidate: 'status.metadataCandidate',
  metadata_candidates_only: 'status.metadataCandidatesOnly',
  metadata_verified: 'status.metadataVerified',
  metadata_only: 'status.metadataOnly',
  observed: 'status.observed',
  ok: 'status.ok',
  open: 'status.open',
  page_quote: 'status.pageQuote',
  partial: 'status.partial',
  paused: 'status.paused',
  pending: 'status.pending',
  project_contained: 'status.projectContained',
  project_scoped: 'status.projectScoped',
  proposal_created: 'status.proposalCreated',
  queued: 'status.queued',
  rate_limited: 'status.rateLimited',
  ready: 'status.ready',
  registered: 'status.registered',
  rejected: 'status.rejected',
  reopened: 'status.reopened',
  reviewed: 'status.reviewed',
  review_required: 'status.reviewRequired',
  running: 'status.running',
  selected: 'status.selected',
  semantic_candidate: 'status.semanticCandidate',
  source_downloaded: 'status.sourceDownloaded',
  source_downloading: 'status.sourceDownloading',
  started: 'status.started',
  succeeded: 'status.succeeded',
  stale: 'status.stale',
  superseded: 'status.superseded',
  timed_out: 'status.timedOut',
  unconfirmed: 'status.unconfirmed',
  unknown: 'common.unknown',
  unlocated: 'status.unlocated',
  unresolved: 'status.unresolved',
  unsupported: 'status.unsupported',
  valid: 'status.valid',
  verified: 'status.verified',
  versioned: 'status.versioned',
  fingerprint: 'status.fingerprint',
  waiting_approval: 'status.waitingApproval',
}

export function statusLabel(status: string | null | undefined, t: (key: TranslationKey) => string): string {
  const normalized = String(status || '').replaceAll('-', '_').toLowerCase()
  const key = STATUS_KEYS[normalized]
  return key ? t(key) : status || ''
}

export function badgeKind(status?: string | null): BadgeKind {
  const value = String(status || '').toLowerCase()
  if (['approved', 'succeeded', 'verified', 'active', 'enforced', 'ready', 'fulltext-evidence', 'fulltext_evidence', 'enabled', 'completed', 'valid', 'running', 'claim_reviewed', 'page_quote', 'source_downloaded'].includes(value)) return 'live'
  if (['failed', 'rejected', 'cancelled', 'unsupported', 'license-review-required', 'license_review_required', 'invalid', 'invalidated', 'blocked', 'dependency_failed', 'timed_out', 'rate_limited', 'invalid_response'].includes(value)) return 'failed'
  if (['pending', 'candidate-only', 'candidate_only', 'metadata-only', 'metadata_only', 'review-required', 'review_required', 'manual', 'evidence-required', 'evidence_required', 'unknown', 'queued', 'paused', 'awaiting_artifact_approval', 'source_downloading', 'waiting_approval', 'dependency_pending', 'unconfirmed', 'unlocated', 'candidate'].includes(value)) return 'pending'
  return 'neutral'
}

export function Badge({ status, children }: { status?: string | null; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return <span className={`badge ${badgeKind(status)}`}>{children ?? statusLabel(status, t)}</span>
}

export function StatusDot({ ready }: { ready: boolean }) {
  return <span className={`status-dot ${ready ? 'ready' : ''}`} />
}

export function ModelProxySwitch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <label className="settings-switch settings-model-proxy" title={label}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="settings-switch-track" aria-hidden="true"><span /></span>
      <span>{label}</span>
    </label>
  )
}

function modelTestFailureMessage(error: unknown, t: (key: TranslationKey) => string): string {
  if (!(error instanceof ApiError)) return errorMessage(error)
  const keyByCode: Partial<Record<string, TranslationKey>> = {
    model_test_invalid_response: 'settings.testInvalidResponse',
    model_test_timeout: 'settings.testTimeout',
    model_test_unreachable: 'settings.testUnreachable',
    model_test_upstream_error: 'settings.testUpstreamError',
    proxy_test_timeout: 'settings.proxyTestTimeout',
    proxy_test_unreachable: 'settings.proxyTestUnreachable',
    proxy_test_upstream_error: 'settings.proxyTestUpstreamError',
  }
  const key = keyByCode[error.code]
  return key ? t(key) : errorMessage(error)
}

export function ModelTestButton({
  kind,
  fields,
  projectId,
  useProxy,
  onResult,
}: {
  kind: ModelTestKind
  fields: { model: string; url: string; key: string }
  projectId?: string
  useProxy?: boolean
  onResult?: (ok: boolean) => void
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState('')
  const run = async () => {
    if (state === 'testing') return
    setState('testing')
    setMessage(t('settings.testing'))
    setDetail('')
    try {
      const result = await api<{ ok: boolean; elapsed: number; message: string }>('/api/settings/model-test', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          model: fields.model.trim(),
          url: fields.url.trim(),
          key: fields.key,
          use_proxy: useProxy,
          project_id: projectId || undefined,
        }),
      })
      setState('ok')
      setMessage(t('settings.testSucceeded'))
      setDetail(result.message)
      onResult?.(true)
    } catch (err) {
      setState('failed')
      setMessage(modelTestFailureMessage(err, t))
      setDetail(err instanceof Error ? err.message : '')
      onResult?.(false)
    }
  }
  return (
    <span className="model-test-control">
      <button className="secondary model-test-button" type="button" disabled={state === 'testing'} onClick={() => void run()}>
        {state === 'testing' ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}
        {t('settings.test')}
      </button>
      {state !== 'idle' ? (
        <span className={`model-test-message ${state === 'ok' ? 'ok' : state === 'failed' ? 'failed' : ''}`} role="status" aria-live="polite" title={detail || message}>
          {message}
        </span>
      ) : null}
    </span>
  )
}

export function ProxyTestButton({ url }: { url: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState('')
  const run = async () => {
    if (state === 'testing') return
    setState('testing')
    setMessage(t('settings.testing'))
    setDetail('')
    try {
      const result = await api<{ ok: boolean; elapsed: number; message: string }>('/api/settings/proxy-test', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() }),
      })
      setState('ok')
      setMessage(t('settings.proxyTestSucceeded'))
      setDetail(result.message)
    } catch (err) {
      setState('failed')
      setMessage(modelTestFailureMessage(err, t))
      setDetail(err instanceof Error ? err.message : '')
    }
  }
  return (
    <span className="model-test-control">
      <button className="secondary model-test-button" type="button" disabled={state === 'testing'} onClick={() => void run()}>
        {state === 'testing' ? <Loader2 size={14} className="spin" /> : <Globe size={14} />}
        {t('settings.testProxy')}
      </button>
      {state !== 'idle' ? (
        <span className={`model-test-message ${state === 'ok' ? 'ok' : state === 'failed' ? 'failed' : ''}`} role="status" aria-live="polite" title={detail || message}>
          {message}
        </span>
      ) : null}
    </span>
  )
}

export function EmbeddingTestButton({
  fields,
  projectId,
  useProxy,
  onResult,
}: {
  fields: { mode: 'global' | 'custom'; provider: 'local' | 'openai'; model: string; dimensions: number; base_url: string; key: string }
  projectId: string
  useProxy?: boolean
  onResult?: (ok: boolean) => void
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState('')
  const run = async () => {
    if (state === 'testing') return
    setState('testing')
    setMessage(t('settings.testing'))
    setDetail('')
    try {
      const result = await api<{ ok: boolean; elapsed: number; message: string }>(`/api/projects/${projectId}/embedding-test`, {
        method: 'POST',
        body: JSON.stringify({
          mode: fields.mode,
          provider: fields.provider,
          model: fields.model.trim(),
          dimensions: Number(fields.dimensions) || 1024,
          base_url: fields.base_url.trim(),
          key: fields.key,
          use_proxy: useProxy,
        }),
      })
      setState('ok')
      setMessage(t('settings.testSucceeded'))
      setDetail(result.message)
      onResult?.(true)
    } catch (err) {
      setState('failed')
      setMessage(errorMessage(err))
      setDetail(err instanceof Error ? err.message : '')
      onResult?.(false)
    }
  }
  return (
    <span className="model-test-control">
      <button className="secondary model-test-button" type="button" disabled={state === 'testing'} onClick={() => void run()}>
        {state === 'testing' ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}
        {t('settings.test')}
      </button>
      {state !== 'idle' ? (
        <span className={`model-test-message ${state === 'ok' ? 'ok' : state === 'failed' ? 'failed' : ''}`} role="status" aria-live="polite" title={detail || message}>
          {message}
        </span>
      ) : null}
    </span>
  )
}

export function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action ? <div className="button-row" style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  )
}

export type StateNoticeKind =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'partial'
  | 'waiting'
  | 'cancelled'
  | 'no_evidence'
  | 'no_permission'

const STATE_NOTICE_KEYS: Record<StateNoticeKind, TranslationKey> = {
  loading: 'stateNotice.loading',
  ready: 'stateNotice.success',
  empty: 'stateNotice.empty',
  error: 'stateNotice.failed',
  partial: 'stateNotice.partial',
  waiting: 'stateNotice.waitingApproval',
  cancelled: 'stateNotice.cancelled',
  no_evidence: 'stateNotice.noEvidence',
  no_permission: 'stateNotice.noPermission',
}

const STATE_NOTICE_ICONS: Record<StateNoticeKind, React.ReactNode> = {
  loading: <Loader2 size={18} className="spin" />,
  ready: <CheckCircle2 size={18} />,
  empty: <Inbox size={18} />,
  error: <AlertTriangle size={18} />,
  partial: <AlertTriangle size={18} />,
  waiting: <Clock3 size={18} />,
  cancelled: <Ban size={18} />,
  no_evidence: <FileQuestion size={18} />,
  no_permission: <LockKeyhole size={18} />,
}

export function StateNotice({
  kind = 'empty',
  title,
  message,
  code,
  source,
  scope,
  retry,
  retryLabel,
  retryable: retryableProp,
  nextStep,
}: {
  kind?: StateNoticeKind
  title?: string
  message?: string
  code?: string
  source?: string
  scope?: string
  retry?: () => void
  retryLabel?: string
  retryable?: boolean
  nextStep?: string
}) {
  const { t } = useTranslation()
  const role = kind === 'loading' ? 'status' : kind === 'ready' ? 'status' : 'alert'
  const retryable = retryableProp ?? Boolean(retry)
  return (
    <div className={`state-notice state-notice-${kind}`} role={role} aria-live="polite">
      <div className="state-notice-icon">{STATE_NOTICE_ICONS[kind]}</div>
      <div className="state-notice-copy">
        <strong>{title ?? t(STATE_NOTICE_KEYS[kind])}</strong>
        {message ? <p>{message}</p> : null}
        {(code || source || scope) ? (
          <dl className="state-notice-meta">
            {code ? <div><dt>{t('context.failureCode')}</dt><dd><code>{code}</code></dd></div> : null}
            {source ? <div><dt>{t('context.failureSource')}</dt><dd>{source}</dd></div> : null}
            {scope ? <div><dt>{t('context.failureScope')}</dt><dd><code>{scope}</code></dd></div> : null}
            <div><dt>{t('context.retryable')}</dt><dd>{retryable ? t('stateNotice.retryable.yes') : t('stateNotice.retryable.no')}</dd></div>
          </dl>
        ) : null}
        {nextStep ? <p className="state-notice-next">{t('context.nextStep')} {nextStep}</p> : null}
      </div>
      {retry ? (
        <button className="secondary state-notice-retry" type="button" onClick={retry}>
          <RotateCw size={14} />
          {retryLabel || t('context.retry')}
        </button>
      ) : null}
    </div>
  )
}

export function SectionHeading({ title, hint, extra }: { title: string; hint?: string; extra?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {hint ? <p className="muted">{hint}</p> : null}
      </div>
      {extra}
    </div>
  )
}

export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <div className="button-row">{children}</div>
}

export function Modal({
  eyebrow,
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  eyebrow: string
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panelRef} className={`modal-panel ${wide ? 'memory-graph-panel' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <button className="icon-btn" ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')}>
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="modal-panel confirm-panel" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
        </div>
        <p className="muted confirm-description">{description}</p>
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onCancel}>{cancelLabel || t('common.cancel')}</button>
          <button className="reject" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}
