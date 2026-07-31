import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export type BadgeKind = 'neutral' | 'live' | 'pending' | 'failed'

export function badgeKind(status?: string | null): BadgeKind {
  const value = String(status || '').toLowerCase()
  if (value === 'approved' || value === 'succeeded' || value === 'verified' || value === 'active' || value === 'enforced' || value === 'ready' || value === 'fulltext-evidence' || value === 'enabled') return 'live'
  if (value === 'failed' || value === 'rejected' || value === 'cancelled' || value === 'unsupported' || value === 'license-review-required') return 'failed'
  if (value === 'pending' || value === 'candidate-only' || value === 'metadata-only' || value === 'review-required' || value === 'manual' || value === 'evidence-required' || value === 'unknown') return 'pending'
  return 'neutral'
}

export function Badge({ status, children }: { status?: string | null; children?: React.ReactNode }) {
  return <span className={`badge ${badgeKind(status)}`}>{children ?? status}</span>
}

export function StatusDot({ ready }: { ready: boolean }) {
  return <span className={`status-dot ${ready ? 'ready' : ''}`} />
}

export function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action ? <div className="button-row" style={{ marginTop: 12 }}>{action}</div> : null}
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

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`modal-panel ${wide ? 'memory-graph-panel' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <button className="icon-btn" ref={closeRef} type="button" onClick={onClose} aria-label="关闭">
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
  cancelLabel = '取消',
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
  return (
    <div className="modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="modal-panel confirm-panel" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
        </div>
        <p className="muted confirm-description">{description}</p>
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onCancel}>{cancelLabel}</button>
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
