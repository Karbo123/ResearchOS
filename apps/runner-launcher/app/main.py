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
ALLOWED_TYPES = {"topic_specific", "demo_classification", "point_cloud_demo", "compile_latex"}
ALLOWED_TYPES.update({"python_analysis", "cpp_cmake", "gpu_python", "conda_python"})
TEMPLATE_LIMITS = {
    "topic_specific": {"cpu": 2.0, "memory": 4096 * 1024 * 1024, "pids": 128, "disk_mb": 2048, "seconds": 1800, "gpu": False},
    "demo_classification": {"cpu": 1.0, "memory": 768 * 1024 * 1024, "pids": 64, "disk_mb": 512, "seconds": 600},
    "point_cloud_demo": {"cpu": 1.0, "memory": 768 * 1024 * 1024, "pids": 64, "disk_mb": 512, "seconds": 600},
    "compile_latex": {"cpu": 1.5, "memory": 1024 * 1024 * 1024, "pids": 96, "disk_mb": 1024, "seconds": 600},
    "python_analysis": {"cpu": 1.5, "memory": 1024 * 1024 * 1024, "pids": 96, "disk_mb": 1024, "seconds": 600, "gpu": False},
    "cpp_cmake": {"cpu": 2.0, "memory": 1024 * 1024 * 1024, "pids": 128, "disk_mb": 1024, "seconds": 600, "gpu": False},
    "gpu_python": {"cpu": 2.0, "memory": 4096 * 1024 * 1024, "pids": 128, "disk_mb": 2048, "seconds": 600, "gpu": True},
    "conda_python": {"cpu": 1.5, "memory": 1024 * 1024 * 1024, "pids": 96, "disk_mb": 1024, "seconds": 600, "gpu": False},
}

SYNC_CODE = (
    "import os,shutil; "
    "project=os.environ['SYNC_PROJECT_ID']; run=os.environ['SYNC_RUN_ID']; "
    "source=os.path.join('/run-output',project,run); "
    "destination=os.path.join('/workspace/artifacts',project,run); "
    "os.makedirs(destination,exist_ok=True); "
    "shutil.copytree(source,destination,dirs_exist_ok=True)"
)
SYNC_RESULTS: dict[str, dict[str, Any]] = {}


class LaunchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    project_id: UUID
    experiment_type: Literal["topic_specific", "demo_classification", "point_cloud_demo", "compile_latex", "python_analysis", "cpp_cmake", "gpu_python", "conda_python"]
    config: dict[str, Any] = Field(default_factory=dict)
    random_seeds: list[StrictInt] = Field(min_length=1, max_length=10)
    policy_constraints: dict[str, Any] = Field(default_factory=dict)
    reproducibility: dict[str, Any]
    topic_plan: dict[str, Any] | None = None
    topic_resume: dict[str, Any] | None = None

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
        if self.experiment_type == "topic_specific" and not isinstance(self.topic_plan, dict):
            raise ValueError("topic_specific jobs require a structured topic plan")
        if self.experiment_type != "topic_specific" and (self.topic_plan is not None or self.topic_resume is not None):
            raise ValueError("topic plan fields are only valid for topic_specific jobs")
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
    result = {
        "run_id": container.labels.get("research_os.run_id"),
        "container_id": container.id,
        "container_name": container.name,
        "status": state.get("Status", "unknown"),
        "exit_code": state.get("ExitCode"),
        "started_at": state.get("StartedAt"),
        "finished_at": state.get("FinishedAt"),
    }
    if result["status"] in {"exited", "dead"}:
        result.update(sync_output_volume(container))
    return result


def output_volume_name(run_id: UUID) -> str:
    return f"research-os-run-output-{run_id}"


