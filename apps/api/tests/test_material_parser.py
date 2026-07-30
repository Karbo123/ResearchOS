import io
import json
import zipfile

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfWriter

from app.material_parser import MaterialParseError, context_for_materials, parse_material


def test_json_csv_text_and_pdf_are_bounded_and_structured(tmp_path):
    json_path = tmp_path / "sample.json"
    json_path.write_text(json.dumps({"title": "research", "items": [1, 2, 3]}), encoding="utf-8")
    assert parse_material(json_path, json_path.name, "application/json")["parse_status"] == "parsed"

    csv_path = tmp_path / "table.csv"
    csv_path.write_text("name,value\na,1\nb,2\n", encoding="utf-8")
    csv_result = parse_material(csv_path, csv_path.name, "text/csv")
    assert csv_result["columns"] == ["name", "value"]
    assert csv_result["preview_rows"][0]["name"] == "a"

    text_path = tmp_path / "script.py"
    text_path.write_text("print('safe')\n", encoding="utf-8")
    text_result = parse_material(text_path, text_path.name, "text/plain")
    assert text_result["kind"] == "code"
    assert "print" in text_result["text"]

    pdf_path = tmp_path / "paper.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    with pdf_path.open("wb") as handle:
        writer.write(handle)
    pdf_result = parse_material(pdf_path, pdf_path.name, "application/pdf")
    assert pdf_result["page_count"] == 1
    assert pdf_result["parse_status"] == "parsed"
    assert pdf_result["parser_version"] == "material-parser-2"


def test_image_is_decoded_and_ocr_text_is_bounded(tmp_path):
    path = tmp_path / "image.png"
    image = Image.new("RGB", (240, 80), "white")
    ImageDraw.Draw(image).text((8, 20), "hello research", fill="black")
    image.save(path)
    result = parse_material(path, path.name, "image/png")
    assert result["parse_status"] == "parsed"
    assert result["ocr_performed"] is True
    assert "hello" in result["ocr_text"].lower()
    assert (result["width"], result["height"]) == (240, 80)


def test_zip_manifest_rejects_path_traversal_without_extracting(tmp_path):
    safe_path = tmp_path / "safe.zip"
    with zipfile.ZipFile(safe_path, "w") as archive:
        archive.writestr("data/sample.txt", "safe")
    result = parse_material(safe_path, safe_path.name, "application/zip")
    assert result["parse_status"] == "parsed_manifest_only"
    assert result["extraction_performed"] is False

    unsafe_path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(unsafe_path, "w") as archive:
        archive.writestr("../escape.txt", "bad")
    with pytest.raises(MaterialParseError, match="路径"):
        parse_material(unsafe_path, unsafe_path.name, "application/zip")


def test_binary_text_and_context_are_rejected_or_capped(tmp_path):
    binary_path = tmp_path / "bad.txt"
    binary_path.write_bytes(b"hello\x00world")
    with pytest.raises(MaterialParseError, match="二进制"):
        parse_material(binary_path, binary_path.name, "text/plain")

    context = context_for_materials([{
        "id": "file-1", "name": "notes.txt", "mime_type": "text/plain", "sha256": "a" * 64,
        "metadata": {"kind": "text", "parse_status": "parsed", "text": "x" * 50},
    }], per_material_limit=10)
    assert len(context[0]["text"]) == 10

    preview_context = context_for_materials([{
        "id": "file-2", "name": "data.json", "mime_type": "application/json", "sha256": "b" * 64,
        "metadata": {"kind": "json", "parse_status": "parsed", "preview": {"value": "x" * 500}},
    }], total_limit=120)
    assert len(json.dumps(preview_context, ensure_ascii=False, separators=(",", ":"))) <= 120
