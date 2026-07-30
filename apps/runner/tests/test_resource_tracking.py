import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from app.resource_tracking import ResourceTracker, read_gpu_metrics


class FakeMlflow:
    def __init__(self):
        self.metrics = []

    def log_metric(self, name, value, step=None):
        self.metrics.append((name, value, step))


class ResourceTrackingTests(unittest.TestCase):
    def test_gpu_parser_accepts_only_fixed_numeric_fields(self):
        result = subprocess.CompletedProcess([], 0, "0, 42, 1024, 8192, 55\n", "secret-like stderr")
        with patch("app.resource_tracking.subprocess.run", return_value=result):
            metrics, status = read_gpu_metrics()
        self.assertEqual(status, "ok")
        self.assertEqual(metrics["gpu_0_utilization_percent"], 42.0)
        self.assertNotIn("stderr", metrics)

    def test_tracker_writes_numeric_snapshot_and_mlflow_series(self):
        fake_process = SimpleNamespace(
            children=lambda recursive=True: [],
            cpu_percent=lambda interval=None: 12.5,
            memory_info=lambda: SimpleNamespace(rss=8 * 1024 * 1024),
        )
        fake_memory = SimpleNamespace(used=100 * 1024 * 1024, available=900 * 1024 * 1024, percent=10.0)
        fake_mlflow = FakeMlflow()
        with TemporaryDirectory() as directory, \
                patch("app.resource_tracking.psutil.Process", return_value=fake_process), \
                patch("app.resource_tracking.psutil.virtual_memory", return_value=fake_memory), \
                patch("app.resource_tracking.psutil.cpu_percent", return_value=25.0), \
                patch("app.resource_tracking.psutil.cpu_count", return_value=4), \
                patch("app.resource_tracking.read_gpu_metrics", return_value=({}, "unavailable")):
            tracker = ResourceTracker(Path(directory), fake_mlflow, interval_seconds=1)
            snapshot = tracker.sample_once()
            content = tracker.path.read_text(encoding="utf-8")
            record = json.loads(content.strip())
        self.assertEqual(snapshot["gpu_available"], 0.0)
        self.assertEqual(record["process_cpu_percent"], 12.5)
        self.assertTrue(fake_mlflow.metrics)
        self.assertTrue(all(item[2] == 0 for item in fake_mlflow.metrics))
        self.assertNotIn("environment", record)
        self.assertNotIn("secret-like stderr", content)