def sync_output_volume(container) -> dict[str, Any]:
    run_id = container.labels.get("research_os.run_id")
    project_id = container.labels.get("research_os.project_id")
    if not run_id or not project_id:
        return {"artifacts_synced": False, "artifact_sync_error": "managed job labels are incomplete"}
    if run_id in SYNC_RESULTS:
        return SYNC_RESULTS[run_id]
    volume_name = container.labels.get("research_os.output_volume") or output_volume_name(UUID(run_id))
    result = {"artifacts_synced": False}
    helper = None
    try:
        volume = client.volumes.get(volume_name)
        helper = client.containers.run(
            image=JOB_IMAGE,
            name=f"research-os-sync-{run_id}",
            command=["python", "-c", SYNC_CODE],
            environment={"SYNC_PROJECT_ID": project_id, "SYNC_RUN_ID": run_id},
            volumes_from=[RUNNER_CONTAINER_NAME],
            volumes={volume_name: {"bind": "/run-output", "mode": "ro"}},
            network=RUNNER_NETWORK,
            user="10002",
            detach=True,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            pids_limit=32,
            mem_limit=256 * 1024 * 1024,
        )
        wait_result = helper.wait(timeout=30)
        exit_code = wait_result.get("StatusCode", 1) if isinstance(wait_result, dict) else int(wait_result)
        if exit_code != 0:
            raise RuntimeError(f"artifact sync helper exited with code {exit_code}")
        result = {"artifacts_synced": True, "output_volume": volume_name}
    except (APIError, NotFound, OSError, RuntimeError, ValueError) as exc:
        result = {"artifacts_synced": False, "artifact_sync_error": str(exc)[:500], "output_volume": volume_name}
    finally:
        if helper is not None:
            try:
                helper.remove(force=True)
            except (APIError, OSError):
                pass
        try:
            container.remove(force=True)
        except (APIError, NotFound, OSError):
            pass
        try:
            client.volumes.get(volume_name).remove(force=True)
        except (APIError, NotFound, OSError):
            pass
    SYNC_RESULTS[run_id] = result
    return result


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
        "RUNNER_STATE_ROOT": f"{JOB_ARTIFACTS_ROOT}/.runner-state",
        "MLFLOW_TRACKING_URI": os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000"),
        "RUNNER_IMAGE_DIGEST": os.getenv("RUNNER_IMAGE_DIGEST", "unavailable"),
        "RESEARCH_OS_COMMIT": os.getenv("RESEARCH_OS_COMMIT", "unavailable"),
        "MPLCONFIGDIR": "/tmp/matplotlib",
        "XDG_CACHE_HOME": "/tmp/cache",
    }
    volume_name = output_volume_name(request.run_id)
    output_target = f"{JOB_ARTIFACTS_ROOT}/{request.project_id}/{request.run_id}"
    try:
        client.volumes.create(
            name=volume_name,
            driver="local",
            driver_opts={"type": "tmpfs", "device": "tmpfs", "o": f"size={limits['disk_mb']}m,mode=1770"},
            labels={"research_os.managed": "true", "research_os.run_id": str(request.run_id)},
        )
    except APIError as exc:
        raise HTTPException(status_code=503, detail={
            "code": "run_volume_create_failed",
            "message": "The fixed per-run Docker output volume could not be created.",
        }) from exc
    try:
        container = client.containers.run(
            image=JOB_IMAGE,
            name=job_name(request.run_id),
            command=["python", "-m", "app.worker"],
            environment=environment,
            volumes_from=[RUNNER_CONTAINER_NAME],
            volumes={volume_name: {"bind": output_target, "mode": "rw"}},
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
            device_requests=[docker.types.DeviceRequest(count=1, capabilities=[["gpu"]])] if limits.get("gpu") else None,
            labels={
                "research_os.managed": "true",
                "research_os.run_id": str(request.run_id),
                "research_os.task_template": request.experiment_type,
                "research_os.project_id": str(request.project_id),
                "research_os.output_volume": volume_name,
            },
        )
    except (APIError, OSError) as exc:
        try:
            client.volumes.get(volume_name).remove(force=True)
        except (APIError, NotFound, OSError):
            pass
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
        if str(run_id) in SYNC_RESULTS:
            return {"run_id": str(run_id), "status": "exited", **SYNC_RESULTS[str(run_id)]}
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
