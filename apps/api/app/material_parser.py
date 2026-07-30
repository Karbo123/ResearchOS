"""Bounded, non-executing parsers for user-provided research materials."""

from __future__ import annotations

import csv
import json
import mimetypes
import struct
import zipfile
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
import pytesseract


MAX_EXTRACTED_CHARS = 120_000
MAX_CONTEXT_CHARS = 12_000
MAX_TOTAL_CONTEXT_CHARS = 48_000
MAX_OCR_SECONDS = 20
MAX_PDF_PAGES = 200
MAX_PREVIEW_ROWS = 100
MAX_PREVIEW_ITEMS = 100
MAX_ZIP_ENTRIES = 500
MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_ZIP_COMPRESSION_RATIO = 100
PARSER_VERSION = "material-parser-2"


class MaterialParseError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def _truncate(value: str, limit: int = MAX_EXTRACTED_CHARS) -> tuple[str, bool]:
    if len(value) <= limit:
        return value, False
    return value[:limit], True


def _safe_json_preview(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "<depth-limit>"
    if isinstance(value, dict):
        return {str(key)[:200]: _safe_json_preview(item, depth + 1) for key, item in list(value.items())[:MAX_PREVIEW_ITEMS]}
    if isinstance(value, list):
        return [_safe_json_preview(item, depth + 1) for item in value[:MAX_PREVIEW_ITEMS]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:2000]
    return str(value)[:2000]


def _image_dimensions(path: Path) -> tuple[str, int, int]:
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return "png", width, height
    if data.startswith(b"GIF8") and len(data) >= 10:
        width, height = struct.unpack("<HH", data[6:10])
        return "gif", width, height
    if data.startswith(b"\xff\xd8"):
        index = 2
        sof_markers = set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0))
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(data):
                break
            segment_length = struct.unpack(">H", data[index:index + 2])[0]
            if segment_length < 2 or index + segment_length > len(data):
                break
            if marker in sof_markers and segment_length >= 7:
                height, width = struct.unpack(">HH", data[index + 3:index + 7])
                return "jpeg", width, height
            index += segment_length
    raise MaterialParseError("invalid_image", "图片格式或图片头无效。")


def _parse_image(path: Path) -> dict[str, Any]:
    kind, width, height = _image_dimensions(path)
    if width <= 0 or height <= 0 or width * height > 100_000_000:
        raise MaterialParseError("image_dimension_limit", "图片尺寸超过安全上限。")
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.width != width or image.height != height:
                raise MaterialParseError("image_metadata_mismatch", "图片头信息与解码尺寸不一致。")
            text = pytesseract.image_to_string(image, lang="eng+chi_sim", config="--psm 6", timeout=MAX_OCR_SECONDS)
    except MaterialParseError:
        raise
    except (UnidentifiedImageError, OSError) as exc:
        raise MaterialParseError("invalid_image", "图片无法安全解码。") from exc
    except (pytesseract.TesseractError, RuntimeError) as exc:
        raise MaterialParseError("image_ocr_failed", "图片 OCR 失败，已阻止材料进入模型上下文。") from exc
    extracted, truncated = _truncate(text)
    return {
        "kind": "image", "parse_status": "parsed", "image_format": kind,
        "width": width, "height": height, "ocr_performed": True,
        "ocr_text": extracted, "ocr_truncated": truncated,
    }


def _parse_pdf(path: Path) -> dict[str, Any]:
    try:
        reader = PdfReader(str(path), strict=False)
        if len(reader.pages) > MAX_PDF_PAGES:
            raise MaterialParseError("pdf_page_limit", "PDF 页数超过受限解析上限。")
        pages: list[dict[str, Any]] = []
        chunks: list[str] = []
        remaining = MAX_EXTRACTED_CHARS
        truncated = False
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            page_text, was_truncated = _truncate(text, min(20_000, max(0, remaining)))
            truncated = truncated or was_truncated
            pages.append({"page": index + 1, "text": page_text})
            chunks.append(f"[page {index + 1}]\n{page_text}")
            remaining -= len(page_text)
            if remaining <= 0:
                truncated = True
                break
        extracted, _ = _truncate("\n\n".join(chunks))
        return {"kind": "pdf", "parse_status": "parsed", "page_count": len(reader.pages), "text": extracted, "pages": pages, "truncated": truncated}
    except MaterialParseError:
        raise
    except Exception as exc:
        raise MaterialParseError("invalid_pdf", "PDF 无法安全解析。") from exc


def _parse_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MaterialParseError("invalid_json", "JSON 文件必须是有效的 UTF-8 JSON。") from exc
    return {"kind": "json", "parse_status": "parsed", "value_type": type(value).__name__, "keys": list(value.keys())[:MAX_PREVIEW_ITEMS] if isinstance(value, dict) else [], "preview": _safe_json_preview(value)}


