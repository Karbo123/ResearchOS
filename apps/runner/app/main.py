from __future__ import annotations

import hashlib
import errno
import json
import os
import subprocess
import threading
import time
import traceback
import platform
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import httpx
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mlflow
import numpy as np
import psutil
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import ConfusionMatrixDisplay, accuracy_score
from sklearn.model_selection import train_test_split

from reproducibility import ReproducibilityError, ReproducibilityContract, runtime_identity, validate_snapshot_contract
from .job_templates import TASK_TEMPLATES, validate_template_config


class PolicyConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minimum_random_seed_count: int = Field(default=1, ge=1, le=10)
    explicit_approval_required: bool = False
    approval_granted: bool = False


class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: UUID
    project_id: UUID
    experiment_type: str
    config: dict = Field(default_factory=dict)
    random_seeds: list[StrictInt] = Field(min_length=1, max_length=10)
    policy_constraints: PolicyConstraints = Field(default_factory=PolicyConstraints)
    reproducibility: ReproducibilityContract

    @field_validator("experiment_type")
    @classmethod
    def allowed_type(cls, value: str) -> str:
        if value not in TASK_TEMPLATES:
            raise ValueError("experiment type is not allowlisted")
        return value

    @field_validator("config")
    @classmethod
    def safe_config(cls, value: dict) -> dict:
        if {"command", "cmd", "shell", "cwd", "path", "url", "network", "image"}.intersection(value):
            raise ValueError("command, path, network, URL and image fields are forbidden")
        return value

    @model_validator(mode="after")
    def allowlisted_config(self):
        validate_template_config(self.experiment_type, self.config)
        if self.experiment_type in {"demo_classification", "point_cloud_demo", "python_analysis", "cpp_cmake", "gpu_python"}:
            if len(set(self.random_seeds)) < self.policy_constraints.minimum_random_seed_count:
                raise ValueError("random_seeds violate the submitted minimum seed-count policy")
        if self.policy_constraints.explicit_approval_required and not self.policy_constraints.approval_granted:
            raise ValueError("explicit approval is required by the submitted project policy")
        return self


app = FastAPI(title="Research OS Restricted Runner", version="0.1.0")
ARTIFACTS_ROOT = Path(os.getenv("ARTIFACTS_ROOT", "/workspace/artifacts")).resolve()
STATE_ROOT = Path(os.getenv("RUNNER_STATE_ROOT", str(ARTIFACTS_ROOT / ".runner-state"))).resolve()
SHARED_SECRET = os.getenv("RUNNER_SHARED_SECRET", "runner-dev-secret")
MAX_SECONDS = int(os.getenv("RUNNER_MAX_SECONDS", "600"))
EXECUTOR_URL = os.getenv("RUNNER_EXECUTOR_URL", "http://runner-launcher:8020")
EXECUTOR_TIMEOUT_SECONDS = float(os.getenv("RUNNER_EXECUTOR_TIMEOUT_SECONDS", "15"))
RUNS: dict[str, dict] = {}
CANCEL_EVENTS: dict[str, threading.Event] = {}
LOCK = threading.Lock()


class RunCancelled(Exception):
    pass


class DiskQuotaExceeded(Exception):
    def __init__(self, limit_bytes: int, actual_bytes: int):
        self.limit_bytes = limit_bytes
        self.actual_bytes = actual_bytes
        super().__init__(f"run disk quota exceeded: {actual_bytes} > {limit_bytes} bytes")

    def as_dict(self) -> dict[str, object]:
        return {
            "code": "run_disk_quota_exceeded",
            "message": "The isolated Runner job exceeded its per-run disk quota.",
            "limit_bytes": self.limit_bytes,
            "actual_bytes": self.actual_bytes,
        }


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def persist_state(key: str) -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    target = STATE_ROOT / f"{key}.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(RUNS[key], ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(target)


def update_state(key: str, **values) -> None:
    with LOCK:
        RUNS[key].update(values)
        persist_state(key)


