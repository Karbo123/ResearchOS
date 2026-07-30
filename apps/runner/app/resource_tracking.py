"""Bounded, numeric resource sampling for an individual Runner job."""

from __future__ import annotations

import csv
import json
import os
import platform
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil


RESOURCE_SAMPLE_SECONDS = max(0.25, min(float(os.getenv("RUNNER_RESOURCE_SAMPLE_SECONDS", "1")), 60.0))
GPU_QUERY = [
    "nvidia-smi",
    "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu",
    "--format=csv,noheader,nounits",
]


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: str) -> float:
    return float(value.strip().replace("%", ""))


def read_gpu_metrics() -> tuple[dict[str, float], str]:
    """Read only fixed numeric nvidia-smi fields; never include stderr or environment."""
    try:
        result = subprocess.run(
            GPU_QUERY,
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {}, "unavailable"
    if result.returncode != 0:
        return {}, "unavailable"
    metrics: dict[str, float] = {}
    try:
        rows = csv.reader(line for line in result.stdout.splitlines() if line.strip())
        for row in rows:
            if len(row) != 5:
                continue
            index = int(row[0].strip())
            metrics[f"gpu_{index}_utilization_percent"] = _number(row[1])
            metrics[f"gpu_{index}_memory_used_mb"] = _number(row[2])
            metrics[f"gpu_{index}_memory_total_mb"] = _number(row[3])
            metrics[f"gpu_{index}_temperature_celsius"] = _number(row[4])
    except (TypeError, ValueError):
        return {}, "invalid"
    return metrics, "ok" if metrics else "unavailable"


class ResourceTracker:
    """Sample process/system/GPU resources without recording arbitrary user data."""

    def __init__(self, run_dir: Path, mlflow_module: Any, interval_seconds: float = RESOURCE_SAMPLE_SECONDS):
        self.run_dir = run_dir
        self.mlflow = mlflow_module
        self.interval_seconds = max(0.25, min(float(interval_seconds), 60.0))
        self.path = run_dir / "resource-usage.jsonl"
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._sample_index = 0
        self._process = psutil.Process()
        self._process.cpu_percent(None)
        psutil.cpu_percent(None)

    def start(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._thread = threading.Thread(target=self._loop, name="resource-tracker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=max(1.0, self.interval_seconds * 2))
            self._thread = None

    @property
    def sample_count(self) -> int:
        return self._sample_index

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            self.sample_once()

    def _process_metrics(self) -> dict[str, float]:
        processes = [self._process]
        try:
            processes.extend(self._process.children(recursive=True))
        except (psutil.Error, OSError):
            pass
        cpu = 0.0
        rss = 0
        for process in processes:
            try:
                cpu += float(process.cpu_percent(None))
                rss += int(process.memory_info().rss)
            except (psutil.Error, OSError):
                continue
        return {
            "process_cpu_percent": cpu,
            "process_memory_rss_mb": rss / 1024 / 1024,
        }

    def sample_once(self) -> dict[str, Any]:
        virtual_memory = psutil.virtual_memory()
        gpu_metrics, gpu_status = read_gpu_metrics()
        metrics: dict[str, Any] = {
            "timestamp": _utcnow(),
            "sample_index": self._sample_index,
            "platform": platform.system().lower(),
            "python_pid": os.getpid(),
            "system_cpu_percent": float(psutil.cpu_percent(None)),
            "system_cpu_count": float(psutil.cpu_count() or 0),
            "system_memory_used_mb": float(virtual_memory.used) / 1024 / 1024,
            "system_memory_available_mb": float(virtual_memory.available) / 1024 / 1024,
            "system_memory_percent": float(virtual_memory.percent),
            "gpu_available": 1.0 if gpu_metrics else 0.0,
            "gpu_count": float(len({key.split("_")[1] for key in gpu_metrics if key.startswith("gpu_")})),
            "gpu_probe_status": gpu_status,
        }
        metrics.update(self._process_metrics())
        metrics.update(gpu_metrics)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(metrics, ensure_ascii=True, separators=(",", ":")) + "\n")
        for name, value in metrics.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                self.mlflow.log_metric(name, float(value), step=self._sample_index)
        self._sample_index += 1
        return metrics
