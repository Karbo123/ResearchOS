from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from app.reporting import ReportNotificationError, build_report_content, send_report_webhook


def test_report_contains_operational_sections_and_redacts_sensitive_audit_values():
    now = datetime(2026, 7, 30, tzinfo=timezone.utc)
    project = SimpleNamespace(title="Topic project", current_stage="results_review", current_idea_version=2)
    content = build_report_content(
        project=project,
        period="daily",
        papers=[SimpleNamespace(title="New paper", doi="10.1/demo", source_url="https://example.test/paper", verified=True, created_at=now)],
        evidence=[SimpleNamespace(quote="A page quote", locator="p. 2")],
        repositories=[SimpleNamespace(verified_official=True)],
        experiments=[SimpleNamespace(experiment_type="topic_specific", status="succeeded", metrics={"cost_usd": 1.25, "accuracy": 0.9}, created_at=now)],
        artifacts=[SimpleNamespace(kind="metrics", name="metrics.json", experiment_id="run-1", sha256="abc", created_at=now)],
        proposals=[SimpleNamespace(status="pending", kind="experiment_plan", summary="Review plan", estimated_cost_usd=2)],
        audit_events=[SimpleNamespace(action="model.requested", actor="system", details={"api_key": "do-not-print"}, created_at=now)],
        now=now,
    )
    assert "## Literature and code" in content
    assert "## Experiments and resources" in content
    assert "## Agent decisions and approvals" in content
    assert "cost_usd" in content
    assert "do-not-print" not in content
    assert "[redacted]" in content


def test_report_period_excludes_old_records_from_period_lists():
    now = datetime(2026, 7, 30, tzinfo=timezone.utc)
    old = now - timedelta(days=2)
    content = build_report_content(
        project=SimpleNamespace(title="Topic", current_stage="initialized", current_idea_version=1),
        period="daily",
        papers=[SimpleNamespace(title="Old paper", source_url="https://example.test/old", created_at=old)],
        evidence=[], repositories=[], experiments=[], artifacts=[], proposals=[], audit_events=[], now=now,
    )
    assert "Old paper" not in content
    assert "Records in period: 0" in content


def test_webhook_is_disabled_without_an_alternate_transport(monkeypatch):
    monkeypatch.setenv("REPORT_NOTIFICATIONS_ENABLED", "false")
    with pytest.raises(ReportNotificationError) as error:
        send_report_webhook(report_id="r", project_id="p", period="daily", content="report")
    assert error.value.code == "report_notifications_disabled"


def test_webhook_rejects_non_https_url(monkeypatch):
    monkeypatch.setenv("REPORT_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("REPORT_WEBHOOK_URL", "http://example.test/hook")
    with pytest.raises(ReportNotificationError) as error:
        send_report_webhook(report_id="r", project_id="p", period="daily", content="report")
    assert error.value.code == "report_webhook_url_invalid"


def test_webhook_transport_failure_is_structured_and_not_retried(monkeypatch):
    calls = []

    class FailingClient:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def post(self, *args, **kwargs):
            calls.append((args, kwargs))
            raise httpx.ConnectError("offline")

    monkeypatch.setenv("REPORT_NOTIFICATIONS_ENABLED", "true")
    monkeypatch.setenv("REPORT_WEBHOOK_URL", "https://example.test/hook")
    monkeypatch.setattr("app.reporting.httpx.Client", lambda **kwargs: FailingClient())
    with pytest.raises(ReportNotificationError) as error:
        send_report_webhook(report_id="r", project_id="p", period="daily", content="report")
    assert error.value.code == "report_webhook_failed"
    assert len(calls) == 1