def _parse_csv(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            headers = [str(item)[:200] for item in (reader.fieldnames or [])]
            rows = []
            for index, row in enumerate(reader):
                if index >= MAX_PREVIEW_ROWS:
                    break
                rows.append({str(key)[:200]: str(value or "")[:2000] for key, value in row.items()})
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise MaterialParseError("invalid_csv", "CSV 文件必须是有效的 UTF-8 文本表格。") from exc
    return {"kind": "csv", "parse_status": "parsed", "columns": headers, "preview_rows": rows, "preview_row_count": len(rows), "preview_truncated": len(rows) >= MAX_PREVIEW_ROWS}


def _parse_text(path: Path, kind: str) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        if b"\x00" in raw[:1_048_576]:
            raise MaterialParseError("binary_text", "文本或代码材料包含二进制内容，已拒绝解析。")
        text = raw.decode("utf-8-sig")
    except MaterialParseError:
        raise
    except (OSError, UnicodeDecodeError) as exc:
        raise MaterialParseError("invalid_utf8_text", "文本或代码材料必须是有效的 UTF-8。") from exc
    extracted, truncated = _truncate(text)
    return {"kind": kind, "parse_status": "parsed", "text": extracted, "line_count": text.count("\n") + (1 if text else 0), "truncated": truncated}


def _parse_zip(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                raise MaterialParseError("zip_entry_limit", "压缩包条目数量超过安全上限。")
            total_size = 0
            names = []
            for info in infos:
                name = info.filename.replace("\\", "/")
                if name.startswith("/") or ".." in Path(name).parts:
                    raise MaterialParseError("zip_path_traversal", "压缩包包含不安全的路径。")
                if info.is_dir():
                    continue
                total_size += info.file_size
                names.append(name[:500])
                if info.compress_size and info.file_size / info.compress_size > MAX_ZIP_COMPRESSION_RATIO:
                    raise MaterialParseError("zip_compression_ratio", "压缩包压缩比超过安全上限。")
                if total_size > MAX_ZIP_UNCOMPRESSED_BYTES:
                    raise MaterialParseError("zip_uncompressed_limit", "压缩包声明的解压大小超过安全上限。")
    except MaterialParseError:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise MaterialParseError("invalid_zip", "压缩包无法安全读取。") from exc
    return {"kind": "archive", "parse_status": "parsed_manifest_only", "entry_count": len(infos), "uncompressed_bytes": total_size, "entries": names, "extraction_performed": False, "note": "为避免路径穿越和压缩炸弹，系统只读取压缩包清单，不执行或解压其中内容。"}


def parse_material(path: Path, name: str, mime_type: str) -> dict[str, Any]:
    """Parse one already size-limited upload without executing or extracting code."""
    suffix = Path(name).suffix.lower()
    mime = (mime_type or mimetypes.guess_type(name)[0] or "").lower()
    if suffix == ".pdf" or mime == "application/pdf":
        result = _parse_pdf(path)
    elif suffix == ".json" or mime == "application/json":
        result = _parse_json(path)
    elif suffix in {".csv", ".tsv"} or mime in {"text/csv", "text/tab-separated-values"}:
        result = _parse_csv(path)
    elif suffix in {".png", ".jpg", ".jpeg", ".gif"} or mime.startswith("image/"):
        result = _parse_image(path)
    elif suffix == ".zip" or mime == "application/zip":
        result = _parse_zip(path)
    else:
        code_suffixes = {".py", ".cpp", ".cc", ".c", ".h", ".hpp", ".js", ".ts", ".java", ".rs", ".go", ".sql", ".tex", ".md"}
        result = _parse_text(path, "code" if suffix in code_suffixes else "text")
    result["parser_version"] = PARSER_VERSION
    return result


def context_for_materials(
    records: list[dict[str, Any]],
    per_material_limit: int = MAX_CONTEXT_CHARS,
    total_limit: int = MAX_TOTAL_CONTEXT_CHARS,
) -> list[dict[str, Any]]:
    """Return bounded model context; never include raw paths or credentials."""
    context: list[dict[str, Any]] = []
    remaining = total_limit
    for record in records:
        if remaining <= 0:
            break
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
        item = {"id": str(record.get("id")), "name": str(record.get("name", ""))[:255], "mime_type": str(record.get("mime_type", ""))[:120], "sha256": str(record.get("sha256", "")), "kind": metadata.get("kind"), "parse_status": metadata.get("parse_status"), "parser_version": metadata.get("parser_version")}
        if isinstance(metadata.get("text"), str):
            item["text"] = metadata["text"][:min(per_material_limit, remaining)]
        elif metadata.get("kind") in {"json", "csv"}:
            item["preview"] = _safe_json_preview(metadata.get("preview", metadata.get("preview_rows", [])))
        elif metadata.get("kind") == "image" and isinstance(metadata.get("ocr_text"), str):
            item["ocr_text"] = metadata["ocr_text"][:min(per_material_limit, remaining)]
        else:
            for key in ("page_count", "columns", "preview_row_count", "width", "height", "note"):
                if key in metadata:
                    item[key] = metadata[key]
        serialized = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if len(serialized) > remaining:
            item = {
                "id": item["id"],
                "name": item["name"],
                "mime_type": item["mime_type"],
                "sha256": item["sha256"],
                "kind": item.get("kind"),
                "parse_status": item.get("parse_status"),
                "parser_version": item.get("parser_version"),
                "truncated": True,
            }
            serialized = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if len(serialized) > remaining:
            break
        remaining -= len(serialized)
        context.append(item)
    return context