@app.on_event("startup")
def restore_states() -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    for path in STATE_ROOT.glob("*.json"):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            key = str(state["run_id"])
            if state.get("status") in {"queued", "running"}:
                state.update(
                    status="failed",
                    finished_at=utcnow(),
                    error="Runner restarted before this run reached a terminal state.",
                )
            RUNS[key] = state
            CANCEL_EVENTS[key] = threading.Event()
            persist_state(key)
        except (OSError, ValueError, KeyError):
            continue


def authenticate(value: str | None):
    if value != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="invalid runner credential")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_git_commit(project_root: Path | None) -> str:
    if not project_root:
        return "unavailable"
    try:
        head = (project_root / ".git" / "HEAD").read_text(encoding="ascii").strip()
        if head.startswith("ref: "):
            return (project_root / ".git" / head[5:]).read_text(encoding="ascii").strip()
        return head if len(head) >= 7 else "unavailable"
    except OSError:
        return "unavailable"


def artifact(path: Path, kind: str, run_dir: Path, metadata: dict | None = None) -> dict:
    mime = {".png": "image/png", ".json": "application/json", ".ply": "application/octet-stream"}.get(path.suffix, "application/octet-stream")
    return {"name": path.name, "kind": kind, "relative_path": str(path.relative_to(ARTIFACTS_ROOT)).replace("\\", "/"), "mime_type": mime, "sha256": sha256(path), "metadata": metadata or {}}


def enforce_disk_quota(run_dir: Path, template) -> int:
    actual_bytes = sum(path.stat().st_size for path in run_dir.rglob("*") if path.is_file())
    limit_bytes = template.disk_mb * 1024 * 1024
    if actual_bytes > limit_bytes:
        raise DiskQuotaExceeded(limit_bytes, actual_bytes)
    return actual_bytes


def _project_entrypoint(project_root: Path, relative_entrypoint: str) -> Path:
    candidate = (project_root / relative_entrypoint).resolve()
    if project_root not in candidate.parents or candidate.suffix != ".py" or not candidate.is_file():
        raise ValueError("the allowlisted Python entrypoint was not found inside the project workspace")
    return candidate


def _run_fixed_process(
    command: list[str],
    *,
    cwd: Path,
    environment: dict[str, str],
    log_path: Path,
    ensure_running,
) -> None:
    with log_path.open("a", encoding="utf-8") as log_handle:
        log_handle.write(f"$ {json.dumps(command, ensure_ascii=True)}\n")
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=environment,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
        while process.poll() is None:
            try:
                ensure_running()
            except (RunCancelled, TimeoutError):
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise
            time.sleep(0.2)
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)


def execute_project_template(request: SubmitRequest, project_root: Path, run_dir: Path, log_path: Path, ensure_running) -> list[dict]:
    """Run only fixed project entrypoints; user payload never becomes a command."""
    template = validate_template_config(request.experiment_type, request.config)
    environment = os.environ.copy()
    for secret_name in (
        "POSTGRES_PASSWORD", "MINIO_SECRET_KEY", "N8N_ENCRYPTION_KEY",
        "N8N_LOCAL_OWNER_PASSWORD", "RUNNER_SHARED_SECRET",
        "RESEARCH_MODEL_KEY_SIMPLE", "RESEARCH_MODEL_KEY_MEDIUM", "RESEARCH_MODEL_KEY_COMPLEX",
    ):
        environment.pop(secret_name, None)
    environment.update({
        "RESEARCH_OS_RUN_ID": str(request.run_id),
        "RESEARCH_OS_PROJECT_ID": str(request.project_id),
        "RESEARCH_OS_SEEDS": ",".join(str(seed) for seed in request.random_seeds),
        "RESEARCH_OS_OUTPUT_DIR": str(run_dir),
        "RESEARCH_OS_NETWORK_POLICY": template.network_policy,
    })
    if request.experiment_type in {"python_analysis", "gpu_python"}:
        entrypoint = _project_entrypoint(project_root, request.config.get("entrypoint", "experiment/main.py"))
        _run_fixed_process(["python", str(entrypoint)], cwd=project_root, environment=environment, log_path=log_path, ensure_running=ensure_running)
    elif request.experiment_type == "cpp_cmake":
        source_dir = (project_root / "experiment" / "cpp").resolve()
        if project_root not in source_dir.parents or not (source_dir / "CMakeLists.txt").is_file():
            raise ValueError("the fixed experiment/cpp CMake project was not found")
        build_dir = (Path("/tmp/research-os-build") / str(request.run_id)).resolve()
        _run_fixed_process(
            ["cmake", "-S", str(source_dir), "-B", str(build_dir), "-DCMAKE_BUILD_TYPE=Release"],
            cwd=project_root, environment=environment, log_path=log_path, ensure_running=ensure_running,
        )
        _run_fixed_process(
            ["cmake", "--build", str(build_dir), "--target", "research_os_job", "--parallel", "1"],
            cwd=project_root, environment=environment, log_path=log_path, ensure_running=ensure_running,
        )
        executable = build_dir / "research_os_job"
        if not executable.is_file():
            raise ValueError("the fixed CMake target research_os_job did not produce an executable")
        _run_fixed_process([str(executable)], cwd=project_root, environment=environment, log_path=log_path, ensure_running=ensure_running)
    else:
        raise ValueError(f"no fixed project executor exists for {request.experiment_type}")
    outputs = []
    for path in sorted(run_dir.rglob("*")):
        if not path.is_file() or path == log_path or path.name == "metrics.json":
            continue
        kind = "project_output"
        outputs.append(artifact(path, kind, run_dir, {"task_template": template.task_id}))
    return outputs


