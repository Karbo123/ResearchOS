"""Approval-gated, allowlisted project patch execution.

The executor accepts structured file operations only. It never interprets a
unified diff as a command and never accepts a user-selected validator.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
from pathlib import Path, PurePosixPath
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


GIT_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_NAMES = {".git", ".env", ".env.local", "auth.json", "credentials.json"}
ALLOWED_ROOTS = {
    "code": {"experiment", "src"},
    "config": {"configs"},
    "latex": {"paper"},
}
ALLOWED_SUFFIXES = {
    "code": {".py", ".pyi", ".c", ".cc", ".cpp", ".h", ".hh", ".hpp", ".cmake"},
    "config": {".json", ".jsonl", ".toml", ".yaml", ".yml", ".ini", ".cfg"},
    "latex": {".tex", ".bib", ".sty", ".cls"},
}
MAX_OPERATIONS = 50
MAX_FILE_BYTES = 512 * 1024
MAX_PATCH_BYTES = 4 * 1024 * 1024


class PatchExecutionError(ValueError):
    def __init__(self, code: str, message: str, **details: Any):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.details}


class PatchOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["create", "replace", "delete"]
    path: str = Field(min_length=1, max_length=240)
    content: str | None = Field(default=None, max_length=MAX_FILE_BYTES)
    expected_sha256: str | None = None

    @field_validator("path")
    @classmethod
    def validate_path_text(cls, value: str) -> str:
        if "\\" in value or value.startswith("/") or "\x00" in value:
            raise ValueError("patch paths must be relative POSIX paths")
        parsed = PurePosixPath(value)
        if not parsed.parts or any(part in {"", ".", ".."} for part in parsed.parts):
            raise ValueError("patch paths cannot contain empty, dot, or parent segments")
        if any(part.lower() in FORBIDDEN_NAMES for part in parsed.parts):
            raise ValueError("patch paths cannot target credentials or Git metadata")
        return value

    @field_validator("expected_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not SHA256_RE.fullmatch(value.lower()):
            raise ValueError("expected_sha256 must be a lowercase SHA-256")
        return value.lower() if value else value

    @model_validator(mode="after")
    def validate_content_contract(self):
        if self.action in {"create", "replace"} and self.content is None:
            raise ValueError("create and replace operations require content")
        if self.action == "delete" and self.content is not None:
            raise ValueError("delete operations cannot contain content")
        if self.action in {"replace", "delete"} and not self.expected_sha256:
            raise ValueError("replace and delete operations require expected_sha256")
        if self.action == "create" and self.expected_sha256:
            raise ValueError("create operations cannot claim an existing file hash")
        return self


class PatchPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patch_schema_version: Literal["1.0"]
    patch_kind: Literal["code", "config", "latex"]
    base_git_commit: str
    operations: list[PatchOperation] = Field(default_factory=list, max_length=MAX_OPERATIONS)
    rollback: bool = False
    rollback_of: str | None = None
    rollback_commit: str | None = None

    @field_validator("base_git_commit", "rollback_commit")
    @classmethod
    def validate_commit(cls, value: str | None) -> str | None:
        if value is not None and not GIT_COMMIT_RE.fullmatch(value.lower()):
            raise ValueError("Git commits must be full 40-character SHA-1 values")
        return value.lower() if value else value

    @model_validator(mode="after")
    def validate_shape(self):
        if self.rollback:
            if self.operations or not self.rollback_of or not self.rollback_commit:
                raise ValueError("rollback payloads require rollback_of, rollback_commit, and no operations")
            if self.base_git_commit != self.rollback_commit:
                raise ValueError("rollback base commit must equal rollback_commit")
        elif self.rollback_of or self.rollback_commit:
            raise ValueError("rollback fields are only valid for rollback payloads")
        if not self.rollback and not self.operations:
            raise ValueError("patch payload must contain at least one operation")
        total = sum(len((item.content or "").encode("utf-8")) for item in self.operations)
        if total > MAX_PATCH_BYTES:
            raise ValueError("patch payload exceeds the aggregate size limit")
        if len({item.path for item in self.operations}) != len(self.operations):
            raise ValueError("each patch path may appear only once")
        return self


def parse_patch_payload(payload: dict[str, Any]) -> PatchPayload:
    try:
        return PatchPayload.model_validate(payload)
    except ValueError as exc:
        raise PatchExecutionError("patch_payload_invalid", "结构化 patch payload 不符合固定契约。") from exc


def _git(root: Path, args: list[str], *, timeout: int = 30, check: bool = True) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            check=check,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.CalledProcessError as exc:
        raise PatchExecutionError("patch_git_command_failed", "项目 Git 操作返回失败。") from exc
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PatchExecutionError("patch_git_unavailable", "项目 Git 操作失败或超时。") from exc
    if check:
        return result.stdout.strip()
    return result.stdout.strip()


def _head(root: Path) -> str:
    value = _git(root, ["rev-parse", "HEAD"])
    if not GIT_COMMIT_RE.fullmatch(value):
        raise PatchExecutionError("patch_git_head_invalid", "项目当前 HEAD 不是完整 Git commit。")
    return value


def _ensure_clean_at_base(root: Path, base_git_commit: str) -> None:
    if not root.is_dir() or not (root / ".git").exists():
        raise PatchExecutionError("patch_project_git_missing", "项目 Git 工作区不存在。")
    actual = _head(root)
    if actual != base_git_commit:
        raise PatchExecutionError(
            "patch_conflict",
            "项目 HEAD 已变化，patch 基准版本与当前工作区冲突。",
            expected=base_git_commit,
            actual=actual,
        )
    status = _git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
    if status:
        raise PatchExecutionError("patch_workspace_dirty", "项目工作区不干净，拒绝覆盖用户或其他任务的修改。")


def _target(root: Path, operation: PatchOperation, patch_kind: str) -> Path:
    parsed = PurePosixPath(operation.path)
    if parsed.parts[0] not in ALLOWED_ROOTS[patch_kind]:
        raise PatchExecutionError(
            "patch_path_not_allowed",
            "patch 路径不在该类型的固定项目目录内。",
            path=operation.path,
            patch_kind=patch_kind,
        )
    suffix = Path(operation.path).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES[patch_kind] and Path(operation.path).name != "CMakeLists.txt":
        raise PatchExecutionError("patch_file_type_not_allowed", "patch 文件扩展名不在白名单内。", path=operation.path)
    target = (root / Path(*parsed.parts)).resolve()
    if target == root or root not in target.parents:
        raise PatchExecutionError("patch_path_escape", "patch 路径超出项目工作区。", path=operation.path)
    return target


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as exc:
        raise PatchExecutionError("patch_read_failed", "patch 目标文件无法读取。", path=str(path)) from exc
    return digest.hexdigest()


def validate_patch_against_workspace(payload: PatchPayload, root: Path) -> list[Path]:
    """Validate current files and return safe absolute targets without mutating them."""
    _ensure_clean_at_base(root, payload.base_git_commit)
    targets: list[Path] = []
    for operation in payload.operations:
        target = _target(root, operation, payload.patch_kind)
        if target.is_symlink():
            raise PatchExecutionError("patch_symlink_not_allowed", "patch 不能操作符号链接。", path=operation.path)
        exists = target.exists()
        if operation.action == "create" and exists:
            raise PatchExecutionError("patch_target_exists", "create 目标已经存在，不能覆盖。", path=operation.path)
        if operation.action in {"replace", "delete"} and not exists:
            raise PatchExecutionError("patch_target_missing", "replace/delete 目标不存在。", path=operation.path)
        if exists and not target.is_file():
            raise PatchExecutionError("patch_target_not_file", "patch 目标必须是普通文件。", path=operation.path)
        if operation.expected_sha256 and _sha256(target) != operation.expected_sha256:
            raise PatchExecutionError("patch_conflict", "patch 目标文件 hash 已变化。", path=operation.path)
        targets.append(target)
    return targets


def _apply_operations(payload: PatchPayload, root: Path) -> None:
    try:
        for operation in payload.operations:
            target = _target(root, operation, payload.patch_kind)
            if operation.action == "delete":
                target.unlink()
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(operation.content or "", encoding="utf-8", newline="")
    except PatchExecutionError:
        raise
    except (OSError, UnicodeError) as exc:
        raise PatchExecutionError("patch_write_failed", "patch 文件操作失败，未接受该变更。") from exc


def _validate_python(path: Path, root: Path) -> None:
    relative = str(path.relative_to(root))
    result = subprocess.run(
        [os.environ.get("PYTHON", "python"), "-m", "py_compile", relative],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=30,
        env={"PATH": os.environ.get("PATH", ""), "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if result.returncode:
        raise PatchExecutionError("patch_validation_failed", "Python 文件编译校验失败。", path=relative)


def _validate_latex(root: Path) -> None:
    main = root / "paper" / "main.tex"
    if not main.is_file():
        raise PatchExecutionError("patch_validation_failed", "LaTeX patch 缺少 paper/main.tex。")
    try:
        text = main.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise PatchExecutionError("patch_validation_failed", "LaTeX 主文件无法读取。") from exc
    if not all(token in text for token in ("\\documentclass", "\\begin{document}", "\\end{document}")):
        raise PatchExecutionError("patch_validation_failed", "LaTeX 主文件缺少固定文档结构。")
    depth = 0
    escaped = False
    for char in text:
        if char == "{" and not escaped:
            depth += 1
        elif char == "}" and not escaped:
            depth -= 1
            if depth < 0:
                break
        escaped = char == "\\" and not escaped
        if char != "\\":
            escaped = False
    if depth != 0:
        raise PatchExecutionError("patch_validation_failed", "LaTeX 花括号不平衡。")


def validate_isolated_tree(payload: PatchPayload, root: Path) -> None:
    for operation in payload.operations:
        path = _target(root, operation, payload.patch_kind)
        if operation.action == "delete":
            continue
        raw = path.read_bytes()
        if b"\x00" in raw:
            raise PatchExecutionError("patch_validation_failed", "patch 文件包含 NUL 字节。", path=operation.path)
        if path.suffix.lower() == ".py":
            _validate_python(path, root)
        elif path.suffix.lower() == ".json":
            try:
                json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise PatchExecutionError("patch_validation_failed", "JSON 配置校验失败。", path=operation.path) from exc
        elif path.suffix.lower() == ".toml":
            try:
                tomllib.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise PatchExecutionError("patch_validation_failed", "TOML 配置校验失败。", path=operation.path) from exc
    if payload.patch_kind == "latex":
        _validate_latex(root)


def build_patch_diff(payload: PatchPayload, root: Path) -> str:
    lines: list[str] = []
    for operation in payload.operations:
        path = _target(root, operation, payload.patch_kind)
        before = []
        if path.is_file():
            before = path.read_text(encoding="utf-8").splitlines(keepends=True)
        after = [] if operation.action == "delete" else (operation.content or "").splitlines(keepends=True)
        if operation.action == "create":
            old_name, new_name = "/dev/null", f"b/{operation.path}"
        elif operation.action == "delete":
            old_name, new_name = f"a/{operation.path}", "/dev/null"
        else:
            old_name, new_name = f"a/{operation.path}", f"b/{operation.path}"
        lines.extend(difflib.unified_diff(before, after, fromfile=old_name, tofile=new_name))
    return "".join(lines) or "No content change"


def _restore(root: Path, backups: list[tuple[Path, bool, bytes | None]]) -> None:
    for path, existed, content in backups:
        try:
            if existed:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content or b"")
            elif path.exists() or path.is_symlink():
                path.unlink()
        except OSError as exc:
            raise PatchExecutionError("patch_rollback_failed", "patch 失败后恢复原文件失败。") from exc


def execute_patch(
    payload: dict[str, Any],
    *,
    project_root: Path,
    proposal_id: UUID,
    staging_root: Path,
) -> dict[str, Any]:
    request = parse_patch_payload(payload)
    if request.rollback:
        return execute_rollback(
            payload,
            project_root=project_root,
            proposal_id=proposal_id,
        )
    targets = validate_patch_against_workspace(request, project_root)
    staging: Path | None = None
    backups: list[tuple[Path, bool, bytes | None]] = []
    committed = False
    try:
        try:
            staging_root.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix="patch-", dir=staging_root))
            shutil.copytree(project_root, staging, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git"))
        except (OSError, shutil.Error) as exc:
            raise PatchExecutionError("patch_staging_failed", "无法创建 patch 隔离验证目录。") from exc
        _apply_operations(request, staging)
        validate_isolated_tree(request, staging)
        validate_patch_against_workspace(request, project_root)
        for target in targets:
            backups.append((target, target.exists(), target.read_bytes() if target.exists() else None))
        _apply_operations(request, project_root)
        _git(project_root, ["add", "--", *[item.path for item in request.operations]])
        try:
            check = subprocess.run(
                ["git", "-C", str(project_root), "diff", "--cached", "--check"],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PatchExecutionError("patch_git_unavailable", "Git staged diff 校验失败或超时。") from exc
        if check.returncode:
            raise PatchExecutionError("patch_validation_failed", "Git staged diff 校验失败。")
        try:
            subprocess.run(
                ["git", "-C", str(project_root), "commit", "-m", f"Research OS approved patch {proposal_id}"],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise PatchExecutionError("patch_commit_failed", "批准的 patch 无法提交到项目 Git。") from exc
        committed = True
        commit = _head(project_root)
        return {
            "status": "committed",
            "patch_kind": request.patch_kind,
            "commit": commit,
            "changed_paths": [item.path for item in request.operations],
            "validation": "isolated_static_validation",
        }
    except PatchExecutionError:
        if not committed:
            try:
                _restore(project_root, backups)
                _git(project_root, ["reset", "--", *[item.path for item in request.operations]])
            except PatchExecutionError as exc:
                raise PatchExecutionError("patch_rollback_failed", "patch 失败后无法完整恢复文件和 Git 暂存区。") from exc
        raise
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def execute_rollback(payload: dict[str, Any], *, project_root: Path, proposal_id: UUID) -> dict[str, Any]:
    request = parse_patch_payload(payload)
    if not request.rollback or not request.rollback_commit:
        raise PatchExecutionError("patch_rollback_invalid", "回滚 payload 不完整。")
    _ensure_clean_at_base(project_root, request.base_git_commit)
    try:
        ancestor = subprocess.run(
            ["git", "-C", str(project_root), "merge-base", "--is-ancestor", request.rollback_commit, "HEAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if ancestor.returncode:
            raise PatchExecutionError(
                "patch_rollback_conflict",
                "目标 patch commit 不是当前 HEAD 的可回滚祖先。",
                commit=request.rollback_commit,
            )
        subprocess.run(
            ["git", "-C", str(project_root), "revert", "--no-edit", request.rollback_commit],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except PatchExecutionError:
        raise
    except (OSError, subprocess.SubprocessError) as exc:
        try:
            subprocess.run(["git", "-C", str(project_root), "revert", "--abort"], check=False, capture_output=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            pass
        raise PatchExecutionError("patch_rollback_failed", "patch 回滚失败，项目未被替换为其他实验或内容。") from exc
    return {
        "status": "rolled_back",
        "rollback_of": request.rollback_of,
        "reverted_commit": request.rollback_commit,
        "commit": _head(project_root),
        "validation": "git_revert",
        "proposal_id": str(proposal_id),
    }
