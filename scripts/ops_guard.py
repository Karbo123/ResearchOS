"""Fixed-scope operational health, capacity, backup, and restore checks.

The CLI only touches the Research OS workspace and fixed Compose services. It
never prints database dumps, credentials, or command output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable


ROOT = Path(__file__).resolve().parents[1]
OPS_ROOT = ROOT / "artifacts" / "ops"
BACKUP_ROOT = ROOT / "artifacts" / "backups"
EXPECTED_SERVICES = (
    "postgres", "api", "queue-worker", "runner", "runner-launcher",
    "n8n", "mlflow", "minio", "clamav",
)
HEALTH_TARGETS = (
    ("api", "http://127.0.0.1:8080/api/health"),
    ("n8n", "http://127.0.0.1:5678/"),
    ("mlflow", "http://127.0.0.1:5000/health"),
)
VOLUME_NAMES = ("postgres-data", "minio-data", "n8n-data")
VOLUME_ARCHIVE_IMAGE = "postgres:16-alpine"
BACKUP_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z$")
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class OpsError(RuntimeError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


@dataclass(frozen=True)
class HealthTarget:
    name: str
    url: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def probe_http(target: HealthTarget, timeout_seconds: float = 5.0) -> dict[str, Any]:
    request = urllib.request.Request(target.url, headers={"User-Agent": "ResearchOS-ops/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            status = int(response.status)
            return {"name": target.name, "url": target.url, "status": "ok" if status < 400 else "failed", "http_status": status}
    except urllib.error.HTTPError as exc:
        return {"name": target.name, "url": target.url, "status": "failed", "http_status": int(exc.code), "error_code": "http_error"}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"name": target.name, "url": target.url, "status": "failed", "error_code": "health_unreachable", "error_type": type(exc).__name__}


def run_fixed_command(command: list[str], timeout_seconds: float = 30.0, *, capture_output: bool = True) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(command, check=True, timeout=timeout_seconds, capture_output=capture_output)
    except FileNotFoundError as exc:
        raise OpsError("ops_command_missing", "固定运维命令不可用。", {"command": command[0]}) from exc
    except subprocess.TimeoutExpired as exc:
        raise OpsError("ops_command_timeout", "固定运维命令超时。", {"command": command[0]}) from exc
    except subprocess.CalledProcessError as exc:
        raise OpsError("ops_command_failed", "固定运维命令失败。", {"command": command[0], "returncode": exc.returncode}) from exc


def parse_compose_status(output: bytes | str) -> list[dict[str, Any]]:
    text = output.decode("utf-8", errors="replace") if isinstance(output, bytes) else output
    text = text.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        rows = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        rows = []
        for line in text.splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise OpsError("compose_status_invalid", "Compose 状态不是合法 JSON。") from exc
            if not isinstance(value, dict):
                raise OpsError("compose_status_invalid", "Compose 状态行不是对象。")
            rows.append(value)
    if not all(isinstance(row, dict) for row in rows):
        raise OpsError("compose_status_invalid", "Compose 状态不是对象列表。")
    return rows


def compose_health(run_command: Callable[..., subprocess.CompletedProcess[bytes]] = run_fixed_command) -> dict[str, Any]:
    result = run_command(["docker", "compose", "ps", "--format", "json"], timeout_seconds=15.0)
    rows = parse_compose_status(result.stdout)
    by_service = {str(row.get("Service") or row.get("service") or ""): row for row in rows}
    alerts: list[dict[str, Any]] = []
    services: list[dict[str, Any]] = []
    for name in EXPECTED_SERVICES:
        row = by_service.get(name)
        if row is None:
            alerts.append({"code": "service_missing", "service": name})
            services.append({"service": name, "status": "missing"})
            continue
        state = str(row.get("State") or row.get("state") or "unknown").lower()
        health = str(row.get("Health") or row.get("health") or "").lower()
        status = "ok" if state == "running" and health not in {"unhealthy", "failed"} else "failed"
        services.append({"service": name, "state": state, "health": health or None, "status": status})
        if status != "ok":
            alerts.append({"code": "service_not_healthy", "service": name, "state": state, "health": health or None})
    return {"status": "ok" if not alerts else "failed", "services": services, "alerts": alerts}


def health_report(
    http_probe: Callable[[HealthTarget], dict[str, Any]] = probe_http,
    compose_probe: Callable[[], dict[str, Any]] = compose_health,
) -> dict[str, Any]:
    targets = [HealthTarget(name, url) for name, url in HEALTH_TARGETS]
    http_results = [http_probe(target) for target in targets]
    alerts = [{"code": "http_service_failed", **item} for item in http_results if item.get("status") != "ok"]
    try:
        compose = compose_probe()
        alerts.extend(compose.get("alerts", []))
    except OpsError as exc:
        compose = {"status": "failed", "alerts": [{"code": exc.code, "message": exc.message}]}
        alerts.extend(compose["alerts"])
    return {"generated_at": utc_now(), "status": "ok" if not alerts else "failed", "http": http_results, "compose": compose, "alerts": alerts}


def directory_size(root: Path, *, excluded_top_level: Iterable[str] = ()) -> int:
    if not root.exists():
        return 0
    excluded = set(excluded_top_level)
    total = 0
    for path in root.rglob("*"):
        if path.is_symlink():
            continue
        try:
            relative = path.relative_to(root)
            if relative.parts and relative.parts[0] in excluded:
                continue
            if path.is_file():
                total += path.stat().st_size
        except OSError as exc:
            raise OpsError("capacity_stat_failed", "读取容量统计路径失败。", {"path": str(path), "error_type": type(exc).__name__}) from exc
    return total


def capacity_report(root: Path = ROOT, *, min_free_bytes: int = 5 * 1024**3, max_artifacts_bytes: int = 20 * 1024**3, max_backups_bytes: int = 40 * 1024**3) -> dict[str, Any]:
    if any(not isinstance(value, int) or value < 0 for value in (min_free_bytes, max_artifacts_bytes, max_backups_bytes)):
        raise OpsError("capacity_limit_invalid", "容量门限必须是非负整数。")
    usage = shutil.disk_usage(root)
    projects_bytes = directory_size(root / "projects")
    artifacts_bytes = directory_size(root / "artifacts", excluded_top_level={"backups", "ops"})
    backups_bytes = directory_size(root / "artifacts" / "backups")
    alerts: list[dict[str, Any]] = []
    if usage.free < min_free_bytes:
        alerts.append({"code": "disk_free_below_limit", "free_bytes": usage.free, "minimum_bytes": min_free_bytes})
    if artifacts_bytes > max_artifacts_bytes:
        alerts.append({"code": "artifacts_over_limit", "size_bytes": artifacts_bytes, "maximum_bytes": max_artifacts_bytes})
    if backups_bytes > max_backups_bytes:
        alerts.append({"code": "backups_over_limit", "size_bytes": backups_bytes, "maximum_bytes": max_backups_bytes})
    return {
        "generated_at": utc_now(), "status": "ok" if not alerts else "failed", "alerts": alerts,
        "disk": {"total_bytes": usage.total, "used_bytes": usage.used, "free_bytes": usage.free, "minimum_free_bytes": min_free_bytes},
        "directories": {"projects_bytes": projects_bytes, "artifacts_bytes": artifacts_bytes, "backups_bytes": backups_bytes},
    }


def _iter_archive_paths(source: Path, excluded_top_level: set[str]) -> Iterable[tuple[Path, Path]]:
    if not source.is_dir():
        raise OpsError("backup_source_missing", "备份源目录不存在。", {"path": str(source)})
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise OpsError("backup_symlink_rejected", "备份源包含不允许的符号链接。", {"path": str(path)})
        relative = path.relative_to(source)
        if relative.parts and relative.parts[0] in excluded_top_level:
            continue
        yield path, Path(source.name) / relative


def archive_directory(source: Path, destination: Path, *, excluded_top_level: set[str] | None = None) -> None:
    excluded = excluded_top_level or set()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(destination, "w:gz") as archive:
        archive.add(source, arcname=source.name, recursive=False)
        for path, archive_name in _iter_archive_paths(source, excluded):
            archive.add(path, arcname=str(archive_name), recursive=False)


def _validated_identifier(value: str, field: str) -> str:
    if not IDENTIFIER_RE.fullmatch(value):
        raise OpsError("database_identifier_invalid", f"{field} 不是合法数据库标识符。")
    return value


def dump_database(run_command: Callable[..., subprocess.CompletedProcess[bytes]] = run_fixed_command) -> bytes:
    user = _validated_identifier(os.environ.get("POSTGRES_USER", "research"), "POSTGRES_USER")
    database = _validated_identifier(os.environ.get("POSTGRES_DB", "research_os"), "POSTGRES_DB")
    result = run_command(["docker", "compose", "exec", "-T", "postgres", "pg_dump", "-U", user, "-d", database], timeout_seconds=180.0)
    if not result.stdout:
        raise OpsError("database_dump_empty", "PostgreSQL dump 为空。")
    return result.stdout


def archive_named_volume(volume_name: str, destination: Path, run_command: Callable[..., subprocess.CompletedProcess[bytes]] = run_fixed_command) -> None:
    if volume_name not in VOLUME_NAMES:
        raise OpsError("volume_not_allowlisted", "命名 volume 不在固定备份白名单中。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "docker", "run", "--rm", "-v", f"research-os_{volume_name}:/source:ro",
        "-v", f"{destination.parent.resolve()}:/backup", VOLUME_ARCHIVE_IMAGE,
        "tar", "-czf", f"/backup/{destination.name}", "-C", "/source", ".",
    ]
    run_command(command, timeout_seconds=300.0)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise OpsError("volume_backup_missing", "命名 volume 备份未生成。", {"volume": volume_name})


def _file_records(root: Path) -> list[dict[str, Any]]:
    records = []
    for path in sorted(root.iterdir()):
        if path.is_file():
            records.append({"name": path.name, "size_bytes": path.stat().st_size, "sha256": sha256_file(path)})
    return records


def create_backup_snapshot(
    *,
    root: Path = ROOT,
    backup_root: Path = BACKUP_ROOT,
    database_dump: bytes,
    volume_archives: dict[str, Callable[[Path], None]] | None = None,
    timestamp: str | None = None,
) -> Path:
    backup_id = timestamp or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if not BACKUP_ID_RE.fullmatch(backup_id):
        raise OpsError("backup_id_invalid", "备份 ID 格式非法。")
    target = backup_root / backup_id
    if target.exists():
        raise OpsError("backup_exists", "目标备份目录已存在。", {"backup_id": backup_id})
    target.mkdir(parents=True)
    try:
        (target / "postgres.sql").write_bytes(database_dump)
        archive_directory(root / "projects", target / "projects.tgz")
        archive_directory(root / "artifacts", target / "artifacts.tgz", excluded_top_level={"backups", "ops"})
        for volume_name in VOLUME_NAMES:
            if volume_archives and volume_name in volume_archives:
                volume_archives[volume_name](target / f"{volume_name}.tgz")
        manifest = {
            "format": "research-os-backup-v1", "backup_id": backup_id, "created_at": utc_now(),
            "live_data_untouched": True, "files": _file_records(target),
            "included_volumes": sorted(volume_archives or {}),
        }
        write_json(target / "manifest.json", manifest)
        return target
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise


def rotate_backups(backup_root: Path = BACKUP_ROOT, *, retention: int = 7) -> dict[str, Any]:
    if not 1 <= retention <= 365:
        raise OpsError("retention_invalid", "备份保留数量必须介于 1 和 365 之间。")
    candidates = [path for path in backup_root.iterdir() if path.is_dir() and BACKUP_ID_RE.fullmatch(path.name) and (path / "manifest.json").is_file()] if backup_root.exists() else []
    candidates.sort(key=lambda path: path.name, reverse=True)
    removed = []
    for path in candidates[retention:]:
        shutil.rmtree(path)
        removed.append(path.name)
    return {"status": "ok", "retention": retention, "kept": [path.name for path in candidates[:retention]], "removed": removed}


def _safe_extract(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if member.issym() or member.islnk() or not (member.isdir() or member.isreg()):
                raise OpsError("restore_member_rejected", "恢复归档包含不允许的文件类型。", {"archive": archive_path.name, "member": member.name})
            member_path = (destination / member.name).resolve()
            if destination.resolve() not in member_path.parents and member_path != destination.resolve():
                raise OpsError("restore_path_traversal", "恢复归档包含越界路径。", {"member": member.name})
            if member.isdir():
                member_path.mkdir(parents=True, exist_ok=True)
                continue
            member_path.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise OpsError("restore_member_unreadable", "恢复归档成员不可读。", {"member": member.name})
            with member_path.open("wb") as target:
                shutil.copyfileobj(source, target)


def rehearse_restore(snapshot: Path, rehearsal_root: Path, *, compose_check: Callable[[], None] | None = None) -> dict[str, Any]:
    manifest_path = snapshot / "manifest.json"
    if not manifest_path.is_file():
        raise OpsError("backup_manifest_missing", "备份 manifest 不存在。")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "research-os-backup-v1":
        raise OpsError("backup_format_invalid", "备份格式版本不受支持。")
    for record in manifest.get("files", []):
        path = snapshot / str(record.get("name", ""))
        if not path.is_file() or path.stat().st_size != int(record.get("size_bytes", -1)) or sha256_file(path) != record.get("sha256"):
            raise OpsError("backup_hash_mismatch", "备份文件 SHA-256 校验失败。", {"name": record.get("name")})
    if compose_check:
        compose_check()
    rehearsal_root.parent.mkdir(parents=True, exist_ok=True)
    rehearsal_root.mkdir(exist_ok=False)
    try:
        _safe_extract(snapshot / "projects.tgz", rehearsal_root)
        _safe_extract(snapshot / "artifacts.tgz", rehearsal_root)
        for volume_name in manifest.get("included_volumes", []):
            _safe_extract(snapshot / f"{volume_name}.tgz", rehearsal_root / "volumes" / volume_name)
        result = {"status": "ok", "backup_id": manifest["backup_id"], "restored_to": str(rehearsal_root), "live_data_untouched": True, "compose_config_validated": bool(compose_check)}
        write_json(rehearsal_root / "rehearsal.json", result)
        return result
    except Exception:
        shutil.rmtree(rehearsal_root, ignore_errors=True)
        raise


def cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Research OS fixed-scope operations guard")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health", help="write a structured health snapshot")
    capacity = sub.add_parser("capacity", help="check fixed workspace capacity limits")
    capacity.add_argument("--min-free-bytes", type=int, default=5 * 1024**3)
    capacity.add_argument("--max-artifacts-bytes", type=int, default=20 * 1024**3)
    capacity.add_argument("--max-backups-bytes", type=int, default=40 * 1024**3)
    backup = sub.add_parser("backup", help="create and rotate a complete local backup")
    backup.add_argument("--retention", type=int, default=7)
    rehearse = sub.add_parser("rehearse", help="restore a backup into an isolated rehearsal directory")
    rehearse.add_argument("snapshot_id")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = cli_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "health":
            result = health_report()
            write_json(OPS_ROOT / "health" / "latest.json", result)
        elif args.command == "capacity":
            result = capacity_report(min_free_bytes=args.min_free_bytes, max_artifacts_bytes=args.max_artifacts_bytes, max_backups_bytes=args.max_backups_bytes)
            write_json(OPS_ROOT / "capacity" / "latest.json", result)
        elif args.command == "backup":
            volume_archives = {name: (lambda target, volume=name: archive_named_volume(volume, target)) for name in VOLUME_NAMES}
            target = create_backup_snapshot(database_dump=dump_database(), volume_archives=volume_archives)
            result = {"status": "ok", "backup_id": target.name, "path": str(target), "rotation": rotate_backups(retention=args.retention)}
        else:
            if not BACKUP_ID_RE.fullmatch(args.snapshot_id):
                raise OpsError("backup_id_invalid", "恢复演练只接受固定格式的备份 ID。")
            snapshot = BACKUP_ROOT / args.snapshot_id
            rehearsal = OPS_ROOT / "rehearsals" / f"{args.snapshot_id}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
            result = rehearse_restore(snapshot, rehearsal, compose_check=lambda: run_fixed_command(["docker", "compose", "config", "--quiet"], timeout_seconds=30.0))
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if result.get("status") == "ok" else 2
    except OpsError as exc:
        print(json.dumps({"status": "failed", "error": exc.as_dict()}, ensure_ascii=False, sort_keys=True))
        return 2
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "failed", "error": {"code": "ops_unexpected", "message": type(exc).__name__}}, ensure_ascii=False, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
