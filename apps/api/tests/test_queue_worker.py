from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.queue_worker import TaskLease, dispatch, retry_delay_seconds, retry_state


def test_retry_backoff_is_bounded_and_deterministic():
    assert [retry_delay_seconds(attempt) for attempt in (1, 2, 3)] == [5, 10, 20]
    assert retry_delay_seconds(99) == 300
    now = datetime(2026, 7, 30, tzinfo=timezone.utc)
    retry = retry_state(2, 5, "temporary", now)
    assert retry["status"] == "retry_wait"
    assert retry["next_attempt_at"] == datetime(2026, 7, 30, 0, 0, 10, tzinfo=timezone.utc)
    assert retry_state(5, 5, "permanent", now)["status"] == "failed"


def test_dispatch_rejects_non_allowlisted_queue_kind():
    lease = TaskLease(uuid4(), uuid4(), "arbitrary_shell", {}, 1, 3, "token")
    with pytest.raises(ValueError, match="queue_task_kind_unsupported"):
        dispatch(lease)


def test_dispatch_sends_only_fixed_n8n_task_payload(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(url=url, kwargs=kwargs)
        return SimpleNamespace(raise_for_status=lambda: None)

    monkeypatch.setattr("app.queue_worker.httpx.post", fake_post)
    lease = TaskLease(
        uuid4(), uuid4(), "research_bootstrap", {"idempotency_key": "bootstrap:one", "command": "ignored"}, 1, 3, "token"
    )
    dispatch(lease)
    assert captured["url"].endswith("/research-os/start")
    assert captured["kwargs"]["json"] == {
        "project_id": str(lease.project_id),
        "task_id": str(lease.task_id),
        "idempotency_key": "bootstrap:one",
    }
