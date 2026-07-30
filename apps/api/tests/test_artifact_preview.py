import json

import pytest
from pypdf import PdfWriter

from app.artifact_preview import ArtifactPreviewError, preview_artifact


def test_ascii_ply_preview_returns_points_faces_and_download_safe_data(tmp_path):
    path = tmp_path / "mesh.ply"
    path.write_text(
        "\n".join([
            "ply", "format ascii 1.0", "element vertex 4",
            "property float x", "property float y", "property float z",
            "element face 1", "property list uchar int vertex_indices", "end_header",
            "0 0 0", "1 0 0", "1 1 0", "0 1 0", "4 0 1 2 3", "",
        ]), encoding="ascii",
    )
    result = preview_artifact(path, path.name, "application/ply")
    assert result["type"] == "point_cloud"
    assert result["source_point_count"] == 4
    assert result["points"] == [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]]
    assert result["faces"] == [[0, 1, 2, 3]]


def test_ascii_pcd_preview_deterministically_downsamples_large_cloud(tmp_path):
    path = tmp_path / "cloud.pcd"
    rows = [f"{index} 0 0" for index in range(20_001)]
    path.write_text(
        "\n".join([
            "VERSION .7", "FIELDS x y z", "SIZE 4 4 4", "TYPE F F F",
            "COUNT 1 1 1", "WIDTH 20001", "HEIGHT 1", "POINTS 20001", "DATA ascii", *rows,
        ]), encoding="ascii",
    )
    result = preview_artifact(path, path.name, "text/pcd")
    assert result["type"] == "point_cloud"
    assert result["source_point_count"] == 20_001
    assert result["sampled"] is True
    assert len(result["points"]) <= 20_000


def test_previews_never_execute_html_and_bound_structured_text(tmp_path):
    html_path = tmp_path / "report.html"
    html_path.write_text("<script>window.pwned = true</script><h1>Report</h1>", encoding="utf-8")
    html_result = preview_artifact(html_path, html_path.name, "text/html")
    assert html_result["type"] == "html_text"
    assert html_result["executed"] is False
    assert "script" in html_result["text"]

    json_path = tmp_path / "metrics.json"
    json_path.write_text(json.dumps({"metrics": {"accuracy": 0.9}}), encoding="utf-8")
    assert preview_artifact(json_path, json_path.name, "application/json")["type"] == "json"


def test_binary_point_cloud_and_invalid_pdf_fail_structured(tmp_path):
    pcd_path = tmp_path / "binary.pcd"
    pcd_path.write_bytes(b"VERSION .7\nFIELDS x y z\nDATA binary\n")
    with pytest.raises(ArtifactPreviewError) as pcd_error:
        preview_artifact(pcd_path, pcd_path.name, "text/pcd")
    assert pcd_error.value.code == "pcd_binary_unsupported"

    pdf_path = tmp_path / "valid.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    with pdf_path.open("wb") as handle:
        writer.write(handle)
    assert preview_artifact(pdf_path, pdf_path.name, "application/pdf")["type"] == "pdf"
