"""Static Runner task templates and their bounded resource policies."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


FORBIDDEN_CONFIG_FIELDS = {"command", "cmd", "shell", "cwd", "path", "url", "network", "image", "environment"}


@dataclass(frozen=True)
class JobTemplate:
    task_id: str
    allowed_config: frozenset[str]
    max_runtime_seconds: int
    memory_mb: int
    pid_limit: int
    disk_mb: int
    network_policy: str
    runtime: str = "builtin"
    requires_gpu: bool = False


TASK_TEMPLATES = {
    "topic_specific": JobTemplate(
        task_id="topic_specific.v1",
        allowed_config=frozenset({"project_slug"}),
        max_runtime_seconds=1800,
        memory_mb=4096,
        pid_limit=128,
        disk_mb=2048,
        network_policy="internal-mlflow-only",
        runtime="python",
    ),
    "demo_classification": JobTemplate(
        task_id="demo_classification.v1",
        allowed_config=frozenset({"project_slug", "n_samples", "n_features", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=768,
        pid_limit=64,
        disk_mb=512,
        network_policy="internal-mlflow-only",
    ),
    "point_cloud_demo": JobTemplate(
        task_id="point_cloud_demo.v1",
        allowed_config=frozenset({"project_slug", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=768,
        pid_limit=64,
        disk_mb=512,
        network_policy="internal-mlflow-only",
    ),
    "compile_latex": JobTemplate(
        task_id="compile_latex.v1",
        allowed_config=frozenset({"project_slug", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=1024,
        pid_limit=96,
        disk_mb=1024,
        network_policy="internal-mlflow-only",
    ),
    "python_analysis": JobTemplate(
        task_id="python_analysis.v1",
        allowed_config=frozenset({"project_slug", "entrypoint", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=1024,
        pid_limit=96,
        disk_mb=1024,
        network_policy="internal-mlflow-only",
        runtime="python",
    ),
    "cpp_cmake": JobTemplate(
        task_id="cpp_cmake.v1",
        allowed_config=frozenset({"project_slug", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=1024,
        pid_limit=128,
        disk_mb=1024,
        network_policy="internal-mlflow-only",
        runtime="cpp",
    ),
    "gpu_python": JobTemplate(
        task_id="gpu_python.v1",
        allowed_config=frozenset({"project_slug", "entrypoint", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=4096,
        pid_limit=128,
        disk_mb=2048,
        network_policy="internal-mlflow-only",
        runtime="python",
        requires_gpu=True,
    ),
    "conda_python": JobTemplate(
        task_id="conda_python.v1",
        allowed_config=frozenset({"project_slug", "entrypoint", "delay_seconds"}),
        max_runtime_seconds=600,
        memory_mb=1024,
        pid_limit=96,
        disk_mb=1024,
        network_policy="internal-mlflow-only",
        runtime="conda",
    ),
}


SAFE_PYTHON_ENTRYPOINT = re.compile(r"^experiment/[A-Za-z0-9_.-]+\.py$")


def template_for(task_id: str) -> JobTemplate:
    try:
        return TASK_TEMPLATES[task_id]
    except KeyError as exc:
        raise ValueError("task type is not allowlisted") from exc


def validate_template_config(task_id: str, config: dict[str, Any]) -> JobTemplate:
    template = template_for(task_id)
    forbidden = FORBIDDEN_CONFIG_FIELDS.intersection(config)
    if forbidden:
        raise ValueError(f"forbidden task fields: {sorted(forbidden)}")
    unknown = set(config) - template.allowed_config
    if unknown:
        raise ValueError(f"config contains unsupported fields: {sorted(unknown)}")
    delay = config.get("delay_seconds", 0)
    if not isinstance(delay, (int, float)) or isinstance(delay, bool) or not 0 <= delay <= 10:
        raise ValueError("delay_seconds must be between 0 and 10")
    if task_id == "demo_classification":
        n_samples = config.get("n_samples", 600)
        n_features = config.get("n_features", 12)
        if not isinstance(n_samples, int) or isinstance(n_samples, bool) or not 100 <= n_samples <= 100_000:
            raise ValueError("n_samples must be an integer between 100 and 100000")
        if not isinstance(n_features, int) or isinstance(n_features, bool) or not 2 <= n_features <= 1_000:
            raise ValueError("n_features must be an integer between 2 and 1000")
    if task_id in {"python_analysis", "gpu_python", "conda_python"}:
        entrypoint = config.get("entrypoint", "experiment/main.py")
        if not isinstance(entrypoint, str) or not SAFE_PYTHON_ENTRYPOINT.fullmatch(entrypoint):
            raise ValueError("entrypoint must be a single Python file under experiment/")
    return template
