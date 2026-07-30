"""Container entrypoint for exactly one allowlisted Runner job."""

from __future__ import annotations

import json
import os
import threading
import traceback

from .job_isolation import apply_job_limits, job_environment
from .job_templates import validate_template_config
from .main import CANCEL_EVENTS, MAX_SECONDS, RUNS, SubmitRequest, execute, persist_state, update_state, utcnow


def main() -> None:
    raw = os.environ.get("RESEARCH_OS_RUN_REQUEST")
    if not raw:
        raise SystemExit("RESEARCH_OS_RUN_REQUEST is required")
    request = SubmitRequest.model_validate(json.loads(raw))
    key = str(request.run_id)
    RUNS[key] = {
        "run_id": key, "status": "queued", "metrics": {}, "artifacts": [],
        "mlflow_run_id": None, "error": None, "started_at": None, "finished_at": None,
        "reproducibility": request.reproducibility.model_dump(mode="json"),
    }
    CANCEL_EVENTS[key] = threading.Event()
    persist_state(key)
    try:
        template = validate_template_config(request.experiment_type, request.config)
        for secret_name in (
            "POSTGRES_PASSWORD", "MINIO_SECRET_KEY", "N8N_ENCRYPTION_KEY",
            "N8N_LOCAL_OWNER_PASSWORD", "RUNNER_SHARED_SECRET",
            "RESEARCH_MODEL_KEY_SIMPLE", "RESEARCH_MODEL_KEY_MEDIUM", "RESEARCH_MODEL_KEY_COMPLEX",
        ):
            os.environ.pop(secret_name, None)
        os.environ.update(job_environment(template))
        update_state(key, task_template=template.task_id, resource_limits=apply_job_limits(template, MAX_SECONDS))
        execute(request)
    except Exception as exc:
        update_state(key, status="failed", finished_at=utcnow(), error=f"job bootstrap failed: {exc}\n{traceback.format_exc(limit=3)}")


if __name__ == "__main__":
    main()
