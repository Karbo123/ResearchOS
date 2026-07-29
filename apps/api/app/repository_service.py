"""Allowlisted repository verification and archive handling.

This module deliberately exposes no user-controlled shell command or filesystem
path. Network access is limited to the GitHub/GitLab APIs and their documented
archive hosts; callers provide only a candidate repository URL and paper facts.
"""

from __future__ import annotations

import base64
import hashlib
import re
import tarfile
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote, urlparse

import httpx


REPOSITORY_HOSTS = {"github.com", "gitlab.com"}
ARCHIVE_HOSTS = {"github.com", "codeload.github.com", "gitlab.com"}
MAX_ARCHIVE_BYTES = 500 * 1024 * 1024
MAX_EXTRACTED_BYTES = 1_000 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 20_000
KNOWN_SPDX = {
    "0BSD", "AFL-3.0", "AGPL-3.0", "AGPL-3.0-only", "Apache-2.0", "BSD-2-Clause",
    "BSD-3-Clause", "BSL-1.0", "CC0-1.0", "EPL-2.0", "GPL-2.0-only", "GPL-3.0-only",
    "ISC", "LGPL-2.1-only", "LGPL-3.0-only", "MIT", "MPL-2.0", "Unlicense",
}


class RepositoryVerificationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def validate_download_gate(
    *,
    verified_official: bool,
    license_spdx: str | None,
    commit_or_tag: str | None,
    metadata: dict[str, Any] | None,
    requested_commit: str | None = None,
) -> str:
    """Validate the persisted verification snapshot before any archive request."""
    verification = (metadata or {}).get("verification") or {}
    if not verified_official:
        raise RepositoryVerificationError("repository_official_verification_required", "请先完成论文与仓库的双源官方匹配。")
    if verification.get("license_status") != "known_spdx" or license_spdx not in KNOWN_SPDX:
        raise RepositoryVerificationError("repository_license_unknown", "仓库许可证不是已知 SPDX，不能下载。")
    commit = str(commit_or_tag or "").lower()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RepositoryVerificationError("repository_commit_unpinned", "仓库没有固定的 40 位 commit，不能下载。")
    if commit != str(verification.get("commit") or "").lower():
        raise RepositoryVerificationError("repository_verification_stale", "仓库验证结果或固定 commit 已变化，请重新验证。")
    if requested_commit is not None and commit != str(requested_commit).lower():
        raise RepositoryVerificationError("repository_verification_stale", "下载 Proposal 中的 commit 与验证记录不一致，请重新验证。")
    return commit


@dataclass(frozen=True)
class RepositoryIdentity:
    host: str
    namespace: str
    name: str

    @property
    def path(self) -> str:
        return f"{self.namespace}/{self.name}"


def parse_repository_url(value: str) -> RepositoryIdentity:
    parsed = urlparse(value.strip())
    if parsed.scheme != "https" or parsed.hostname not in REPOSITORY_HOSTS:
        raise RepositoryVerificationError("repository_host_not_allowed", "只允许 GitHub 或 GitLab 的 HTTPS 仓库地址。")
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RepositoryVerificationError("repository_url_invalid", "仓库地址不能包含查询参数、片段或认证信息。")
    parts = [part for part in parsed.path.strip("/").split("/") if part]
    if len(parts) < 2 or any(part in {".", ".."} for part in parts):
        raise RepositoryVerificationError("repository_url_invalid", "仓库地址必须包含安全的命名空间和仓库名。")
    name = parts[-1]
    if name.endswith(".git"):
        name = name[:-4]
    if not name or any(not re.fullmatch(r"[A-Za-z0-9_.-]+", item) for item in (*parts[:-1], name)):
        raise RepositoryVerificationError("repository_url_invalid", "仓库命名空间包含不支持的字符。")
    return RepositoryIdentity(parsed.hostname, "/".join(parts[:-1]), name)


def canonical_repository_url(identity: RepositoryIdentity) -> str:
    return f"https://{identity.host}/{identity.path}"


