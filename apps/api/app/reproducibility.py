from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


GIT_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
IMAGE_DIGEST_RE = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
MAX_TRACKED_FILE_BYTES = 10 * 1024 * 1024

FORBIDDEN_SUFFIXES = {
    ".7z", ".bak", ".bin", ".ckpt", ".db", ".dmp", ".feather", ".gif",
    ".h5", ".hdf5", ".jpeg", ".jpg", ".log", ".model", ".npy", ".npz",
    ".onnx", ".parquet", ".pcd", ".pdf", ".pickle", ".ply", ".png", ".pt",
    ".pth", ".safetensors", ".sqlite", ".tar", ".tgz", ".tmp", ".webp",
    ".weights", ".zip",
}
FORBIDDEN_DIRS = {
    ".cache", ".conda", ".venv", "__pycache__", "artifacts", "conda-meta",
    "database-backups", "docker-layers", "logs", "minio-data", "mlflow-data",
    "n8n-data", "node_modules", "package-cache", "postgres-data", "runs",
    "source-bundles",
}
LOCK_FILE_NAMES = {
    "cargo.lock", "composer.lock", "conda-lock.yml", "environment.yml",
    "environment.yaml", "gemfile.lock", "go.sum", "package-lock.json",
    "pipfile.lock", "poetry.lock", "pnpm-lock.yaml", "requirements-lock.txt",
    "requirements.txt", "yarn.lock",
}


