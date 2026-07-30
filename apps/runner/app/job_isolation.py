"""Per-run process isolation and bounded OS resource limits."""

from __future__ import annotations

import os
import platform
from typing import Any

try:
    import resource
except ImportError:  # Windows development hosts run the actual limits in Linux containers.
    resource = None

from .job_templates import JobTemplate


def apply_job_limits(template: JobTemplate, global_max_seconds: int) -> dict[str, Any]:
    """Apply limits inside the child process; never mutate the API supervisor limits."""
    cpu_seconds = max(1, min(template.max_runtime_seconds, global_max_seconds))
    limits: dict[str, Any] = {
        "cpu_seconds": cpu_seconds,
        "memory_bytes": template.memory_mb * 1024 * 1024,
        "pid_limit": template.pid_limit,
        "disk_bytes": template.disk_mb * 1024 * 1024,
        "platform": platform.system().lower(),
        "network_policy": template.network_policy,
        "runtime": template.runtime,
        "gpu_required": template.requires_gpu,
    }
    if resource is not None and platform.system() != "Windows":
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        resource.setrlimit(resource.RLIMIT_AS, (limits["memory_bytes"], limits["memory_bytes"]))
        if hasattr(resource, "RLIMIT_NPROC"):
            resource.setrlimit(resource.RLIMIT_NPROC, (template.pid_limit, template.pid_limit))
        if hasattr(resource, "RLIMIT_FSIZE"):
            resource.setrlimit(resource.RLIMIT_FSIZE, (limits["disk_bytes"], limits["disk_bytes"]))
    return limits


def job_environment(template: JobTemplate) -> dict[str, str]:
    """Return non-secret task metadata; arbitrary environment injection is impossible."""
    return {
        "RESEARCH_OS_TASK_ID": template.task_id,
        "RESEARCH_OS_NETWORK_POLICY": template.network_policy,
        "RESEARCH_OS_NO_ARBITRARY_COMMANDS": "true",
        "RESEARCH_OS_GPU_REQUIRED": "true" if template.requires_gpu else "false",
    }