def _normalized_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def citation_match(paper_title: str, paper_doi: str | None, citation_text: str) -> dict[str, Any]:
    """Require an explicit DOI or exact normalized paper title in repository text."""
    text = citation_text.lower()
    doi = (paper_doi or "").lower().removeprefix("https://doi.org/").removeprefix("http://doi.org/").strip()
    if doi and doi in text:
        return {"matched": True, "method": "doi_in_repository_citation", "value": doi}
    normalized_title = _normalized_text(paper_title)
    normalized_citation = _normalized_text(citation_text)
    if normalized_title and len(normalized_title) >= 12 and normalized_title in normalized_citation:
        return {"matched": True, "method": "exact_title_in_repository_citation", "value": paper_title}
    return {"matched": False, "method": "no_explicit_paper_reference", "value": None}


def _headers(token: str | None) -> dict[str, str]:
    result = {"Accept": "application/json", "User-Agent": "ResearchOS-MVP/0.3 (repository-verifier)"}
    if token:
        result["Authorization"] = f"Bearer {token}"
    return result


def _github_api(identity: RepositoryIdentity) -> str:
    return f"https://api.github.com/repos/{identity.path}"


def _gitlab_api(identity: RepositoryIdentity) -> str:
    return f"https://gitlab.com/api/v4/projects/{quote(identity.path, safe='')}"


def _json(client: httpx.Client, url: str, headers: dict[str, str], params: dict[str, str] | None = None) -> dict[str, Any]:
    response = client.get(url, headers=headers, params=params)
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise RepositoryVerificationError("repository_provider_invalid", "仓库提供方返回了无效的结构化响应。")
    return value


def _repository_file(client: httpx.Client, identity: RepositoryIdentity, branch: str, path: str, headers: dict[str, str]) -> str:
    if identity.host == "github.com":
        payload = _json(client, f"{_github_api(identity)}/contents/{path}", headers, {"ref": branch})
    else:
        payload = _json(client, f"{_gitlab_api(identity)}/repository/files/{quote(path, safe='')}", headers, {"ref": branch})
    encoded = payload.get("content")
    if not isinstance(encoded, str):
        return ""
    try:
        return base64.b64decode(encoded.replace("\n", ""), validate=False).decode("utf-8", errors="replace")
    except (ValueError, UnicodeError):
        return ""


