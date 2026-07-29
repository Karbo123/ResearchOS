"""Restricted Docker launcher for one fixed Research OS job container per run."""

from __future__ import annotations

import json
import os
from typing import Any, Literal
from uuid import UUID

import docker
from docker.errors import APIError, NotFound
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator


SHARED_SECRET = os.getenv("RUNNER_SHARED_SECRET", "runner-dev-secret")
JOB_IMAGE = os.getenv("RUNNER_JOB_IMAGE", "research-os-runner")
RUNNER_CONTAINER_NAME = os.getenv("RUNNER_CONTAINER_NAME", "research-os-runner")
RUNNER_NETWORK = os.getenv("RUNNER_NETWORK", "research-os-runner-internal")
JOB_ARTIFACTS_ROOT = "/workspace/artifacts"
JOB_PROJECTS_ROOT = "/workspace/projects"
FORBIDDEN_FIELDS = {"command", "cmd", "shell", "cwd", "path", "url", "network", "image", "environment"}
ALLOWED_TYPES = {"demo_classification", "point_cloud_demo", "compile_latex"}
TEMPLATE_LIMITS = {
    "demo_classification": {"cpu": 1.0, "memory": 768 * 1024 * 1024, "pids": 64, "disk_mb": 512, "seconds": 600},
    "point_cloud_demo": {"cpu": 1.0, "memory": 768 * 1024 * 1024, "pids": 64, "disk_mb": 512, "seconds": 600},
    "compile_latex": {"cpu": 1.5, "memory": 1024 * 1024 * 1024, "pids": 96, "disk_mb": 1024, "seconds": 600},
}


class LaunchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    project_id: UUID
    experiment_type: Literal["demo_classification", "point_cloud_demo", "compile_latex"]
    config: dict[str, Any] = Field(default_factory=dict)
    random_seeds: list[StrictInt] = Field(min_length=1, max_length=10)
    policy_constraints: dict[str, Any] = Field(default_factory=dict)
    reproducibility: dict[str, Any]

    @field_validator("config")
    @classmethod
    def reject_untrusted_fields(cls, value: dict[str, Any]) -> dict[str, Any]:
        forbidden = FORBIDDEN_FIELDS.intersection(value)
        if forbidden:
            raise ValueError(f"forbidden launcher fields: {sorted(forbidden)}")
        return value

    @model_validator(mode="after")
    def validate_job_contract(self):
        if self.experiment_type not in ALLOWED_TYPES:
            raise ValueError("experiment type is not allowlisted")
        if not all(isinstance(seed, int) and not isinstance(seed, bool) for seed in self.random_seeds):
            raise ValueError("random seeds must be integers")
        return self


app = FastAPI(title="Research OS Restricted Runner Launcher", version="0.1.0")
client = docker.from_env()


def authenticate(secret: str | None) -> None:
    if secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="invalid runner secret")


def job_name(run_id: UUID) -> str:
    return f"research-os-run-{run_id}"


def find_job(run_id: UUID):
    try:
        return client.containers.get(job_name(run_id))
    except NotFound:
        return None


def container_status(container) -> dict[str, Any]:
    container.reload()
    state = container.attrs.get("State") or {}
    return {
        "run_id": container.labels.get("research_os.run_id"),
        "container_id": container.id,
        "container_name": container.name,
        "status": state.get("Status", "unknown"),
        "exit_code": state.get("ExitCode"),
        "started_at": state.get("StartedAt"),
        "finished_at": state.get("FinishedAt"),
    }


@app.get("/health")
def health():
    try:
        client.ping()
        docker_available = True
    except Exception:
        docker_available = False
    return {
        "status": "ok" if docker_available else "degraded",
        "docker_available": docker_available,
        "job_image": JOB_IMAGE,
        "fixed_network": RUNNER_NETWORK,
        "volumes_from": RUNNER_CONTAINER_NAME,
        "arbitrary_commands": False,
        "arbitrary_images": False,
        "task_templates": TEMPLATE_LIMITS,
    }


@app.post("/v1/jobs", status_code=202)
def launch(request: LaunchRequest, x_runner_secret: str | None = Header(default=None)):
    authenticate(x_runner_secret)
    existing = find_job(request.run_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="run already exists")
    limits = TEMPLATE_LIMITS[request.experiment_type]
    payload = request.model_dump(mode="json")
    environment = {
        "RESEARCH_OS_RUN_REQUEST": json.dumps(payload, ensure_ascii=False),
        "PROJECTS_ROOT": JOB_PROJECTS_ROOT,
        "ARTIFACTS_ROOT": JOB_ARTIFACTS_ROOT,
        "MLFLOW_TRACKING_URI": os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000"),
        "RUNNER_IMAGE_DIGEST": os.getenv("RUNNER_IMAGE_DIGEST", "unavailable"),
        "RESEARCH_OS_COMMIT": os.getenv("RESEARCH_OS_COMMIT", "unavailable"),
        "MPLCONFIGDIR": "/tmp/matplotlib",
        "XDG_CACHE_HOME": "/tmp/cache",
    }
    try:
        container = client.containers.run(
            image=JOB_IMAGE,
            name=job_name(request.run_id),
            command=["python", "-m", "app.worker"],
            environment=environment,
            volumes_from=[RUNNER_CONTAINER_NAME],
            network=RUNNER_NETWORK,
            user="10002",
            detach=True,
            read_only=True,
            tmpfs={"/tmp": "rw,size=536870912,mode=1777"},
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            nano_cpus=int(limits["cpu"] * 1_000_000_000),
            mem_limit=limits["memory"],
            pids_limit=limits["pids"],
            labels={
                "research_os.managed": "true",
                "research_os.run_id": str(request.run_id),
                "research_os.task_template": request.experiment_type,
            },
        )
    except (APIError, OSError) as exc:
        raise HTTPException(status_code=503, detail={
            "code": "job_container_launch_failed",
            "message": "The fixed per-run job container could not be launched.",
        }) from exc
    return {**container_status(container), "resource_limits": limits, "isolation_mode": "one-container-per-run"}


@app.get("/v1/jobs/{run_id}")
def status(run_id: UUID, x_runner_secret: str | None = Header(default=None)):
    authenticate(x_runner_secret)
    container = find_job(run_id)
    if container is None:
        raise HTTPException(status_code=404, detail="job container not found")
    return container_status(container)


@app.post("/v1/jobs/{run_id}/cancel")
def cancel(run_id: UUID, x_runner_secret: str | None = Header(default=None)):
    authenticate(x_runner_secret)
    container = find_job(run_id)
    if container is None:
        raise HTTPException(status_code=404, detail="job container not found")
    current = container_status(container)
    if current["status"] not in {"created", "running", "restarting"}:
        raise HTTPException(status_code=409, detail="job container is already terminal")
    try:
        container.stop(timeout=5)
    except (APIError, OSError) as exc:
        raise HTTPException(status_code=503, detail={
            "code": "job_container_cancel_failed",
            "message": "The fixed per-run job container could not be cancelled.",
        }) from exc
    return {**container_status(container), "status": "cancelled"}