def write_point_cloud(run_dir: Path, seed: int) -> tuple[Path, Path]:
    rng = np.random.default_rng(seed)
    phi = rng.uniform(0, 2 * np.pi, 1500)
    costheta = rng.uniform(-1, 1, 1500)
    theta = np.arccos(costheta)
    radius = 1 + rng.normal(0, 0.025, 1500)
    xyz = np.c_[radius * np.sin(theta) * np.cos(phi), radius * np.sin(theta) * np.sin(phi), radius * np.cos(theta)]
    ply = run_dir / "reconstruction.ply"
    with ply.open("w", encoding="ascii") as handle:
        handle.write("ply\nformat ascii 1.0\nelement vertex 1500\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
        np.savetxt(handle, xyz, fmt="%.6f")
    preview = run_dir / "point-cloud-preview.png"
    fig = plt.figure(figsize=(7, 6))
    ax = fig.add_subplot(projection="3d")
    ax.scatter(xyz[:, 0], xyz[:, 1], xyz[:, 2], c=xyz[:, 2], s=3, cmap="viridis")
    ax.set_title("Point cloud reconstruction preview")
    ax.set_box_aspect((1, 1, 1))
    fig.tight_layout()
    fig.savefig(preview, dpi=160)
    plt.close(fig)
    return ply, preview


def execute(request: SubmitRequest):
    key = str(request.run_id)
    deadline = time.monotonic() + MAX_SECONDS

    def ensure_running() -> None:
        if CANCEL_EVENTS[key].is_set():
            raise RunCancelled("run cancelled")
        if time.monotonic() > deadline:
            raise TimeoutError(f"run exceeded {MAX_SECONDS} seconds")

    delay_seconds = float(request.config.get("delay_seconds", 0))
    delay_deadline = time.monotonic() + delay_seconds
    while time.monotonic() < delay_deadline:
        ensure_running()
        time.sleep(min(0.1, delay_deadline - time.monotonic()))

    expected_projects_root = Path(os.getenv("PROJECTS_ROOT", "/workspace/projects")).resolve()
    project_slug = str(request.config.get("project_slug", "")).strip()
    project_root = (expected_projects_root / project_slug).resolve()
    if not project_slug or project_root.parent != expected_projects_root:
        update_state(key, status="failed", finished_at=utcnow(), error=json.dumps({
            "code": "invalid_project_workspace",
            "message": "Runner project workspace is outside the fixed projects root.",
        }))
        return
    try:
        validate_snapshot_contract(
            request.reproducibility,
            project_root=project_root,
            artifacts_root=ARTIFACTS_ROOT,
            runner_image_digest=runtime_identity()["runner_image_digest"],
        )
    except ReproducibilityError as exc:
        update_state(key, status="failed", finished_at=utcnow(), error=json.dumps(exc.as_dict(), ensure_ascii=False))
        return

    run_dir = (ARTIFACTS_ROOT / str(request.project_id) / key).resolve()
    if ARTIFACTS_ROOT not in run_dir.parents:
        return
    try:
        template = validate_template_config(request.experiment_type, request.config)
        run_dir.mkdir(parents=True, exist_ok=False)
        update_state(key, status="running", started_at=utcnow())
        execution_log = run_dir / "execution.log"
        execution_log.write_text(
            f"run_id={key}\nproject_id={request.project_id}\nexperiment_type={request.experiment_type}\n"
            f"policy_constraints={request.policy_constraints.model_dump_json()}\n"
            f"reproducibility={request.reproducibility.model_dump_json()}\nstarted_at={utcnow()}\n",
            encoding="utf-8",
        )
        mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000"))
        mlflow.set_experiment(f"project-{request.project_id}")
        produced = []
        metrics = {}
        with mlflow.start_run(run_name=key) as active_run:
            mlflow.log_params({"experiment_type": request.experiment_type, **request.config})
            project_slug = str(request.config.get("project_slug", ""))
            project_root = (Path(os.getenv("PROJECTS_ROOT", "/workspace/projects")) / project_slug).resolve() if project_slug else None
            git_commit = read_git_commit(project_root) if project_root and project_root.parent == Path(os.getenv("PROJECTS_ROOT", "/workspace/projects")).resolve() else "unavailable"
            mlflow.log_params({
                "git_commit": git_commit,
                "research_os_git_commit": request.reproducibility.research_os_git_commit,
                "runner_image_digest": request.reproducibility.runner_image_digest,
                "runner_image_digest_verified": str(request.reproducibility.runner_image_digest_verified),
                "run_tag": request.reproducibility.run_tag,
                "snapshot_manifest_sha256": request.reproducibility.snapshot_manifest_sha256,
                "source_snapshot_sha256": request.reproducibility.source_snapshot_sha256,
                "data_version": request.reproducibility.data_version,
                "python": platform.python_version(), "random_seeds": ",".join(map(str, request.random_seeds)),
                "policy_minimum_random_seed_count": request.policy_constraints.minimum_random_seed_count,
                "policy_explicit_approval_required": request.policy_constraints.explicit_approval_required,
            })
            mlflow.log_metrics({"system_cpu_count": float(psutil.cpu_count() or 0), "system_memory_available_mb": psutil.virtual_memory().available / 1024 / 1024})
            if request.experiment_type in {"python_analysis", "cpp_cmake", "gpu_python"}:
                produced.extend(execute_project_template(request, project_root, run_dir, execution_log, ensure_running))
                metrics_file = run_dir / "metrics.json"
                if metrics_file.is_file():
                    raw_metrics = json.loads(metrics_file.read_text(encoding="utf-8"))
                    if not isinstance(raw_metrics, dict) or not all(
                        isinstance(value, (int, float)) and not isinstance(value, bool)
                        for value in raw_metrics.values()
                    ):
                        raise ValueError("metrics.json must contain only numeric values")
                    metrics = {str(name): float(value) for name, value in raw_metrics.items()}
            if request.experiment_type == "demo_classification":
                accuracies = []
                fig, ax = plt.subplots(figsize=(7, 4.5))
                for seed in request.random_seeds:
                    ensure_running()
                    X, y = make_classification(
                        n_samples=min(int(request.config.get("n_samples", 600)), 5000),
                        n_features=min(int(request.config.get("n_features", 12)), 100),
                        n_informative=6, random_state=seed,
                    )
                    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=.25, random_state=seed)
                    model = LogisticRegression(max_iter=400, random_state=seed).fit(X_train, y_train)
                    pred = model.predict(X_test)
                    score = accuracy_score(y_test, pred)
                    accuracies.append(score)
                    mlflow.log_metric("accuracy", score, step=seed)
                ax.plot(request.random_seeds, accuracies, marker="o", color="#087f5b")
                ax.set(xlabel="Random seed", ylabel="Accuracy", title="Accuracy across random seeds")
                ax.grid(alpha=.25)
                curve = run_dir / "accuracy-by-seed.png"
                fig.tight_layout(); fig.savefig(curve, dpi=160); plt.close(fig)
                produced.append(artifact(curve, "metric_plot", run_dir, {"seeds": request.random_seeds}))
                cm_path = run_dir / "confusion-matrix.png"
                ConfusionMatrixDisplay.from_predictions(y_test, pred, colorbar=False, cmap="Greens")
                plt.tight_layout(); plt.savefig(cm_path, dpi=160); plt.close()
                produced.append(artifact(cm_path, "confusion_matrix", run_dir))
                metrics = {"accuracy_mean": float(np.mean(accuracies)), "accuracy_std": float(np.std(accuracies)), "seed_count": float(len(accuracies))}
            if request.experiment_type in {"demo_classification", "point_cloud_demo"}:
                ensure_running()
                ply, preview = write_point_cloud(run_dir, request.random_seeds[0])
                produced.extend([artifact(ply, "point_cloud", run_dir, {"vertex_count": 1500}), artifact(preview, "point_cloud_preview", run_dir)])
            if request.experiment_type == "compile_latex":
                ensure_running()
                project_root = (Path(os.getenv("PROJECTS_ROOT", "/workspace/projects")) / str(request.config.get("project_slug", ""))).resolve()
                expected_root = Path(os.getenv("PROJECTS_ROOT", "/workspace/projects")).resolve()
                if project_root.parent != expected_root or not (project_root / "paper" / "main.tex").is_file():
                    raise ValueError("fixed paper/main.tex source was not found")
                process = subprocess.Popen(
                    ["latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", f"-outdir={run_dir}", "main.tex"],
                    cwd=project_root / "paper", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                )
                while process.poll() is None:
                    try:
                        ensure_running()
                    except (RunCancelled, TimeoutError):
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                        raise
                    time.sleep(0.2)
                compile_output = process.stdout.read() if process.stdout else ""
                with execution_log.open("a", encoding="utf-8") as handle:
                    handle.write("\n--- latexmk ---\n")
                    handle.write(compile_output)
                if process.returncode:
                    raise subprocess.CalledProcessError(process.returncode, process.args, output=compile_output)
                pdf = run_dir / "main.pdf"
                produced.append(artifact(pdf, "paper_pdf", run_dir))
            metrics_path = run_dir / "metrics.json"
            metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
            produced.append(artifact(metrics_path, "metrics", run_dir))
            with execution_log.open("a", encoding="utf-8") as handle:
                handle.write(f"\nfinished_at={utcnow()}\nmetrics={json.dumps(metrics, ensure_ascii=False)}\n")
            produced.append(artifact(execution_log, "execution_log", run_dir))
            for name, value in metrics.items():
                mlflow.log_metric(name, value)
            mlflow.log_artifacts(str(run_dir), artifact_path="outputs")
            mlflow_id = active_run.info.run_id
            for item in produced:
                item["metadata"].update({
                    "config": request.config, "random_seeds": request.random_seeds,
                    "policy_constraints": request.policy_constraints.model_dump(mode="json"),
                    "git_commit": git_commit, "mlflow_run_id": mlflow_id,
                    "data_version": request.reproducibility.data_version,
                    "research_os_git_commit": request.reproducibility.research_os_git_commit,
                    "runner_image_digest": request.reproducibility.runner_image_digest,
                    "runner_image_digest_verified": request.reproducibility.runner_image_digest_verified,
                    "run_tag": request.reproducibility.run_tag,
                    "snapshot_manifest_sha256": request.reproducibility.snapshot_manifest_sha256,
                    "source_snapshot_sha256": request.reproducibility.source_snapshot_sha256,
                    "reproducibility": request.reproducibility.model_dump(mode="json"),
                })
            enforce_disk_quota(run_dir, template)
        with LOCK:
            cancelled = RUNS[key]["status"] == "cancelled"
        if not cancelled:
            update_state(key, status="succeeded", finished_at=utcnow(), metrics=metrics, artifacts=produced, mlflow_run_id=mlflow_id)
    except RunCancelled:
        update_state(key, status="cancelled", finished_at=utcnow(), error=None)
    except DiskQuotaExceeded as exc:
        update_state(key, status="failed", finished_at=utcnow(), error=json.dumps(exc.as_dict(), ensure_ascii=False))
    except OSError as exc:
        if exc.errno == errno.EFBIG:
            update_state(key, status="failed", finished_at=utcnow(), error=json.dumps({
                "code": "run_file_size_limit_exceeded",
                "message": "The isolated Runner job exceeded its per-file size limit.",
            }, ensure_ascii=False))
        else:
            update_state(key, status="failed", finished_at=utcnow(), error=f"{exc}\n{traceback.format_exc(limit=3)}")
    except Exception as exc:
        update_state(key, status="failed", finished_at=utcnow(), error=f"{exc}\n{traceback.format_exc(limit=3)}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "allowed_experiments": sorted(TASK_TEMPLATES),
        "task_templates": {
            name: {
                "task_id": template.task_id,
                "allowed_config": sorted(template.allowed_config),
                "max_runtime_seconds": template.max_runtime_seconds,
                "memory_mb": template.memory_mb,
                "pid_limit": template.pid_limit,
                "disk_mb": template.disk_mb,
                "network_policy": template.network_policy,
                "runtime": template.runtime,
                "gpu_required": template.requires_gpu,
            }
            for name, template in TASK_TEMPLATES.items()
        },
        "job_isolation": {
            "mode": "one-container-per-run",
            "docker_socket_mounted": False,
            "executor_url": EXECUTOR_URL,
            "arbitrary_commands": False,
        },
        "reproducibility": runtime_identity(),
    }


