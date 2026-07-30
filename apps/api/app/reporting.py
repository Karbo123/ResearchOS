"""Deterministic project reports and an opt-in external webhook adapter."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import math
import os
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx


class ReportNotificationError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _in_window(item: Any, cutoff: datetime | None) -> bool:
    if cutoff is None:
        return True
    created = _value(item, "created_at")
    if not isinstance(created, datetime):
        return True
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created >= cutoff


def _safe_detail(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if any(marker in lowered for marker in ("secret", "token", "password", "cookie", "authorization", "api_key", "key")):
                result[str(key)] = "[redacted]"
            else:
                result[str(key)] = _safe_detail(item)
        return result
    if isinstance(value, list):
        return [_safe_detail(item) for item in value[:20]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _reported_metrics(experiments: Iterable[Any]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for experiment in experiments:
        metrics = _value(experiment, "metrics", {}) or {}
        if not isinstance(metrics, dict):
            continue
        for key, value in metrics.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
                continue
            lowered = str(key).lower()
            if lowered.endswith(("_usd", "_hours", "_seconds", "_bytes")) or lowered in {"cost_usd", "gpu_hours", "cpu_seconds"}:
                totals[str(key)] = totals.get(str(key), 0.0) + float(value)
    return {key: round(value, 6) for key, value in sorted(totals.items())}


def build_report_content(
    *,
    project: Any,
    period: str,
    papers: Iterable[Any],
    evidence: Iterable[Any],
    repositories: Iterable[Any],
    experiments: Iterable[Any],
    artifacts: Iterable[Any],
    proposals: Iterable[Any],
    audit_events: Iterable[Any],
    now: datetime | None = None,
) -> str:
    """Create a bounded report from persisted rows; no model or scientific inference is used."""
    now = now or datetime.now(timezone.utc)
    days = {"daily": 1, "weekly": 7}.get(period)
    cutoff = now - timedelta(days=days) if days else None
    papers = list(papers)
    evidence = list(evidence)
    repositories = list(repositories)
    experiments = list(experiments)
    artifacts = list(artifacts)
    proposals = list(proposals)
    audit_events = list(audit_events)
    recent_papers = [item for item in papers if _in_window(item, cutoff)]
    recent_experiments = [item for item in experiments if _in_window(item, cutoff)]
    recent_artifacts = [item for item in artifacts if _in_window(item, cutoff)]
    recent_audits = [item for item in audit_events if _in_window(item, cutoff)]
    status_counts = {status: sum(1 for item in experiments if _value(item, "status") == status) for status in ("queued", "running", "succeeded", "failed", "cancelled")}
    verified_evidence = [item for item in evidence if str(_value(item, "quote", "")).strip() and _value(item, "locator")]
    reported_metrics = _reported_metrics(experiments)
    title = str(_value(project, "title", "Research project"))
    stage = str(_value(project, "current_stage", "unknown"))
    idea_version = _value(project, "current_idea_version", "unknown")
    lines = [
        f"# {title} - {period.title()} report",
        f"Generated: {now.isoformat()}",
        f"Current stage: **{stage}** · Idea: **v{idea_version}**",
        "",
        "## Literature and code",
        f"Records in period: {len(recent_papers)}; verified records: {sum(1 for item in recent_papers if _value(item, 'verified'))}; page/section evidence: {len(verified_evidence)} total.",
    ]
    for paper in recent_papers[:10]:
        lines.append(f"- {_value(paper, 'title', 'untitled')} | DOI: {_value(paper, 'doi') or 'not available'} | {_value(paper, 'source_url', '')}")
    lines.extend([
        f"Code candidates: {len(repositories)} total; officially verified: {sum(1 for item in repositories if _value(item, 'verified_official'))}.",
        "",
        "## Experiments and resources",
        f"All runs: {len(experiments)}; in period: {len(recent_experiments)}; statuses: {json.dumps(status_counts, ensure_ascii=False, sort_keys=True)}.",
        f"Reported numeric resource/cost totals only (missing provider data is not inferred): {json.dumps(reported_metrics, ensure_ascii=False, sort_keys=True) or 'none'}.",
    ])
    for experiment in recent_experiments[-10:]:
        lines.append(f"- {_value(experiment, 'experiment_type', 'unknown')}: {_value(experiment, 'status', 'unknown')} | metrics={json.dumps(_safe_detail(_value(experiment, 'metrics', {})), ensure_ascii=False, sort_keys=True)}")
    lines.extend([
        "",
        "## Artifacts",
        f"Valid artifacts: {len(artifacts)}; created in period: {len(recent_artifacts)}. Downloads and previews retain the stored lineage metadata.",
    ])
    for artifact in recent_artifacts[:12]:
        lines.append(f"- {_value(artifact, 'kind', 'artifact')}: {_value(artifact, 'name', 'unnamed')} | experiment={_value(artifact, 'experiment_id') or 'none'} | sha256={_value(artifact, 'sha256', '')}")
    lines.extend([
        "",
        "## Agent decisions and approvals",
        f"Pending approvals: {sum(1 for item in proposals if _value(item, 'status') == 'pending')}; recent audit decisions/events: {len(recent_audits)}.",
    ])
    for event in recent_audits[-12:]:
        lines.append(f"- {_value(event, 'action', 'event')} by {_value(event, 'actor', 'unknown')}: {json.dumps(_safe_detail(_value(event, 'details', {})), ensure_ascii=False, sort_keys=True)}")
    for proposal in proposals:
        if _value(proposal, "status") == "pending":
            lines.append(f"- Approval required: {_value(proposal, 'kind', 'proposal')} | {_value(proposal, 'summary', '')} | estimated ${float(_value(proposal, 'estimated_cost_usd', 0) or 0):.2f}")
    lines.extend([
        "",
        "## Limits",
        "This report is a deterministic operational summary. Metadata candidates are not full-text evidence, and reported metrics/costs are not scientific conclusions.",
    ])
    return "\n".join(lines)


def send_report_webhook(*, report_id: str, project_id: str, period: str, content: str) -> dict[str, Any]:
    """Send one explicitly requested report through the configured HTTPS webhook."""
    enabled = os.getenv("REPORT_NOTIFICATIONS_ENABLED", "false").strip().lower() == "true"
    url = os.getenv("REPORT_WEBHOOK_URL", "").strip()
    if not enabled:
        raise ReportNotificationError("report_notifications_disabled", "External report notifications are disabled.")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ReportNotificationError("report_webhook_url_invalid", "REPORT_WEBHOOK_URL must be an HTTPS URL without embedded credentials.")
    headers = {"Content-Type": "application/json", "User-Agent": "ResearchOS-report/1.0"}
    secret = os.getenv("REPORT_WEBHOOK_SECRET", "")
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    payload = {"report_id": report_id, "project_id": project_id, "period": period, "content": content}
    try:
        with httpx.Client(timeout=float(os.getenv("REPORT_WEBHOOK_TIMEOUT_SECONDS", "15"))) as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
    except (httpx.HTTPError, ValueError) as exc:
        raise ReportNotificationError("report_webhook_failed", "External report notification failed; no alternate channel was attempted.") from exc
    return {"status": "sent", "transport": "https_webhook", "http_status": response.status_code}
