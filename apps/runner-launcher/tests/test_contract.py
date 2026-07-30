import unittest
import os
import time
from uuid import uuid4
from fastapi import HTTPException

from app.main import LaunchRequest, TEMPLATE_LIMITS, authenticate, client, health, launch, status


def valid_payload():
    return {
        "run_id": uuid4(),
        "project_id": uuid4(),
        "experiment_type": "demo_classification",
        "config": {"project_slug": "project", "n_samples": 100, "n_features": 4},
        "random_seeds": [1, 2, 3],
        "policy_constraints": {},
        "reproducibility": {"run_tag": "run/test", "data_version": "test"},
    }


class LauncherContractTests(unittest.TestCase):
    def test_rejects_unknown_top_level_fields(self):
        payload = valid_payload()
        payload["command"] = ["sh"]
        with self.assertRaises(ValueError):
            LaunchRequest.model_validate(payload)

    def test_rejects_untrusted_config_fields(self):
        for field in ("command", "image", "path", "network", "environment"):
            payload = valid_payload()
            payload["config"][field] = "untrusted"
            with self.assertRaises(ValueError):
                LaunchRequest.model_validate(payload)

    def test_rejects_boolean_or_empty_seeds(self):
        payload = valid_payload()
        payload["random_seeds"] = [True]
        with self.assertRaises(ValueError):
            LaunchRequest.model_validate(payload)
        payload["random_seeds"] = []
        with self.assertRaises(ValueError):
            LaunchRequest.model_validate(payload)

    def test_authentication_is_required(self):
        with self.assertRaises(HTTPException) as context:
            authenticate("wrong")
        self.assertEqual(context.exception.status_code, 401)

    def test_template_limits_are_fixed_and_positive(self):
        self.assertTrue({"demo_classification", "point_cloud_demo", "compile_latex", "python_analysis", "cpp_cmake", "gpu_python"}.issubset(TEMPLATE_LIMITS))
        self.assertTrue(all(item["cpu"] > 0 and item["memory"] > 0 and item["pids"] > 0 for item in TEMPLATE_LIMITS.values()))
        self.assertTrue(TEMPLATE_LIMITS["gpu_python"]["gpu"])

    def test_running_launcher_can_reach_the_docker_socket(self):
        self.assertTrue(client.ping())
        self.assertTrue(health()["docker_available"])

    @unittest.skipUnless(os.getenv("RUNNER_INTEGRATION_TESTS") == "1", "explicit container integration test")
    def test_creates_a_real_job_container_without_running_an_experiment(self):
        run_id = uuid4()
        payload = valid_payload()
        payload["run_id"] = run_id
        payload["config"] = {"project_slug": "missing-project-for-container-test"}
        payload["reproducibility"] = {
            "run_id": run_id,
            "project_git_commit": "0" * 40,
            "research_os_git_commit": "unavailable",
            "runner_image_digest": "unavailable",
            "run_tag": f"run/{run_id}",
            "snapshot_manifest_path": "test/snapshot.json",
            "snapshot_manifest_sha256": "0" * 64,
            "source_snapshot_path": "test/source.tar",
            "source_snapshot_sha256": "0" * 64,
            "source_snapshot_size_bytes": 1,
            "environment_report_path": "test/environment.json",
            "data_manifest_path": "test/data.json",
            "model_manifest_path": "test/model.json",
            "dependency_manifest_path": "test/dependencies.json",
            "project_spec_sha256": "0" * 64,
            "policy_sha256": "0" * 64,
            "config_sha256": "0" * 64,
            "data_version": "0" * 64,
            "idea_version": 1,
            "random_seeds": [1],
        }
        request = LaunchRequest.model_validate(payload)
        container_name = f"research-os-run-{run_id}"
        try:
            result = launch(request, "runner-dev-secret")
            self.assertEqual(result["container_name"], container_name)
            self.assertEqual(result["isolation_mode"], "one-container-per-run")
            self.assertEqual(result["resource_limits"], TEMPLATE_LIMITS["demo_classification"])
            for _ in range(50):
                current = status(run_id, "runner-dev-secret")
                if current["status"] in {"exited", "dead"}:
                    break
                time.sleep(0.1)
            self.assertIn(current["status"], {"exited", "dead"})
        finally:
            try:
                container = client.containers.get(container_name)
                container.remove(force=True)
            except Exception:
                # The launcher removes terminal containers after volume synchronization.
                pass

    @unittest.skipUnless(os.getenv("RUNNER_INTEGRATION_TESTS") == "1", "explicit container integration test")
    def test_per_run_volume_enforces_a_hard_size_limit(self):
        volume_name = f"research-os-volume-test-{uuid4()}"
        volume = client.volumes.create(
            name=volume_name,
            driver="local",
            driver_opts={"type": "tmpfs", "device": "tmpfs", "o": "size=8m,mode=1770"},
            labels={"research_os.test": "volume-quota"},
        )
        container = None
        try:
            container = client.containers.run(
                image=os.getenv("RUNNER_JOB_IMAGE", "research-os-runner"),
                command=["python", "-c", "from pathlib import Path; Path('/run-output/too-large').write_bytes(b'x' * (16 * 1024 * 1024))"],
                volumes={volume_name: {"bind": "/run-output", "mode": "rw"}},
                user="10002",
                read_only=True,
                tmpfs={"/tmp": "rw,size=32m,mode=1777"},
                detach=True,
            )
            result = container.wait(timeout=30)
            exit_code = result.get("StatusCode", 1) if isinstance(result, dict) else int(result)
            self.assertNotEqual(exit_code, 0)
            inspected = client.volumes.get(volume_name).attrs
            self.assertEqual(inspected["Options"]["type"], "tmpfs")
            self.assertIn("size=8m", inspected["Options"]["o"])
        finally:
            if container is not None:
                container.remove(force=True)
            volume.remove(force=True)


if __name__ == "__main__":
    unittest.main()