def _merge_worker_state(key: str) -> dict | None:
    path = STATE_ROOT / f"{key}.json"
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, ValueError):
        return None
    with LOCK:
        if key not in RUNS:
            return state
        if RUNS[key].get("status") in {"succeeded", "failed", "cancelled"}:
            return RUNS[key]
        RUNS[key].update(state)
        return RUNS[key]


def _monitor_container_job(request: SubmitRequest) -> None:
    key = str(request.run_id)
    deadline = time.monotonic() + min(MAX_SECONDS, validate_template_config(request.experiment_type, request.config).max_runtime_seconds)
    while True:
        if time.monotonic() > deadline:
            try:
                with httpx.Client(timeout=EXECUTOR_TIMEOUT_SECONDS) as client:
                    client.post(f"{EXECUTOR_URL}/v1/jobs/{key}/cancel", headers={"X-Runner-Secret": SHARED_SECRET})
            except httpx.HTTPError:
                pass
            with LOCK:
                RUNS[key].update(status="failed", finished_at=utcnow(), error=json.dumps({
                    "code": "job_timeout",
                    "message": "The isolated per-run container exceeded its runtime limit.",
                    "max_runtime_seconds": min(MAX_SECONDS, validate_template_config(request.experiment_type, request.config).max_runtime_seconds),
                }))
                persist_state(key)
            return
        try:
            with httpx.Client(timeout=EXECUTOR_TIMEOUT_SECONDS) as client:
                response = client.get(f"{EXECUTOR_URL}/v1/jobs/{key}", headers={"X-Runner-Secret": SHARED_SECRET})
                response.raise_for_status()
                container_state = response.json()
            with LOCK:
                RUNS[key]["container_status"] = container_state.get("status")
                persist_state(key)
            if container_state.get("status") in {"exited", "dead"}:
                if not container_state.get("artifacts_synced"):
                    with LOCK:
                        RUNS[key].update(status="failed", finished_at=utcnow(), error=json.dumps({
                            "code": "artifact_volume_sync_failed",
                            "message": "The per-run Docker output volume could not be synchronized; no alternate output path was used.",
                            "detail": container_state.get("artifact_sync_error"),
                        }, ensure_ascii=False))
                        persist_state(key)
                    return
                state = _merge_worker_state(key)
                if not state or state.get("status") not in {"succeeded", "failed", "cancelled"}:
                    with LOCK:
                        RUNS[key].update(status="failed", finished_at=utcnow(), error=json.dumps({
                            "code": "job_container_exited_without_result",
                            "message": "The isolated per-run container exited without a terminal result.",
                            "exit_code": container_state.get("exit_code"),
                        }))
                        persist_state(key)
                return
            state = _merge_worker_state(key)
            if state and state.get("status") in {"succeeded", "failed", "cancelled"}:
                # Wait for the fixed launcher to report terminal and synchronize the output volume.
                pass
        except (httpx.HTTPError, ValueError):
            # A transient executor observation error keeps the bounded observation
            # loop alive; timeout produces a structured failure.
            pass
        time.sleep(0.5)


