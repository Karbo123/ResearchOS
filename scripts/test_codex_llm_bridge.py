from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import scripts.codex_llm_bridge as bridge


class CodexBridgeEnvironmentTests(unittest.TestCase):
    def test_api_key_is_passed_only_in_child_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            def fake_run(command: list[str], **kwargs: object) -> SimpleNamespace:
                output_index = command.index("--output-last-message") + 1
                Path(command[output_index]).write_text("{}", encoding="utf-8")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            with (
                patch.object(bridge, "MODEL_PROVIDER", "test"),
                patch.dict(
                    bridge.os.environ,
                    {"CODEX_CLI_PATH": "codex-test", "OPENAI_API_KEY": "sentinel"},
                    clear=False,
                ),
                patch.object(bridge.subprocess, "run", side_effect=fake_run) as run,
            ):
                result = bridge._run_codex(
                    {"message": "offline test"},
                    "prompt",
                    Path(temp_dir) / "schema.json",
                    "test-model",
                    "low",
                )

            self.assertEqual(result, {})
            child_env = run.call_args.kwargs["env"]
            self.assertEqual(child_env["OPENAI_API_KEY"], "sentinel")
            self.assertNotIn("sentinel", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
