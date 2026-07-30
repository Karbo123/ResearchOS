from types import SimpleNamespace
from uuid import uuid4

from app.diagnostics import build_diagnostic_report


def test_diagnostics_calculates_numeric_mean_and_population_std_without_llm():
    first, second = uuid4(), uuid4()
    report = build_diagnostic_report([
        SimpleNamespace(id=first, status="succeeded", experiment_type="python_analysis", metrics={"accuracy": 0.8}, error=None),
        SimpleNamespace(id=second, status="succeeded", experiment_type="python_analysis", metrics={"accuracy": 0.6}, error=None),
    ])
    summary = report["metrics"]["accuracy"]
    assert summary["count"] == 2
    assert summary["mean"] == 0.7
    assert round(summary["std"], 6) == 0.1
    assert report["llm_role"] == "explain_and_challenge_only"
    assert report["execution_required"] is False


def test_diagnostics_reports_structured_failures_missing_metrics_and_review_suggestions():
    failed = uuid4()
    missing = uuid4()
    report = build_diagnostic_report([
        SimpleNamespace(id=failed, status="failed", experiment_type="conda_python", metrics={}, error='{"code":"job_timeout"}'),
        SimpleNamespace(id=missing, status="succeeded", experiment_type="python_analysis", metrics={}, error=None),
    ])
    assert report["failures"] == [{"experiment_id": str(failed), "status": "failed", "error_code": "job_timeout"}]
    assert report["missing_metrics_experiment_ids"] == [str(missing)]
    assert {item["code"] for item in report["suggestions"]} == {"review_failed_runs", "missing_metrics"}


def test_diagnostics_ignores_non_numeric_and_non_finite_values():
    report = build_diagnostic_report([
        SimpleNamespace(id=uuid4(), status="succeeded", experiment_type="python_analysis", metrics={"accuracy": 0.9, "label": "bad", "nan": float("nan")}, error=None),
    ])
    assert set(report["metrics"]) == {"accuracy"}
