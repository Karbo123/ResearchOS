"""Durable PostgreSQL-backed worker for long-running orchestration tasks."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
from sqlalchemy import and_, or_, select

from .db import session_scope
from .models import AuditEvent, Project, Task


POLL_SECONDS = float(os.getenv("QUEUE_POLL_SECONDS", "2"))
LEASE_SECONDS = int(os.getenv("QUEUE_LEASE_SECONDS", "180"))
WORKFLOW_TIMEOUT_SECONDS = float(os.getenv("QUEUE_WORKFLOW_TIMEOUT_SECONDS", "90"))
RETRY_BASE_SECONDS = int(os.getenv("QUEUE_RETRY_BASE_SECONDS", "5"))
RETRY_MAX_SECONDS = int(os.getenv("QUEUE_RETRY_MAX_SECONDS", "300"))
N8N_RESEARCH_WEBHOOK_URL = os.getenv("N8N_RESEARCH_WEBHOOK_URL", "http://n8n:5678/webhook/research-os/start").strip()


@dataclass(frozen=True)
class TaskLease:
    task_id: UUID
    project_id: UUID
    kind: str
    payload: dict
    attempt: int
    max_attempts: int
    token: str


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def retry_delay_seconds(attempt: int) -> int:
    """Return a bounded deterministic delay after the given failed attempt."""
    exponent = max(0, int(attempt) - 1)
    return min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** min(exponent, 10)))


def retry_state(attempt: int, max_attempts: int, error: str, now: datetime | None = None) -> dict[str, object]:
    """Calculate persisted retry state without making a network or DB call."""
    current = now or utcnow()
    if attempt >= max(1, max_attempts):
        return {"status": "failed", "next_attempt_at": current, "error": error[:2000]}
    return {
        "status": "retry_wait",
        "next_attempt_at": current + timedelta(seconds=retry_delay_seconds(attempt)),
        "error": error[:2000],
    }


def _audit(session, project_id: UUID | None, action: str, details: dict[str, object]) -> None:
    session.add(AuditEvent(project_id=project_id, actor="queue-worker", action=action, details=details))


def claim_one() -> TaskLease | None:
    """Atomically claim the oldest ready task or an expired lease."""
    now = utcnow()
    ready = and_(Task.status.in_(["queued", "retry_wait"]), Task.next_attempt_at <= now)
    expired = and_(Task.status == "running", Task.leased_until.is_not(None), Task.leased_until <= now)
    with session_scope() as session:
        task = session.scalar(
            select(Task)
            .where(or_(ready, expired))
            .order_by(Task.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not task:
            return None
        was_expired = task.status == "running"
        token = uuid4().hex
        task.attempts = int(task.attempts or 0) + 1
        task.status = "running"
        task.leased_until = now + timedelta(seconds=LEASE_SECONDS)
        task.lease_token = token
        task.error = "queue lease reclaimed" if was_expired else None
        _audit(session, task.project_id, "queue.task_claimed", {
            "task_id": str(task.id),
            "kind": task.kind,
            "attempt": task.attempts,
            "lease_reclaimed": was_expired,
            "lease_seconds": LEASE_SECONDS,
        })
        return TaskLease(
            task_id=task.id,
            project_id=task.project_id,
            kind=task.kind,
            payload=dict(task.payload or {}),
            attempt=task.attempts,
            max_attempts=max(1, int(task.max_attempts or 1)),
            token=token,
        )


def _finish(lease: TaskLease, *, success: bool, error: str | None = None) -> None:
    now = utcnow()
    with session_scope() as session:
        task = session.scalar(
            select(Task).where(Task.id == lease.task_id, Task.lease_token == lease.token).with_for_update()
        )
        if not task:
            return
        project = session.get(Project, lease.project_id)
        if success and project and project.status == "active" and task.status != "cancelled":
            task.status = "succeeded"
            task.error = None
            _audit(session, project.id, "queue.task_succeeded", {"task_id": str(task.id), "attempt": lease.attempt})
        elif task.status == "cancelled" or not project or project.status != "active":
            task.status = "cancelled"
            task.error = f"project is {project.status if project else 'missing'}"
            _audit(session, lease.project_id, "queue.task_cancelled", {"task_id": str(task.id), "reason": task.error})
        else:
            decision = retry_state(lease.attempt, lease.max_attempts, error or "queue task failed", now)
            task.status = str(decision["status"])
            task.next_attempt_at = decision["next_attempt_at"]
            task.error = str(decision["error"])
            _audit(session, project.id, "queue.task_retry_scheduled" if task.status == "retry_wait" else "queue.task_failed", {
                "task_id": str(task.id),
                "attempt": lease.attempt,
                "max_attempts": lease.max_attempts,
                "next_attempt_at": task.next_attempt_at.isoformat() if task.next_attempt_at else None,
                "error": task.error,
            })
        task.leased_until = None
        task.lease_token = None


def dispatch(lease: TaskLease) -> None:
    if lease.kind != "research_bootstrap":
        raise ValueError(f"queue_task_kind_unsupported:{lease.kind}")
    if not N8N_RESEARCH_WEBHOOK_URL:
        raise ValueError("queue_n8n_webhook_not_configured")
    body = {
        "project_id": str(lease.project_id),
        "task_id": str(lease.task_id),
        "idempotency_key": str(lease.payload.get("idempotency_key") or lease.task_id),
    }
    try:
        response = httpx.post(N8N_RESEARCH_WEBHOOK_URL, json=body, timeout=WORKFLOW_TIMEOUT_SECONDS)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ValueError(f"queue_n8n_http_{exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise ValueError("queue_n8n_request_failed") from exc


def run_once() -> bool:
    lease = claim_one()
    if not lease:
        return False
    try:
        dispatch(lease)
    except Exception as exc:  # Persist every failure; the next poll decides retry/final state.
        _finish(lease, success=False, error=str(exc))
    else:
        _finish(lease, success=True)
    return True


def main() -> None:
    while True:
        try:
            claimed = run_once()
        except Exception:
            # A transient database outage must not terminate the durable worker.
            claimed = False
        if not claimed:
            time.sleep(max(0.1, POLL_SECONDS))


if __name__ == "__main__":
    main()