@app.post("/v1/runs", status_code=202)
def submit(request: SubmitRequest, x_runner_secret: str | None = Header(default=None)):
    authenticate(x_runner_secret)
    key = str(request.run_id)
    expected_projects_root = Path(os.getenv("PROJECTS_ROOT", "/workspace/projects")).resolve()
    project_slug = str(request.config.get("project_slug", "")).strip()
    project_root = (expected_projects_root / project_slug).resolve()
    if not project_slug or project_root.parent != expected_projects_root:
        raise HTTPException(status_code=409, detail={
            "code": "invalid_project_workspace",
            "message": "Runner project workspace is outside the fixed projects root.",
        })
    try:
        validate_snapshot_contract(
            request.reproducibility,
            project_root=project_root,
            artifacts_root=ARTIFACTS_ROOT,
            runner_image_digest=runtime_identity()["runner_image_digest"],
        )
    except ReproducibilityError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc
    with LOCK:
        if key in RUNS:
            raise HTTPException(status_code=409, detail="run already exists")
        RUNS[key] = {
            "run_id": key, "status": "queued", "metrics": {}, "artifacts": [],
            "mlflow_run_id": None, "error": None, "started_at": None, "finished_at": None,
            "reproducibility": request.reproducibility.model_dump(mode="json"),
        }
        persist_state(key)
    try:
        with httpx.Client(timeout=EXECUTOR_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{EXECUTOR_URL}/v1/jobs",
                json=request.model_dump(mode="json"),
                headers={"X-Runner-Secret": SHARED_SECRET},
            )
            response.raise_for_status()
            launch_result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        with LOCK:
            RUNS[key].update(status="failed", finished_at=utcnow(), error=json.dumps({
                "code": "job_container_launch_failed",
                "message": "The fixed per-run job container could not be launched; no alternate executor was used.",
            }))
            persist_state(key)
        raise HTTPException(status_code=503, detail={
            "code": "job_container_launch_failed",
            "message": "The fixed per-run job container could not be launched; no alternate executor was used.",
        }) from exc
    with LOCK:
        RUNS[key].update({"container_id": launch_result.get("container_id"), "isolation_mode": "one-container-per-run"})
        persist_state(key)
    threading.Thread(target=_monitor_container_job, args=(request,), daemon=True).start()
    return RUNS[key]


