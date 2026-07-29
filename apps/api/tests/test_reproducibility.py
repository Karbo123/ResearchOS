from __future__ import annotations

import subprocess
import tarfile
from pathlib import Path
from uuid import uuid4

import pytest

from app.reproducibility import (
    ReproducibilityError,
    create_reproducibility_snapshot,
    validate_git_workspace,
    validate_snapshot_contract,
)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def clean_project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "README.md").write_text("# test project\n", encoding="utf-8")
    (root / "requirements.txt").write_text("pytest==8.4.0\n", encoding="utf-8")
    git(root, "init", "--initial-branch=main")
    git(root, "config", "user.name", "Research OS Test")
    git(root, "config", "user.email", "research-os-test@localhost")
    git(root, "add", "README.md", "requirements.txt")
    git(root, "commit", "-m", "initial project")
    return root


def make_snapshot(root: Path, artifacts_root: Path):
    return create_reproducibility_snapshot(
        project_root=root,
        artifacts_root=artifacts_root,
        project_id=uuid4(),
        run_id=uuid4(),
        idea_version=1,
        project_spec={"schema_version": "1.0", "idea": {"title": "Test", "research_question": "A sufficiently long question?"}},
        policies=[{"id": "policy-1", "rule": "Every run retains its inputs.", "rationale": None, "active": True}],
        experiment_type="demo_classification",
        effective_config={"project_slug": "test-project", "n_samples": 100},
        random_seeds=[13, 37],
        uploaded_files=[],
        runner_environment={"runner_image_digest": "unavailable", "runner_image_digest_verified": False, "python": "3.12"},
    )


def test_snapshot_has_tag_source_bundle_and_recoverable_contract(tmp_path: Path):
    root = clean_project(tmp_path)
    artifacts_root = tmp_path / "artifacts"
    artifacts_root.mkdir()

    snapshot = make_snapshot(root, artifacts_root)
    contract = validate_snapshot_contract(
        snapshot["contract"],
        project_root=root,
        artifacts_root=artifacts_root,
    )

    assert contract.project_git_commit == git(root, "rev-parse", "HEAD")
    assert git(root, "tag", "--list", contract.run_tag) == contract.run_tag
    source = artifacts_root / contract.source_snapshot_path
    assert source.is_file() and source.stat().st_size == contract.source_snapshot_size_bytes
    with tarfile.open(source, "r") as archive:
        assert "README.md" in archive.getnames()
        assert "requirements.txt" in archive.getnames()
    assert snapshot["manifest"]["data_version"]
    assert any(item.relative_path == "requirements.txt" for item in contract.dependency_lock_files)


def test_dirty_project_is_rejected_before_snapshot(tmp_path: Path):
    root = clean_project(tmp_path)
    (root / "README.md").write_text("changed\n", encoding="utf-8")

    with pytest.raises(ReproducibilityError) as error:
        validate_git_workspace(root)

    assert error.value.code == "project_worktree_dirty"
    assert "README.md" in error.value.details["changed_paths"]


def test_staged_oversized_file_is_rejected_with_structured_error(tmp_path: Path):
    root = clean_project(tmp_path)
    oversized = root / "dataset.txt"
    oversized.write_bytes(b"x" * (10 * 1024 * 1024 + 1))
    git(root, "add", "dataset.txt")

    with pytest.raises(ReproducibilityError) as error:
        validate_git_workspace(root)

    assert error.value.code == "git_policy_violation"
    assert error.value.details["violations"][0]["reason"] == "tracked_file_exceeds_size_limit"


def test_staged_model_file_is_rejected_even_when_small(tmp_path: Path):
    root = clean_project(tmp_path)
    model = root / "weights.pth"
    model.write_bytes(b"model")
    git(root, "add", "weights.pth")

    with pytest.raises(ReproducibilityError) as error:
        validate_git_workspace(root)

    assert error.value.code == "git_policy_violation"
    assert error.value.details["violations"][0]["path"] == "weights.pth"


def test_missing_project_source_is_rejected(tmp_path: Path):
    with pytest.raises(ReproducibilityError) as error:
        validate_git_workspace(tmp_path / "missing-project")

    assert error.value.code == "project_source_missing"
