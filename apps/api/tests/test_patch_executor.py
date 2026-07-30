from __future__ import annotations

import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

from app.patch_executor import (
    PatchExecutionError,
    execute_patch,
    parse_patch_payload,
)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def clean_project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "experiment").mkdir(parents=True)
    (root / "configs").mkdir()
    (root / "paper").mkdir()
    (root / "experiment" / "main.py").write_text("print('original')\n", encoding="utf-8")
    (root / "configs" / "settings.json").write_text('{"enabled": true}\n', encoding="utf-8")
    (root / "paper" / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nOriginal\\end{document}\n",
        encoding="utf-8",
    )
    git(root, "init", "--initial-branch=main")
    git(root, "config", "user.name", "Research OS Test")
    git(root, "config", "user.email", "research-os-test@localhost")
    git(root, "add", "experiment", "configs", "paper")
    git(root, "commit", "-m", "initial project")
    return root


def replace_payload(root: Path) -> dict:
    target = root / "experiment" / "main.py"
    import hashlib

    return {
        "patch_schema_version": "1.0",
        "patch_kind": "code",
        "base_git_commit": git(root, "rev-parse", "HEAD"),
        "operations": [{
            "action": "replace",
            "path": "experiment/main.py",
            "content": "print('patched')\n",
            "expected_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        }],
    }


def test_patch_is_validated_in_isolation_then_committed(tmp_path: Path):
    root = clean_project(tmp_path)
    result = execute_patch(
        replace_payload(root),
        project_root=root,
        proposal_id=uuid4(),
        staging_root=tmp_path / "staging",
    )

    assert result["status"] == "committed"
    assert result["validation"] == "isolated_static_validation"
    assert (root / "experiment" / "main.py").read_text(encoding="utf-8") == "print('patched')\n"
    assert git(root, "status", "--porcelain") == ""


def test_invalid_python_does_not_modify_or_commit_project(tmp_path: Path):
    root = clean_project(tmp_path)
    payload = replace_payload(root)
    payload["operations"][0]["content"] = "def broken(:\n"
    before = git(root, "rev-parse", "HEAD")

    with pytest.raises(PatchExecutionError) as error:
        execute_patch(payload, project_root=root, proposal_id=uuid4(), staging_root=tmp_path / "staging")

    assert error.value.code == "patch_validation_failed"
    assert git(root, "rev-parse", "HEAD") == before
    assert (root / "experiment" / "main.py").read_text(encoding="utf-8") == "print('original')\n"
    assert git(root, "status", "--porcelain") == ""


def test_hash_conflict_is_rejected_before_write(tmp_path: Path):
    root = clean_project(tmp_path)
    payload = replace_payload(root)
    git(root, "-c", "user.name=Research OS Test", "commit", "--allow-empty", "-m", "unrelated change")

    with pytest.raises(PatchExecutionError) as error:
        execute_patch(payload, project_root=root, proposal_id=uuid4(), staging_root=tmp_path / "staging")

    assert error.value.code == "patch_conflict"
    assert git(root, "status", "--porcelain") == ""


def test_rollback_is_a_git_revert_and_restores_previous_content(tmp_path: Path):
    root = clean_project(tmp_path)
    execution = execute_patch(
        replace_payload(root),
        project_root=root,
        proposal_id=uuid4(),
        staging_root=tmp_path / "staging",
    )
    rollback = {
        "patch_schema_version": "1.0",
        "patch_kind": "code",
        "base_git_commit": execution["commit"],
        "operations": [],
        "rollback": True,
        "rollback_of": str(uuid4()),
        "rollback_commit": execution["commit"],
    }

    result = execute_patch(
        rollback,
        project_root=root,
        proposal_id=uuid4(),
        staging_root=tmp_path / "staging",
    )

    assert result["status"] == "rolled_back"
    assert (root / "experiment" / "main.py").read_text(encoding="utf-8") == "print('original')\n"
    assert git(root, "status", "--porcelain") == ""


@pytest.mark.parametrize(
    "payload",
    [
        {
            "patch_schema_version": "1.0", "patch_kind": "code", "base_git_commit": "0" * 40,
            "operations": [{"action": "replace", "path": "../outside.py", "content": "x", "expected_sha256": "0" * 64}],
        },
        {
            "patch_schema_version": "1.0", "patch_kind": "code", "base_git_commit": "0" * 40,
            "operations": [{"action": "replace", "path": ".env", "content": "x", "expected_sha256": "0" * 64}],
        },
    ],
)
def test_patch_payload_rejects_escape_and_secret_paths(payload):
    with pytest.raises(PatchExecutionError) as error:
        parse_patch_payload(payload)
    assert error.value.code == "patch_payload_invalid"


def test_latex_patch_requires_document_structure(tmp_path: Path):
    root = clean_project(tmp_path)
    target = root / "paper" / "main.tex"
    import hashlib

    payload = {
        "patch_schema_version": "1.0", "patch_kind": "latex", "base_git_commit": git(root, "rev-parse", "HEAD"),
        "operations": [{
            "action": "replace", "path": "paper/main.tex", "content": "\\documentclass{article}\n",
            "expected_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        }],
    }
    with pytest.raises(PatchExecutionError) as error:
        execute_patch(payload, project_root=root, proposal_id=uuid4(), staging_root=tmp_path / "staging")
    assert error.value.code == "patch_validation_failed"
    assert git(root, "status", "--porcelain") == ""


def test_staging_failure_is_returned_as_structured_error(monkeypatch, tmp_path: Path):
    root = clean_project(tmp_path)
    payload = replace_payload(root)

    def fail_copytree(*_args, **_kwargs):
        raise OSError("test staging failure")

    monkeypatch.setattr("app.patch_executor.shutil.copytree", fail_copytree)

    with pytest.raises(PatchExecutionError) as error:
        execute_patch(payload, project_root=root, proposal_id=uuid4(), staging_root=tmp_path / "staging")

    assert error.value.code == "patch_staging_failed"
    assert git(root, "status", "--porcelain") == ""
