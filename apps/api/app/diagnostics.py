"""Deterministic numerical analysis and failure diagnostics for project runs."""

from __future__ import annotations

import json
import math
from statistics import fmean, pstdev
from typing import Any, Iterable


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _numeric_metrics(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, float] = {}
    for name, raw in value.items():
        if isinstance(name, str) and isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(float(raw)):
            result[name] = float(raw)
    return result


def _error_code(error: Any) -> str:
    if not error:
        return "unknown_failure"
    if isinstance(error, dict):
        return str(error.get("code") or "unknown_failure")
    try:
        parsed = json.loads(str(error))
    except (TypeError, ValueError):
        return "unstructured_failure"
    return str(parsed.get("code") or "unknown_failure") if isinstance(parsed, dict) else "unstructured_failure"


def build_diagnostic_report(experiments: Iterable[Any]) -> dict[str, Any]:
    """Calculate bounded statistics and reviewable deterministic suggestions.

    This function never calls a model and never decides that a run is scientifically
    successful. It only reports numeric observations and creates approval inputs.
    """
    rows = list(experiments)
    values_by_metric: dict[str, list[float]] = {}
    metric_runs: dict[str, list[str]] = {}
    failures: list[dict[str, Any]] = []
    missing_metrics: list[str] = []
    run_summaries: list[dict[str, Any]] = []

    for row in rows:
        run_id = str(_value(row, "id", ""))
        status = str(_value(row, "status", "unknown"))
        metrics = _numeric_metrics(_value(row, "metrics", {}))
        if status == "succeeded" and not metrics:
            missing_metrics.append(run_id)
        if status in {"failed", "cancelled"}:
            failures.append({
                "experiment_id": run_id,
                "status": status,
                "error_code": _error_code(_value(row, "error")),
            })
        for name, value in metrics.items():
            values_by_metric.setdefault(name, []).append(value)
            metric_runs.setdefault(name, []).append(run_id)
        run_summaries.append({
            "experiment_id": run_id,
            "status": status,
            "experiment_type": str(_value(row, "experiment_type", "unknown")),
            "metric_names": sorted(metrics),
        })

    metric_summary: dict[str, Any] = {}
    for name in sorted(values_by_metric):
        values = values_by_metric[name]
        mean = float(fmean(values))
        std = float(pstdev(values)) if len(values) > 1 else 0.0
        metric_summary[name] = {
            "count": len(values),
            "mean": mean,
            "std": std,
            "min": min(values),
            "max": max(values),
            "experiment_ids": sorted(metric_runs[name]),
        }

    suggestions: list[dict[str, Any]] = []
    if failures:
        suggestions.append({
            "code": "review_failed_runs",
            "title": "Review failed or cancelled runs",
            "reason": "Terminal runs contain failures or cancellations; inspect their structured error codes before proposing another run.",
            "evidence_experiment_ids": [item["experiment_id"] for item in failures],
            "approval_required": True,
        })
    if missing_metrics:
        suggestions.append({
            "code": "missing_metrics",
            "title": "Add an explicit metrics output contract",
            "reason": "A succeeded run did not publish numeric metrics.json values, so its result cannot be compared safely.",
            "evidence_experiment_ids": missing_metrics,
            "approval_required": True,
        })
    for name, summary in metric_summary.items():
        if summary["count"] >= 2 and summary["mean"] != 0 and summary["std"] / abs(summary["mean"]) >= 0.25:
            suggestions.append({
                "code": "high_metric_dispersion",
                "title": f"Review seed dispersion for {name}",
                "reason": "The population standard deviation is at least 25% of the absolute mean; inspect seeds and data splits before interpreting the metric.",
                "metric": name,
                "evidence_experiment_ids": summary["experiment_ids"],
                "approval_required": True,
            })

    return {
        "schema_version": "1.0",
        "run_count": len(rows),
        "succeeded_count": sum(str(_value(row, "status", "")) == "succeeded" for row in rows),
        "failed_count": len(failures),
        "metrics": metric_summary,
        "failures": failures,
        "missing_metrics_experiment_ids": sorted(missing_metrics),
        "runs": run_summaries,
        "suggestions": suggestions,
        "llm_role": "explain_and_challenge_only",
        "execution_required": False,
    }
