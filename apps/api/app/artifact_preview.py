"""Bounded, non-executing previews for persisted research artifacts."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any, BinaryIO

from pypdf import PdfReader


MAX_POINT_COUNT = 20_000
MAX_FACE_COUNT = 10_000
MAX_POINT_SCAN_BYTES = 512 * 1024 * 1024
MAX_TEXT_CHARS = 24_000
MAX_TABLE_ROWS = 200
MAX_TABLE_COLUMNS = 50
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_PREVIEW_HEADER_BYTES = 1 * 1024 * 1024


class ArtifactPreviewError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def _bounded_json(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "<depth-limit>"
    if isinstance(value, dict):
        return {str(key)[:200]: _bounded_json(item, depth + 1) for key, item in list(value.items())[:200]}
    if isinstance(value, list):
        return [_bounded_json(item, depth + 1) for item in value[:200]]
    if isinstance(value, str):
        return value[:4_000]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:4_000]


def _read_text(path: Path, *, limit: int = MAX_TEXT_CHARS) -> tuple[str, bool]:
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise ArtifactPreviewError("artifact_preview_read_failed", "Artifact preview is not valid UTF-8 text.") from exc
    return text[:limit], len(text) > limit


def _point_values(parts: list[str], indexes: tuple[int, int, int]) -> list[float] | None:
    try:
        values = [float(parts[index]) for index in indexes]
    except (IndexError, TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in values):
        return None
    return values


def _parse_ply(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            header: list[str] = []
            header_bytes = 0
            while True:
                line = handle.readline()
                if not line:
                    raise ArtifactPreviewError("ply_header_invalid", "PLY header has no end_header marker.")
                header_bytes += len(line)
                if header_bytes > MAX_PREVIEW_HEADER_BYTES:
                    raise ArtifactPreviewError("ply_header_too_large", "PLY header exceeds the preview limit.")
                decoded = line.decode("ascii", errors="strict").strip()
                header.append(decoded)
                if decoded == "end_header":
                    break
            if not header or header[0] != "ply":
                raise ArtifactPreviewError("ply_header_invalid", "File is not a valid PLY artifact.")
            if not any(line == "format ascii 1.0" for line in header):
                raise ArtifactPreviewError("ply_binary_unsupported", "Only ASCII PLY artifacts can be previewed.")
            vertex_count = 0
            face_count = 0
            property_names: list[str] = []
            current_element = None
            for line in header:
                parts = line.split()
                if len(parts) >= 3 and parts[0] == "element":
                    current_element = parts[1]
                    try:
                        count = int(parts[2])
                    except ValueError as exc:
                        raise ArtifactPreviewError("ply_header_invalid", "PLY element count is invalid.") from exc
                    if current_element == "vertex":
                        vertex_count = count
                    elif current_element == "face":
                        face_count = count
                elif len(parts) >= 3 and parts[0] == "property" and current_element == "vertex":
                    if parts[1] != "list":
                        property_names.append(parts[-1])
            indexes = tuple(property_names.index(axis) for axis in ("x", "y", "z"))
            stride = max(1, math.ceil(max(vertex_count, 1) / MAX_POINT_COUNT))
            points: list[list[float]] = []
            for index in range(vertex_count):
                if handle.tell() > MAX_POINT_SCAN_BYTES:
                    raise ArtifactPreviewError("point_cloud_scan_limit", "PLY preview scan exceeded the fixed byte limit.")
                parts = handle.readline().decode("utf-8", errors="strict").strip().split()
                if index % stride == 0:
                    point = _point_values(parts, indexes)
                    if point is not None:
                        points.append(point)
            faces: list[list[int]] = []
            if face_count and stride == 1 and face_count <= MAX_FACE_COUNT:
                for _ in range(face_count):
                    parts = handle.readline().decode("utf-8", errors="strict").strip().split()
                    try:
                        count = int(parts[0])
                        face = [int(value) for value in parts[1:count + 1]]
                    except (IndexError, ValueError) as exc:
                        raise ArtifactPreviewError("ply_face_invalid", "PLY face data is invalid.") from exc
                    if len(face) >= 3 and all(0 <= value < len(points) for value in face):
                        faces.append(face)
    except ArtifactPreviewError:
        raise
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise ArtifactPreviewError("ply_parse_failed", "PLY artifact cannot be safely previewed.") from exc
    return {
        "type": "point_cloud", "format": "ply", "points": points, "faces": faces,
        "source_point_count": vertex_count, "sampled": stride > 1,
        "source_face_count": face_count,
    }


def _parse_pcd(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            header: list[str] = []
            header_bytes = 0
            while True:
                line = handle.readline()
                if not line:
                    raise ArtifactPreviewError("pcd_header_invalid", "PCD header has no DATA marker.")
                header_bytes += len(line)
                if header_bytes > MAX_PREVIEW_HEADER_BYTES:
                    raise ArtifactPreviewError("pcd_header_too_large", "PCD header exceeds the preview limit.")
                decoded = line.decode("ascii", errors="strict").strip()
                header.append(decoded)
                if decoded.upper().startswith("DATA "):
                    break
            values: dict[str, list[str]] = {}
            for line in header:
                parts = line.split()
                if parts:
                    values[parts[0].upper()] = parts[1:]
            if (values.get("DATA") or [""])[0].lower() != "ascii":
                raise ArtifactPreviewError("pcd_binary_unsupported", "Only ASCII PCD artifacts can be previewed.")
            fields = values.get("FIELDS", [])
            indexes = tuple(fields.index(axis) for axis in ("x", "y", "z"))
            point_count = int((values.get("POINTS") or ["0"])[0])
            if point_count <= 0:
                width = int((values.get("WIDTH") or ["0"])[0])
                height = int((values.get("HEIGHT") or ["1"])[0])
                point_count = width * height
            stride = max(1, math.ceil(max(point_count, 1) / MAX_POINT_COUNT))
            points: list[list[float]] = []
            for index in range(point_count):
                if handle.tell() > MAX_POINT_SCAN_BYTES:
                    raise ArtifactPreviewError("point_cloud_scan_limit", "PCD preview scan exceeded the fixed byte limit.")
                parts = handle.readline().decode("utf-8", errors="strict").strip().split()
                if index % stride == 0:
                    point = _point_values(parts, indexes)
                    if point is not None:
                        points.append(point)
    except ArtifactPreviewError:
        raise
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise ArtifactPreviewError("pcd_parse_failed", "PCD artifact cannot be safely previewed.") from exc
    return {
        "type": "point_cloud", "format": "pcd", "points": points, "faces": [],
        "source_point_count": point_count, "sampled": stride > 1,
    }


def _parse_table(path: Path, suffix: str) -> dict[str, Any]:
    delimiter = "\t" if suffix == ".tsv" else ","
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle, delimiter=delimiter)
            rows = []
            for row_index, row in enumerate(reader):
                if row_index >= MAX_TABLE_ROWS:
                    break
                rows.append([str(value)[:2_000] for value in row[:MAX_TABLE_COLUMNS]])
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise ArtifactPreviewError("table_preview_failed", "Table artifact cannot be safely previewed.") from exc
    return {"type": "table", "format": suffix.lstrip("."), "rows": rows, "truncated": len(rows) >= MAX_TABLE_ROWS}


def _parse_pdf(path: Path) -> dict[str, Any]:
    try:
        reader = PdfReader(str(path), strict=False)
        text_parts: list[str] = []
        for page in reader.pages[:3]:
            text_parts.append(page.extract_text() or "")
        text = "\n\n".join(text_parts)
    except Exception as exc:
        raise ArtifactPreviewError("pdf_preview_failed", "PDF artifact cannot be safely previewed.") from exc
    return {"type": "pdf", "page_count": len(reader.pages), "text": text[:MAX_TEXT_CHARS], "truncated": len(text) > MAX_TEXT_CHARS}


def preview_artifact(path: Path, name: str, mime_type: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return JSON-safe preview data without executing artifact content."""
    suffix = Path(name).suffix.lower()
    mime = (mime_type or "").lower()
    if suffix == ".ply" or mime == "application/ply":
        return _parse_ply(path)
    if suffix == ".pcd" or mime == "text/pcd":
        return _parse_pcd(path)
    if suffix == ".pdf" or mime == "application/pdf":
        return _parse_pdf(path)
    if suffix in {".csv", ".tsv"} or mime in {"text/csv", "text/tab-separated-values"}:
        return _parse_table(path, suffix if suffix in {".csv", ".tsv"} else ".csv")
    if suffix in {".json", ".jsonl"} or mime == "application/json":
        try:
            if path.stat().st_size > MAX_JSON_BYTES:
                raise ArtifactPreviewError("json_preview_too_large", "JSON artifact exceeds the preview limit.")
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except ArtifactPreviewError:
            raise
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ArtifactPreviewError("json_preview_failed", "JSON artifact cannot be safely previewed.") from exc
        return {"type": "json", "value": _bounded_json(value)}
    if suffix in {".html", ".htm"} or mime == "text/html":
        text, truncated = _read_text(path)
        return {"type": "html_text", "text": text, "truncated": truncated, "executed": False}
    if mime.startswith("image/"):
        return {"type": "image", "executed": False}
    text, truncated = _read_text(path)
    return {"type": "text", "text": text, "truncated": truncated, "executed": False}
