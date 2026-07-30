from __future__ import annotations

import asyncio
from contextlib import contextmanager
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import app.main as main
from app.models import UploadedFile


class _FakeSession:
    def __init__(self, conversation):
        self.conversation = conversation
        self.added = []

    def scalar(self, _statement):
        return self.conversation

    def execute(self, _statement):
        return SimpleNamespace(one=lambda: (0, 0))

    def add(self, value):
        self.added.append(value)

    def flush(self):
        for value in self.added:
            if isinstance(value, UploadedFile) and value.id is None:
                value.id = uuid4()


def _session_scope(fake_session):
    @contextmanager
    def scope():
        yield fake_session

    return scope


def _upload(data: bytes = b"safe research text\n", filename: str = "notes.txt", mime: str = "text/plain"):
    return UploadFile(
        file=BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": mime}),
    )


def _conversation(session_id):
    return SimpleNamespace(id=session_id, project_id=None)


def _assert_no_uploaded_files(root):
    assert not [path for path in root.rglob("*") if path.is_file()]


def test_upload_scans_parses_and_persists_only_clean_material(monkeypatch, tmp_path):
    session_id = uuid4()
    fake_session = _FakeSession(_conversation(session_id))
    monkeypatch.setattr(main, "ARTIFACTS_ROOT", tmp_path)
    monkeypatch.setattr(main, "session_scope", _session_scope(fake_session))
    monkeypatch.setattr(main, "scan_file", lambda path: {"status": "clean", "engine": "test"})
    monkeypatch.setattr(main, "parse_material", lambda path, name, mime: {
        "kind": "text", "parse_status": "parsed", "parser_version": "test",
    })
    monkeypatch.setattr(main, "audit", lambda *_args, **_kwargs: None)

    result = asyncio.run(main.upload(session_id, _upload(filename="../../notes.txt")))

    assert result["name"] == "notes.txt"
    assert result["malware_scan"] == "clean"
    assert result["parse_status"] == "parsed"
    assert len(fake_session.added) == 1
    stored = fake_session.added[0]
    assert stored.name == "notes.txt"
    assert stored.relative_path.startswith(f"inbox/{session_id}/")
    assert (tmp_path / stored.relative_path).is_file()


@pytest.mark.parametrize(
    ("failure", "expected_code"),
    [
        ("scan", "malware_scan_failed"),
        ("parse", "material_parse_failed"),
    ],
)
def test_upload_failure_removes_file_before_returning_structured_error(monkeypatch, tmp_path, failure, expected_code):
    session_id = uuid4()
    fake_session = _FakeSession(_conversation(session_id))
    monkeypatch.setattr(main, "ARTIFACTS_ROOT", tmp_path)
    monkeypatch.setattr(main, "session_scope", _session_scope(fake_session))
    if failure == "scan":
        monkeypatch.setattr(main, "scan_file", lambda _path: (_ for _ in ()).throw(RuntimeError("scanner crashed")))
        monkeypatch.setattr(main, "parse_material", lambda *_args: pytest.fail("parser must not run after scan failure"))
    else:
        monkeypatch.setattr(main, "scan_file", lambda _path: {"status": "clean"})
        monkeypatch.setattr(main, "parse_material", lambda *_args: (_ for _ in ()).throw(RuntimeError("parser crashed")))

    with pytest.raises(HTTPException) as error:
        asyncio.run(main.upload(session_id, _upload()))

    assert error.value.status_code == 422
    assert error.value.detail["code"] == expected_code
    assert fake_session.added == []
    _assert_no_uploaded_files(tmp_path)


def test_upload_quota_failure_removes_scanned_and_parsed_file(monkeypatch, tmp_path):
    session_id = uuid4()
    fake_session = _FakeSession(_conversation(session_id))
    monkeypatch.setattr(main, "ARTIFACTS_ROOT", tmp_path)
    monkeypatch.setattr(main, "session_scope", _session_scope(fake_session))
    monkeypatch.setattr(main, "scan_file", lambda _path: {"status": "clean"})
    monkeypatch.setattr(main, "parse_material", lambda *_args: {"kind": "text", "parse_status": "parsed"})
    monkeypatch.setattr(main, "MATERIAL_MAX_SESSION_FILES", 0)

    with pytest.raises(HTTPException) as error:
        asyncio.run(main.upload(session_id, _upload()))

    assert error.value.status_code == 413
    assert error.value.detail["code"] == "material_session_quota_exceeded"
    assert fake_session.added == []
    _assert_no_uploaded_files(tmp_path)


def test_upload_rejects_disallowed_mime_without_creating_storage(monkeypatch, tmp_path):
    session_id = uuid4()
    monkeypatch.setattr(main, "ARTIFACTS_ROOT", tmp_path)

    with pytest.raises(HTTPException) as error:
        asyncio.run(main.upload(session_id, _upload(data=b"binary", filename="payload.exe", mime="application/x-msdownload")))

    assert error.value.status_code == 415
    assert not [path for path in tmp_path.rglob("*") if path.is_file()]
