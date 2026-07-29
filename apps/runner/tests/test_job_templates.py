import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.job_templates import TASK_TEMPLATES, validate_template_config
from app import main as runner_main


class JobTemplateTests(unittest.TestCase):
    def test_all_templates_have_bounded_task_metadata(self):
        self.assertEqual(set(TASK_TEMPLATES), {"demo_classification", "point_cloud_demo", "compile_latex"})
        self.assertTrue(all(template.task_id.endswith(".v1") for template in TASK_TEMPLATES.values()))
        self.assertTrue(all(template.memory_mb > 0 and template.pid_limit > 0 for template in TASK_TEMPLATES.values()))
        self.assertTrue(all(template.network_policy == "internal-mlflow-only" for template in TASK_TEMPLATES.values()))

    def test_template_validation_rejects_commands_paths_network_and_unknown_fields(self):
        validate_template_config("demo_classification", {"project_slug": "project", "n_samples": 100})
        for field in ("command", "path", "url", "network", "image"):
            with self.assertRaises(ValueError):
                validate_template_config("demo_classification", {field: "untrusted", "project_slug": "project"})
        with self.assertRaises(ValueError):
            validate_template_config("point_cloud_demo", {"project_slug": "project", "learning_rate": 0.1})

    def test_supervisor_terminal_state_cannot_be_overwritten_by_late_child_update(self):
        with TemporaryDirectory() as directory:
            with patch.object(runner_main, "RUNS", {"run": {"run_id": "run", "status": "cancelled"}}), \
                    patch.object(runner_main, "STATE_ROOT", Path(directory)):
                runner_main._persist_child_state("run", {"status": "running"})
                self.assertEqual(runner_main.RUNS["run"]["status"], "cancelled")

    def test_job_environment_declares_bounded_internal_policy(self):
        from app.job_isolation import job_environment

        environment = job_environment(TASK_TEMPLATES["compile_latex"])
        self.assertEqual(environment["RESEARCH_OS_NETWORK_POLICY"], "internal-mlflow-only")
        self.assertEqual(environment["RESEARCH_OS_NO_ARBITRARY_COMMANDS"], "true")