class ReproducibilityError(ValueError):
    """A safe, structured error suitable for an API 409 response."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.details}


class DependencyLockRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relative_path: str
    size_bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ReproducibilityContract(BaseModel):
    """The immutable hand-off that both API and Runner validate."""

    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    project_git_commit: str
    research_os_git_commit: str
    runner_image_digest: str
    runner_image_digest_verified: bool = False
    run_tag: str
    snapshot_manifest_path: str
    snapshot_manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_snapshot_path: str
    source_snapshot_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_snapshot_size_bytes: int = Field(gt=0)
    environment_report_path: str
    data_manifest_path: str
    model_manifest_path: str
    dependency_manifest_path: str
    project_spec_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    policy_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    config_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    data_version: str = Field(pattern=r"^[0-9a-f]{64}$")
    idea_version: int = Field(ge=1)
    random_seeds: list[int] = Field(min_length=1, max_length=10)
    dependency_lock_files: list[DependencyLockRecord] = Field(default_factory=list, max_length=100)

    @field_validator("project_git_commit")
    @classmethod
    def valid_project_commit(cls, value: str) -> str:
        if not GIT_COMMIT_RE.fullmatch(value):
            raise ValueError("project_git_commit must be a full Git commit")
        return value

    @field_validator("research_os_git_commit")
    @classmethod
    def valid_research_os_commit(cls, value: str) -> str:
        if value != "unavailable" and not GIT_COMMIT_RE.fullmatch(value):
            raise ValueError("research_os_git_commit must be a full Git commit or unavailable")
        return value

    @field_validator("run_tag")
    @classmethod
    def valid_run_tag(cls, value: str) -> str:
        if not re.fullmatch(r"run/[0-9a-f-]{36}", value):
            raise ValueError("run_tag must be the fixed run/<uuid> tag format")
        return value

    @field_validator(
        "snapshot_manifest_path", "source_snapshot_path", "environment_report_path",
        "data_manifest_path", "model_manifest_path", "dependency_manifest_path",
    )
    @classmethod
    def valid_relative_path(cls, value: str) -> str:
        path = Path(value.replace("\\", "/"))
        if path.is_absolute() or ".." in path.parts or "\\" in value or not value:
            raise ValueError("snapshot paths must be controlled relative paths")
        return value.replace("\\", "/")

    @model_validator(mode="after")
    def validate_image_digest(self):
        if self.runner_image_digest_verified and not IMAGE_DIGEST_RE.fullmatch(self.runner_image_digest):
            raise ValueError("verified runner_image_digest must be a sha256 digest")
        if str(self.run_id) not in self.run_tag:
            raise ValueError("run_tag does not match run_id")
        return self


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as exc:
        raise ReproducibilityError("snapshot_file_unreadable", "A reproducibility file could not be read.", {"path": path.name}) from exc
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> tuple[int, str]:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    path.write_bytes(data)
    return len(data), sha256_bytes(data)


def _run_git(project_root: Path, args: list[str], timeout: int = 20) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(project_root), *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise ReproducibilityError("git_unavailable", "Git is required to create an experiment snapshot.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ReproducibilityError("git_timeout", "Git did not finish the snapshot check in time.") from exc
    except subprocess.CalledProcessError as exc:
        raise ReproducibilityError(
            "git_command_failed",
            "Git rejected the reproducibility operation.",
            {"returncode": exc.returncode, "operation": args[0] if args else "unknown"},
        ) from exc
    return result.stdout


def _ensure_project_root(project_root: Path) -> Path:
    root = project_root.resolve()
    if not root.is_dir() or not (root / ".git").exists():
        raise ReproducibilityError(
            "project_source_missing",
            "The project Git workspace is missing; the experiment cannot start.",
        )
    try:
        actual = Path(_run_git(root, ["rev-parse", "--show-toplevel"]).strip()).resolve()
    except ReproducibilityError as exc:
        if exc.code == "git_command_failed":
            raise ReproducibilityError(
                "project_source_missing",
                "The project Git workspace is not readable; the experiment cannot start.",
            ) from exc
        raise
    if actual != root:
        raise ReproducibilityError("project_source_missing", "The project Git workspace is not the expected fixed root.")
    return root


def project_git_commit(project_root: Path) -> str:
    root = _ensure_project_root(project_root)
    commit = _run_git(root, ["rev-parse", "HEAD"]).strip()
    if not GIT_COMMIT_RE.fullmatch(commit):
        raise ReproducibilityError("project_commit_missing", "The project has no full Git commit to snapshot.")
    return commit


def git_status_entries(project_root: Path) -> list[str]:
    root = _ensure_project_root(project_root)
    output = _run_git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
    entries: list[str] = []
    for line in output.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[-1]
        entries.append(path.replace("\\", "/"))
    return entries


def _git_index_files(project_root: Path) -> list[str]:
    output = _run_git(project_root, ["ls-files", "-z"])
    return [item for item in output.split("\0") if item]


def _controlled_path(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path.replace("/", os.sep)).resolve()
    if candidate != root and root not in candidate.parents:
        raise ReproducibilityError("unsafe_repository_path", "A repository path escapes the fixed project root.")
    return candidate


def _path_violation(relative_path: str, file_path: Path) -> dict[str, Any] | None:
    normalized = relative_path.replace("\\", "/").lower()
    parts = set(Path(normalized).parts)
    suffix = Path(normalized).suffix
    if suffix in FORBIDDEN_SUFFIXES or parts.intersection(FORBIDDEN_DIRS):
        return {"path": relative_path, "reason": "large_or_runtime_artifact_path"}
    if file_path.is_file():
        try:
            size = file_path.stat().st_size
        except OSError:
            return {"path": relative_path, "reason": "unreadable_file"}
        if size > MAX_TRACKED_FILE_BYTES:
            return {"path": relative_path, "reason": "tracked_file_exceeds_size_limit", "size_bytes": size, "limit_bytes": MAX_TRACKED_FILE_BYTES}
    return None


def validate_git_workspace(project_root: Path, require_clean: bool = True) -> dict[str, Any]:
    root = _ensure_project_root(project_root)
    commit = project_git_commit(root)
    status_entries = git_status_entries(root)
    paths = sorted(set(_git_index_files(root) + status_entries))
    violations: list[dict[str, Any]] = []
    for relative_path in paths:
        path = _controlled_path(root, relative_path)
        violation = _path_violation(relative_path, path)
        if violation:
            violations.append(violation)
    if violations:
        raise ReproducibilityError(
            "git_policy_violation",
            "The project Git workspace contains a forbidden or oversized file.",
            {"violations": violations},
        )
    if require_clean and status_entries:
        raise ReproducibilityError(
            "project_worktree_dirty",
            "The project Git workspace must be clean before an experiment starts.",
            {"changed_paths": status_entries},
        )
    return {"project_git_commit": commit, "changed_paths": status_entries, "tracked_files": paths}


def create_run_tag(project_root: Path, run_id: UUID, commit: str) -> str:
    root = _ensure_project_root(project_root)
    tag = f"run/{run_id}"
    existing = _run_git(root, ["tag", "--list", tag]).strip()
    if existing:
        raise ReproducibilityError("run_tag_exists", "The immutable run tag already exists.", {"run_tag": tag})
    try:
        _run_git(root, ["tag", "-a", tag, commit, "-m", f"Research OS run {run_id}"])
    except ReproducibilityError as exc:
        raise ReproducibilityError("run_tag_failed", "The immutable run tag could not be created.", {"run_tag": tag}) from exc
    return tag


def tag_commit(project_root: Path, run_tag: str) -> str:
    root = _ensure_project_root(project_root)
    commit = _run_git(root, ["rev-parse", f"{run_tag}^{{commit}}"]).strip()
    if not GIT_COMMIT_RE.fullmatch(commit):
        raise ReproducibilityError("run_tag_invalid", "The run tag does not resolve to a full commit.")
    return commit


def resolve_research_os_commit() -> str:
    configured = os.getenv("RESEARCH_OS_COMMIT", "").strip()
    if configured and (configured == "unavailable" or GIT_COMMIT_RE.fullmatch(configured)):
        return configured
    source_path = Path(__file__).resolve()
    candidates = [source_path.parents[3] if len(source_path.parents) > 3 else source_path.parent, Path.cwd()]
    for candidate in candidates:
        try:
            if (candidate / ".git").exists():
                value = _run_git(candidate.resolve(), ["rev-parse", "HEAD"]).strip()
                if GIT_COMMIT_RE.fullmatch(value):
                    return value
        except ReproducibilityError:
            continue
    return "unavailable"


def runtime_identity() -> dict[str, Any]:
    image_digest = os.getenv("RUNNER_IMAGE_DIGEST", "unavailable").strip() or "unavailable"
    verified = bool(IMAGE_DIGEST_RE.fullmatch(image_digest))
    fingerprint_input = bytearray()
    for path in (Path(__file__), Path("/app/requirements.txt")):
        if path.is_file():
            fingerprint_input.extend(str(path).encode("utf-8"))
            fingerprint_input.extend(path.read_bytes())
    return {
        "runner_image_digest": image_digest,
        "runner_image_digest_verified": verified,
        "build_fingerprint": sha256_bytes(bytes(fingerprint_input)) if fingerprint_input else "unavailable",
        "python": platform.python_version(),
        "platform": platform.platform(),
        "implementation": sys.implementation.name,
    }


def _safe_artifact_path(artifacts_root: Path, relative_path: str) -> Path:
    root = artifacts_root.resolve()
    candidate = (root / relative_path.replace("/", os.sep)).resolve()
    if candidate != root and root not in candidate.parents:
        raise ReproducibilityError("unsafe_artifact_path", "A snapshot path escapes the controlled artifact root.")
    return candidate


def _artifact_record(path: Path, artifacts_root: Path, role: str) -> dict[str, Any]:
    relative = str(path.resolve().relative_to(artifacts_root.resolve())).replace("\\", "/")
    size = path.stat().st_size
    return {"role": role, "relative_path": relative, "size_bytes": size, "sha256": sha256_file(path)}


def _lock_records(project_root: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in project_root.rglob("*"):
        if not path.is_file() or path.name.lower() not in LOCK_FILE_NAMES:
            continue
        relative = str(path.relative_to(project_root)).replace("\\", "/")
        resolved = _controlled_path(project_root, relative)
        record = _artifact_record(resolved, project_root, "dependency_lock")
        records.append({
            "relative_path": record["relative_path"],
            "size_bytes": record["size_bytes"],
            "sha256": record["sha256"],
        })
    return sorted(records, key=lambda item: item["relative_path"])


def _data_records(artifacts_root: Path, records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in records:
        relative_path = str(item.get("relative_path", "")).replace("\\", "/")
        path = _safe_artifact_path(artifacts_root, relative_path)
        if not path.is_file():
            raise ReproducibilityError(
                "data_source_missing",
                "A declared data input is missing from the controlled artifact store.",
                {"path": relative_path},
            )
        size = path.stat().st_size
        digest = sha256_file(path)
        expected_size = int(item.get("size_bytes", -1))
        expected_digest = str(item.get("sha256", ""))
        if size != expected_size or digest != expected_digest:
            raise ReproducibilityError(
                "data_source_changed",
                "A declared data input changed after it was uploaded.",
                {"path": relative_path, "expected_sha256": expected_digest, "actual_sha256": digest},
            )
        normalized.append({
            "id": str(item.get("id", "")), "name": str(item.get("name", "")),
            "relative_path": relative_path, "mime_type": str(item.get("mime_type", "application/octet-stream")),
            "size_bytes": size, "sha256": digest,
        })
    return sorted(normalized, key=lambda item: (item["relative_path"], item["id"]))


def _snapshot_directory(artifacts_root: Path, project_id: UUID, run_id: UUID) -> Path:
    root = artifacts_root.resolve()
    target = (root / "reproducibility" / str(project_id) / str(run_id)).resolve()
    if root not in target.parents:
        raise ReproducibilityError("unsafe_artifact_path", "The reproducibility directory is outside the artifact root.")
    if target.exists():
        raise ReproducibilityError("snapshot_exists", "The reproducibility snapshot directory already exists.")
    target.mkdir(parents=True, exist_ok=False)
    return target


def create_reproducibility_snapshot(
    *,
    project_root: Path,
    artifacts_root: Path,
    project_id: UUID,
    run_id: UUID,
    idea_version: int,
    project_spec: dict[str, Any],
    policies: list[dict[str, Any]],
    experiment_type: str,
    effective_config: dict[str, Any],
    random_seeds: list[int],
    uploaded_files: list[dict[str, Any]],
    runner_environment: dict[str, Any],
) -> dict[str, Any]:
    git_state = validate_git_workspace(project_root, require_clean=True)
    project_commit = git_state["project_git_commit"]
    research_os_commit = resolve_research_os_commit()
    tag = create_run_tag(project_root, run_id, project_commit)
    target = _snapshot_directory(artifacts_root, project_id, run_id)
    try:
        lock_files = _lock_records(project_root)
        data_records = _data_records(artifacts_root, uploaded_files)
        data_version = sha256_bytes(canonical_json(data_records))
        spec_payload = {"idea_version": idea_version, "spec": project_spec}
        policy_payload = {"policies": sorted(policies, key=lambda item: str(item.get("id", "")))}
        config_payload = {
            "experiment_type": experiment_type,
            "config": effective_config,
            "random_seeds": random_seeds,
        }
        environment_payload = {
            "research_os_git_commit": research_os_commit,
            "runner": {
                "runner_image_digest": runner_environment.get("runner_image_digest", "unavailable"),
                "runner_image_digest_verified": bool(runner_environment.get("runner_image_digest_verified", False)),
                "python": runner_environment.get("python"),
                "platform": runner_environment.get("platform"),
                "implementation": runner_environment.get("implementation"),
                "build_fingerprint": runner_environment.get("build_fingerprint"),
            },
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }
        dependency_payload = {"lock_files": lock_files}
        spec_path = target / "project-spec.json"
        policy_path = target / "policy.json"
        config_path = target / "experiment-config.json"
        environment_path = target / "environment-report.json"
        data_path = target / "data-manifest.json"
        model_path = target / "model-manifest.json"
        dependency_path = target / "dependency-locks.json"
        _write_json(spec_path, spec_payload)
        _write_json(policy_path, policy_payload)
        _write_json(config_path, config_payload)
        _write_json(environment_path, environment_payload)
        _write_json(data_path, {"data_version": data_version, "inputs": data_records})
        _write_json(model_path, {"models": [], "note": "No external model input was declared for this allowlisted task."})
        _write_json(dependency_path, dependency_payload)

        source_path = target / "source.tar"
        try:
            _run_git(project_root, ["archive", "--format=tar", f"--output={source_path}", tag], timeout=60)
        except ReproducibilityError:
            raise ReproducibilityError("source_snapshot_failed", "The project source snapshot could not be created.")
        if not source_path.is_file() or source_path.stat().st_size <= 0:
            raise ReproducibilityError("source_snapshot_failed", "The project source snapshot is empty.")

        entries = [
            _artifact_record(spec_path, artifacts_root, "project_spec"),
            _artifact_record(policy_path, artifacts_root, "policy"),
            _artifact_record(config_path, artifacts_root, "experiment_config"),
            _artifact_record(environment_path, artifacts_root, "environment_report"),
            _artifact_record(data_path, artifacts_root, "data_manifest"),
            _artifact_record(model_path, artifacts_root, "model_manifest"),
            _artifact_record(dependency_path, artifacts_root, "dependency_manifest"),
            _artifact_record(source_path, artifacts_root, "source_snapshot"),
        ]
        manifest = {
            "schema_version": "1.0",
            "project_id": str(project_id),
            "run_id": str(run_id),
            "idea_version": idea_version,
            "project_git_commit": project_commit,
            "research_os_git_commit": research_os_commit,
            "run_tag": tag,
            "data_version": data_version,
            "project_spec_sha256": sha256_file(spec_path),
            "policy_sha256": sha256_file(policy_path),
            "config_sha256": sha256_file(config_path),
            "files": entries,
        }
        manifest_path = target / "snapshot.json"
        _write_json(manifest_path, manifest)
        manifest_record = _artifact_record(manifest_path, artifacts_root, "snapshot_manifest")
        source_record = next(item for item in entries if item["role"] == "source_snapshot")
        runner_image_digest = str(runner_environment.get("runner_image_digest", "unavailable"))
        runner_image_digest_verified = bool(runner_environment.get("runner_image_digest_verified", False))
        contract = ReproducibilityContract(
            run_id=run_id,
            project_git_commit=project_commit,
            research_os_git_commit=research_os_commit,
            runner_image_digest=runner_image_digest,
            runner_image_digest_verified=runner_image_digest_verified,
            run_tag=tag,
            snapshot_manifest_path=manifest_record["relative_path"],
            snapshot_manifest_sha256=manifest_record["sha256"],
            source_snapshot_path=source_record["relative_path"],
            source_snapshot_sha256=source_record["sha256"],
            source_snapshot_size_bytes=source_record["size_bytes"],
            environment_report_path=next(item for item in entries if item["role"] == "environment_report")["relative_path"],
            data_manifest_path=next(item for item in entries if item["role"] == "data_manifest")["relative_path"],
            model_manifest_path=next(item for item in entries if item["role"] == "model_manifest")["relative_path"],
            dependency_manifest_path=next(item for item in entries if item["role"] == "dependency_manifest")["relative_path"],
            project_spec_sha256=manifest["project_spec_sha256"],
            policy_sha256=manifest["policy_sha256"],
            config_sha256=manifest["config_sha256"],
            data_version=data_version,
            idea_version=idea_version,
            random_seeds=random_seeds,
            dependency_lock_files=[DependencyLockRecord.model_validate(item) for item in lock_files],
        )
        return {
            "contract": contract.model_dump(mode="json"),
            "manifest": manifest,
            "artifacts": [*entries, manifest_record],
            "snapshot_directory": str(target),
        }
    except Exception:
        for child in sorted(target.glob("*"), reverse=True):
            if child.is_file() or child.is_symlink():
                child.unlink(missing_ok=True)
        target.rmdir()
        raise


def validate_snapshot_contract(
    contract_data: dict[str, Any] | ReproducibilityContract,
    *,
    project_root: Path,
    artifacts_root: Path,
    runner_image_digest: str | None = None,
) -> ReproducibilityContract:
    try:
        contract = contract_data if isinstance(contract_data, ReproducibilityContract) else ReproducibilityContract.model_validate(contract_data)
    except Exception as exc:
        raise ReproducibilityError("invalid_snapshot_contract", "The reproducibility contract is invalid.") from exc
    git_state = validate_git_workspace(project_root, require_clean=True)
    if git_state["project_git_commit"] != contract.project_git_commit:
        raise ReproducibilityError(
            "project_commit_changed",
            "The project commit changed after the reproducibility snapshot was created.",
            {"expected": contract.project_git_commit, "actual": git_state["project_git_commit"]},
        )
    tagged_commit = tag_commit(project_root, contract.run_tag)
    if tagged_commit != contract.project_git_commit:
        raise ReproducibilityError("run_tag_mismatch", "The immutable run tag does not match the snapshot commit.")
    if runner_image_digest and contract.runner_image_digest_verified and runner_image_digest != contract.runner_image_digest:
        raise ReproducibilityError("runner_image_changed", "The Runner image identity changed after the snapshot was created.")

    manifest_path = _safe_artifact_path(artifacts_root, contract.snapshot_manifest_path)
    if not manifest_path.is_file() or sha256_file(manifest_path) != contract.snapshot_manifest_sha256:
        raise ReproducibilityError("snapshot_manifest_missing", "The reproducibility manifest is missing or changed.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReproducibilityError("snapshot_manifest_invalid", "The reproducibility manifest cannot be parsed.") from exc
    if manifest.get("run_id") != str(contract.run_id) or manifest.get("project_git_commit") != contract.project_git_commit:
        raise ReproducibilityError("snapshot_manifest_mismatch", "The reproducibility manifest does not match this run.")
    for entry in manifest.get("files", []):
        path = _safe_artifact_path(artifacts_root, str(entry.get("relative_path", "")))
        if not path.is_file() or path.stat().st_size != int(entry.get("size_bytes", -1)) or sha256_file(path) != entry.get("sha256"):
            raise ReproducibilityError("snapshot_artifact_changed", "A reproducibility snapshot file is missing or changed.", {"role": entry.get("role")})
    source_path = _safe_artifact_path(artifacts_root, contract.source_snapshot_path)
    if not source_path.is_file() or source_path.stat().st_size != contract.source_snapshot_size_bytes or sha256_file(source_path) != contract.source_snapshot_sha256:
        raise ReproducibilityError("source_snapshot_changed", "The source snapshot is missing or changed.")
    return contract
