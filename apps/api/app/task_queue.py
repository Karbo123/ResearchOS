"""Allowlisted, durable task enqueueing with database-backed idempotency."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .models import Task


QUEUE_TASK_KINDS = frozenset({"research_bootstrap"})


def enqueue_task(
    session,
    *,
    project_id: UUID,
    kind: str,
    payload: dict[str, Any],
    idempotency_key: str,
    max_attempts: int = 5,
) -> tuple[Task, bool]:
    """Create one allowlisted task, or return the task already owning the key.

    The savepoint makes a concurrent unique-index conflict recoverable without
    rolling back the surrounding project transaction.
    """
    if kind not in QUEUE_TASK_KINDS:
        raise ValueError(f"queue_task_kind_unsupported:{kind}")
    normalized_key = idempotency_key.strip()
    if not normalized_key or len(normalized_key) > 255:
        raise ValueError("queue_idempotency_key_invalid")
    if not 1 <= max_attempts <= 100:
        raise ValueError("queue_max_attempts_invalid")

    existing = session.scalar(select(Task).where(Task.idempotency_key == normalized_key))
    if existing:
        return existing, False

    task = Task(
        project_id=project_id,
        kind=kind,
        payload=dict(payload),
        idempotency_key=normalized_key,
        max_attempts=max_attempts,
    )
    try:
        with session.begin_nested():
            session.add(task)
            session.flush()
    except IntegrityError:
        existing = session.scalar(select(Task).where(Task.idempotency_key == normalized_key))
        if existing:
            return existing, False
        raise
    return task, True