@app.get("/v1/runs/{run_id}")
def status(run_id: UUID, x_runner_secret: str | None = Header(default=None)):
    authenticate(x_runner_secret)
    if str(run_id) not in RUNS:
        raise HTTPException(status_code=404, detail="run not found")
    return RUNS[str(run_id)]


@app.post("/v1/runs/{run_id}/cancel")
def cancel(run_id: UUID, x_runner_secret: str | None = Header(default=None)):
    authenticate(x_runner_secret)
    key = str(run_id)
    with LOCK:
        if key not in RUNS:
            raise HTTPException(status_code=404, detail="run not found")
        if RUNS[key]["status"] in {"succeeded", "failed", "cancelled"}:
            raise HTTPException(status_code=409, detail="run is already terminal")
    try:
        with httpx.Client(timeout=EXECUTOR_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{EXECUTOR_URL}/v1/jobs/{key}/cancel",
                headers={"X-Runner-Secret": SHARED_SECRET},
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=409, detail={
            "code": "job_container_cancel_rejected",
            "message": "The per-run container rejected cancellation; inspect its terminal state.",
        }) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail={
            "code": "job_container_cancel_failed",
            "message": "The per-run container could not be reached for cancellation.",
        }) from exc
    with LOCK:
        RUNS[key].update(status="cancelled", finished_at=utcnow())
        persist_state(key)
        return RUNS[key]