def verify_repository_candidate(
    repository_url: str,
    paper_title: str,
    paper_doi: str | None,
    token: str | None = None,
    timeout: float = 25,
) -> dict[str, Any]:
    identity = parse_repository_url(repository_url)
    headers = _headers(token)
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        if identity.host == "github.com":
            metadata = _json(client, _github_api(identity), headers)
            branch = str(metadata.get("default_branch") or "").strip()
            if not branch:
                raise RepositoryVerificationError("repository_default_branch_missing", "仓库没有可固定的默认分支。")
            commit_payload = _json(client, f"{_github_api(identity)}/commits/{quote(branch, safe='')}", headers)
            commit = str((commit_payload.get("sha") or "")).lower()
            license_data = metadata.get("license") or {}
            license_spdx = license_data.get("spdx_id") if isinstance(license_data, dict) else None
        else:
            metadata = _json(client, _gitlab_api(identity), headers)
            branch = str(metadata.get("default_branch") or "").strip()
            if not branch:
                raise RepositoryVerificationError("repository_default_branch_missing", "仓库没有可固定的默认分支。")
            commit_payload = _json(client, f"{_gitlab_api(identity)}/repository/commits/{quote(branch, safe='')}", headers)
            commit = str((commit_payload.get("id") or "")).lower()
            license_spdx = None
        citation_parts = []
        for path in ("CITATION.cff", "citation.cff", "README.md", "README.rst"):
            content = _repository_file(client, identity, branch, path, headers)
            if content:
                citation_parts.append({"path": path, "content": content})
        citation_text = "\n".join(item["content"] for item in citation_parts)

    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RepositoryVerificationError("repository_commit_unpinned", "提供方没有返回可验证的 40 位 commit。")
    license_spdx = str(license_spdx or "").strip() or None
    license_status = "known_spdx" if license_spdx in KNOWN_SPDX else "unknown"
    match = citation_match(paper_title, paper_doi, citation_text)
    return {
        "canonical_url": canonical_repository_url(identity),
        "host": identity.host,
        "namespace": identity.namespace,
        "name": identity.name,
        "default_branch": branch,
        "commit": commit,
        "license_spdx": license_spdx,
        "license_status": license_status,
        "official_match": bool(match["matched"]),
        "match": match,
        "citation_files": [item["path"] for item in citation_parts],
        "verification_sources": [
            {"source": "paper_record", "paper_title": paper_title, "paper_doi": paper_doi},
            {"source": f"{identity.host}_repository_api", "repository": canonical_repository_url(identity), "default_branch": branch, "commit": commit},
            {"source": "repository_citation_files", "files": [item["path"] for item in citation_parts]},
        ],
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


def archive_url(repository_url: str, commit: str) -> str:
    identity = parse_repository_url(repository_url)
    if not re.fullmatch(r"[0-9a-f]{40}", commit.lower()):
        raise RepositoryVerificationError("repository_commit_unpinned", "下载必须使用固定的 40 位 commit。")
    if identity.host == "github.com":
        return f"https://api.github.com/repos/{identity.path}/tarball/{commit.lower()}"
    return f"https://gitlab.com/{identity.path}/-/archive/{commit.lower()}/{identity.name}-{commit.lower()}.tar.gz"


def download_archive(repository_url: str, commit: str, token: str | None = None, timeout: float = 60) -> tuple[bytes, str]:
    url = archive_url(repository_url, commit)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", url, headers=_headers(token)) as response:
            response.raise_for_status()
            final_host = urlparse(str(response.url)).hostname
            if final_host not in ARCHIVE_HOSTS:
                raise RepositoryVerificationError("archive_host_not_allowed", "仓库归档重定向到了不允许的主机。")
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise RepositoryVerificationError("archive_size_limit", "仓库归档超过安全大小上限。")
                chunks.append(chunk)
    return b"".join(chunks), str(response.url)


def safe_extract_archive(data: bytes, destination: Path) -> dict[str, Any]:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise RepositoryVerificationError("archive_size_limit", "仓库归档超过安全大小上限。")
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    extracted_files = 0
    with tarfile.open(fileobj=BytesIO(data), mode="r:*") as archive:
        members = archive.getmembers()
        if len(members) > MAX_ARCHIVE_ENTRIES:
            raise RepositoryVerificationError("archive_entry_limit", "仓库归档条目数量超过安全上限。")
        for member in members:
            parts = PurePosixPath(member.name).parts
            if not parts or member.name.startswith("/") or ".." in parts:
                raise RepositoryVerificationError("archive_path_traversal", "仓库归档包含不安全路径。")
            if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                raise RepositoryVerificationError("archive_special_file", "仓库归档包含不允许的特殊文件或符号链接。")
            relative = PurePosixPath(*parts[1:]) if len(parts) > 1 else PurePosixPath()
            if str(relative) in {"", "."}:
                continue
            target = (destination / Path(*relative.parts)).resolve()
            if destination not in target.parents and target != destination:
                raise RepositoryVerificationError("archive_path_traversal", "仓库归档路径超出受控目录。")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            total += member.size
            if member.size < 0 or total > MAX_EXTRACTED_BYTES:
                raise RepositoryVerificationError("archive_uncompressed_limit", "仓库归档声明的解压大小超过安全上限。")
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise RepositoryVerificationError("archive_member_invalid", "无法读取仓库归档成员。")
            with target.open("wb") as handle:
                while chunk := source.read(1024 * 1024):
                    handle.write(chunk)
            extracted_files += 1
    return {"extracted_files": extracted_files, "uncompressed_bytes": total}


def repository_directory_name(repository_url: str, commit: str) -> str:
    identity = parse_repository_url(repository_url)
    raw = f"{identity.namespace.replace('/', '-')}-{identity.name}-{commit[:12]}"
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", raw).strip(".-")[:180]


def archive_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
