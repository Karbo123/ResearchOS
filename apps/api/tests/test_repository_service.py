from io import BytesIO
from pathlib import Path
import tarfile

import pytest

from app.repository_service import (
    RepositoryVerificationError,
    archive_url,
    citation_match,
    parse_repository_url,
    safe_extract_archive,
    validate_download_gate,
)


def _archive(name: str, content: bytes, *, symlink: bool = False) -> bytes:
    output = BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        item = tarfile.TarInfo(name)
        if symlink:
            item.type = tarfile.SYMTYPE
            item.linkname = "/outside"
        else:
            item.size = len(content)
        archive.addfile(item, None if symlink else BytesIO(content))
    return output.getvalue()


def test_repository_url_is_strictly_allowlisted_and_canonicalized():
    identity = parse_repository_url("https://github.com/org/research-code.git")
    assert identity.host == "github.com"
    assert identity.path == "org/research-code"
    with pytest.raises(RepositoryVerificationError):
        parse_repository_url("http://github.com/org/research-code")
    with pytest.raises(RepositoryVerificationError):
        parse_repository_url("https://github.com/org/research-code?token=secret")
    with pytest.raises(RepositoryVerificationError):
        parse_repository_url("https://example.com/org/research-code")


def test_citation_requires_explicit_paper_reference():
    assert citation_match("A Reliable Research Method", "10.1234/ABC", "doi: 10.1234/abc")['matched'] is True
    assert citation_match("A Reliable Research Method", None, "A Reliable Research Method\n")['matched'] is True
    assert citation_match("A Reliable Research Method", "10.1234/ABC", "unrelated code")['matched'] is False


def test_archive_requires_full_commit_and_allowlisted_host():
    assert archive_url("https://github.com/org/research-code", "a" * 40).endswith("/" + "a" * 40)
    with pytest.raises(RepositoryVerificationError):
        archive_url("https://example.com/org/research-code", "a" * 40)
    with pytest.raises(RepositoryVerificationError):
        archive_url("https://github.com/org/research-code", "a" * 7)


def test_download_gate_requires_verified_license_and_matching_full_commit():
    commit = "a" * 40
    metadata = {"verification": {"license_status": "known_spdx", "commit": commit}}
    assert validate_download_gate(
        verified_official=True,
        license_spdx="MIT",
        commit_or_tag=commit,
        metadata=metadata,
        requested_commit=commit,
    ) == commit

    with pytest.raises(RepositoryVerificationError, match="双源"):
        validate_download_gate(
            verified_official=False,
            license_spdx="MIT",
            commit_or_tag=commit,
            metadata=metadata,
        )
    with pytest.raises(RepositoryVerificationError, match="SPDX"):
        validate_download_gate(
            verified_official=True,
            license_spdx="NOASSERTION",
            commit_or_tag=commit,
            metadata=metadata,
        )
    with pytest.raises(RepositoryVerificationError, match="40 位"):
        validate_download_gate(
            verified_official=True,
            license_spdx="MIT",
            commit_or_tag="a" * 7,
            metadata=metadata,
        )
    with pytest.raises(RepositoryVerificationError, match="不一致"):
        validate_download_gate(
            verified_official=True,
            license_spdx="MIT",
            commit_or_tag=commit,
            metadata=metadata,
            requested_commit="b" * 40,
        )


def test_safe_extract_strips_archive_root_and_rejects_traversal_and_symlinks(tmp_path: Path):
    destination = tmp_path / "repo"
    result = safe_extract_archive(_archive("repo-a/README.md", b"verified"), destination)
    assert result["extracted_files"] == 1
    assert (destination / "README.md").read_bytes() == b"verified"

    with pytest.raises(RepositoryVerificationError, match="路径"):
        safe_extract_archive(_archive("../escape.txt", b"bad"), tmp_path / "bad-path")
    with pytest.raises(RepositoryVerificationError, match="特殊"):
        safe_extract_archive(_archive("repo-a/link", b"", symlink=True), tmp_path / "bad-link")
