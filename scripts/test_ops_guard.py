import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from ops_guard import (
    HealthTarget,
    _safe_extract,
    capacity_report,
    compose_health,
    create_backup_snapshot,
    health_report,
    parse_compose_status,
    rehearse_restore,
    rotate_backups,
    write_json,
)


class OpsGuardTests(unittest.TestCase):
    def test_compose_json_lines_are_parsed_and_unhealthy_service_is_alerted(self):
        rows = parse_compose_status('{"Service":"api","State":"running"}\n{"Service":"postgres","State":"running","Health":"healthy"}')
        self.assertEqual(len(rows), 2)
        result = compose_health(lambda *_args, **_kwargs: type("Result", (), {"stdout": json.dumps(rows).encode()})())
        self.assertEqual(result["status"], "failed")
        self.assertTrue(any(item["code"] == "service_missing" for item in result["alerts"]))

    def test_health_report_returns_structured_failed_alert_without_fallback(self):
        def probe(target: HealthTarget):
            return {"name": target.name, "url": target.url, "status": "failed", "error_code": "health_unreachable"}

        result = health_report(probe, lambda: {"status": "ok", "alerts": []})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(len(result["alerts"]), 3)

    def test_capacity_report_has_fixed_directory_limits(self):
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            (root / "projects").mkdir()
            (root / "artifacts" / "backups").mkdir(parents=True)
            (root / "artifacts" / "result.bin").write_bytes(b"123456")
            (root / "artifacts" / "backups" / "old.tgz").write_bytes(b"123456789")
            result = capacity_report(root, min_free_bytes=0, max_artifacts_bytes=5, max_backups_bytes=8)
            codes = {item["code"] for item in result["alerts"]}
            self.assertEqual(result["status"], "failed")
            self.assertIn("artifacts_over_limit", codes)
            self.assertIn("backups_over_limit", codes)

    def test_capacity_report_rejects_negative_limits(self):
        with self.assertRaisesRegex(Exception, "非负整数"):
            capacity_report(Path(tempfile.gettempdir()), min_free_bytes=-1)

    def test_backup_hash_and_isolated_restore_rehearsal(self):
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            (root / "projects" / "demo").mkdir(parents=True)
            (root / "projects" / "demo" / "README.md").write_text("project", encoding="utf-8")
            (root / "artifacts" / "run").mkdir(parents=True)
            (root / "artifacts" / "run" / "metrics.json").write_text("{}", encoding="utf-8")
            backup_root = root / "backups"
            snapshot = create_backup_snapshot(
                root=root, backup_root=backup_root, database_dump=b"CREATE TABLE audit_events;", timestamp="20260731T010203Z"
            )
            self.assertTrue((snapshot / "manifest.json").is_file())
            rehearsal_root = root / "rehearsal" / "restore"
            result = rehearse_restore(snapshot, rehearsal_root, compose_check=lambda: None)
            self.assertEqual(result["status"], "ok")
            self.assertEqual((rehearsal_root / "projects" / "demo" / "README.md").read_text(encoding="utf-8"), "project")
            self.assertTrue((rehearsal_root / "artifacts" / "run" / "metrics.json").is_file())
            self.assertTrue(result["live_data_untouched"])

    def test_rotation_keeps_only_newest_allowlisted_backup_directories(self):
        with tempfile.TemporaryDirectory() as raw_root:
            backup_root = Path(raw_root)
            for backup_id in ("20260729T010203Z", "20260730T010203Z", "20260731T010203Z"):
                target = backup_root / backup_id
                target.mkdir()
                write_json(target / "manifest.json", {"format": "research-os-backup-v1"})
            result = rotate_backups(backup_root, retention=2)
            self.assertEqual(result["kept"], ["20260731T010203Z", "20260730T010203Z"])
            self.assertEqual(result["removed"], ["20260729T010203Z"])
            self.assertFalse((backup_root / "20260729T010203Z").exists())

    def test_restore_rejects_path_traversal_member(self):
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            archive_path = root / "unsafe.tgz"
            with tarfile.open(archive_path, "w:gz") as archive:
                payload = b"do not restore"
                info = tarfile.TarInfo("../outside.txt")
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            with self.assertRaisesRegex(Exception, "越界路径"):
                _safe_extract(archive_path, root / "restore")


if __name__ == "__main__":
    unittest.main()
