from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import app.main as main
from app.material_parser import MaterialSearchError, search_material_records


def test_material_search_is_deterministic_and_marks_context_unverified():
    records = [
        {
            "id": "b",
            "name": "methods.txt",
            "mime_type": "text/plain",
            "size_bytes": 20,
            "sha256": "b" * 64,
            "metadata": {"kind": "text", "parse_status": "parsed", "text": "alpha method alpha"},
        },
        {
            "id": "a",
            "name": "notes.csv",
            "mime_type": "text/csv",
            "size_bytes": 20,
            "sha256": "a" * 64,
            "metadata": {"kind": "csv", "parse_status": "parsed", "preview_rows": [{"topic": "alpha"}]},
        },
        {
            "id": "c",
            "name": "unrelated.txt",
            "mime_type": "text/plain",
            "size_bytes": 20,
            "sha256": "c" * 64,
            "metadata": {"kind": "text", "parse_status": "parsed", "text": "beta"},
        },
    ]

    result = search_material_records(records, "alpha", limit=1)

    assert result["match_mode"] == "deterministic_lexical_metadata_only"
    assert result["evidence_status"] == "unverified_material_context"
    assert result["total_matches"] == 2
    assert result["next_offset"] == 1
    assert result["results"][0]["id"] == "b"
    assert result["results"][0]["evidence_status"] == "unverified_material_context"
    assert "relative_path" not in result["results"][0]


def test_material_search_does_not_index_internal_path_metadata():
    result = search_material_records([{
        "id": "path-record",
        "name": "notes.txt",
        "mime_type": "text/plain",
        "size_bytes": 10,
        "sha256": "a" * 64,
        "metadata": {
            "kind": "text",
            "parse_status": "parsed",
            "text": "visible alpha",
            "relative_path": "inbox/private/secret.txt",
        },
    }], "secret")

    assert result["total_matches"] == 0


@pytest.mark.parametrize("query", ["", "   ", "\x00"])
def test_material_search_rejects_empty_or_invalid_queries(query):
    with pytest.raises(MaterialSearchError):
        search_material_records([], query)


def test_project_material_search_is_scoped_to_project(monkeypatch):
    project_id = uuid4()
    records = [SimpleNamespace(
        id=uuid4(), name="notes.txt", mime_type="text/plain", size_bytes=10,
        sha256="a" * 64, metadata_json={"kind": "text", "parse_status": "parsed", "text": "alpha"},
    )]

    class FakeSession:
        def get(self, model, identifier):
            return SimpleNamespace(id=identifier)

        def scalars(self, statement):
            return SimpleNamespace(all=lambda: records)

    @contextmanager
    def fake_scope():
        yield FakeSession()

    monkeypatch.setattr(main, "session_scope", fake_scope)
    result = main.search_project_materials(project_id, "alpha", limit=20, offset=0)

    assert result["project_id"] == str(project_id)
    assert result["total_matches"] == 1
    assert result["results"][0]["name"] == "notes.txt"


def test_project_material_search_returns_structured_not_found(monkeypatch):
    project_id = uuid4()

    class FakeSession:
        def get(self, model, identifier):
            return None

    @contextmanager
    def fake_scope():
        yield FakeSession()

    monkeypatch.setattr(main, "session_scope", fake_scope)
    with pytest.raises(HTTPException) as error:
        main.search_project_materials(project_id, "alpha", limit=20, offset=0)

    assert error.value.status_code == 404
    assert error.value.detail["code"] == "project_not_found"
