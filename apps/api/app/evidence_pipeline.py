from __future__ import annotations

import hashlib
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx
from pypdf import PdfReader

from .search import USER_AGENT


MAX_PDF_BYTES = 25 * 1024 * 1024
ALLOWED_OPEN_PDF_HOSTS = {
    "arxiv.org",
    "export.arxiv.org",
    "openaccess.thecvf.com",
    "proceedings.neurips.cc",
    "jmlr.org",
    "aclanthology.org",
    "pmc.ncbi.nlm.nih.gov",
}


def validate_open_pdf_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not any(host == item or host.endswith(f".{item}") for item in ALLOWED_OPEN_PDF_HOSTS):
        raise ValueError("PDF URL is not an HTTPS URL on the scholarly open-access allowlist")
    if parsed.username or parsed.password or parsed.port not in {None, 443}:
        raise ValueError("PDF URL credentials and nonstandard ports are forbidden")


async def download_open_pdf(url: str, target: Path) -> tuple[str, int, str]:
    validate_open_pdf_url(url)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".partial")
    digest = hashlib.sha256()
    size = 0
    timeout = httpx.Timeout(60, connect=15)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", url, headers={"User-Agent": USER_AGENT, "Accept": "application/pdf"}) as response:
                response.raise_for_status()
                validate_open_pdf_url(str(response.url))
                declared = int(response.headers.get("content-length", "0") or 0)
                if declared > MAX_PDF_BYTES:
                    raise ValueError("PDF exceeds the 25 MB download limit")
                with temporary.open("wb") as handle:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_PDF_BYTES:
                            raise ValueError("PDF exceeds the 25 MB download limit")
                        digest.update(chunk)
                        handle.write(chunk)
        with temporary.open("rb") as handle:
            if handle.read(5) != b"%PDF-":
                raise ValueError("downloaded content is not a PDF")
        temporary.replace(target)
        return digest.hexdigest(), size, str(response.url)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def extract_page_evidence(path: Path) -> dict[str, object]:
    reader = PdfReader(str(path))
    if reader.is_encrypted:
        raise ValueError("encrypted PDFs are not supported")
    first_text_page: tuple[int, str] | None = None
    for page_number, page in enumerate(reader.pages, start=1):
        text = re.sub(r"\s+", " ", page.extract_text() or "").strip()
        if len(text) < 160:
            continue
        if first_text_page is None:
            first_text_page = (page_number, text)
        abstract_match = re.search(r"\babstract[.:]?\s+", text, re.IGNORECASE)
        if not abstract_match or len(text[abstract_match.end():].strip()) < 160:
            continue
        quote = text[abstract_match.end():abstract_match.end() + 1200].strip()
        sentence = re.split(r"(?<=[.!?])\s+", quote, maxsplit=1)[0][:500].strip()
        if len(sentence) < 40:
            sentence = quote[:500]
        return {
            "page_number": page_number,
            "page_count": len(reader.pages),
            "quote": quote,
            "claim": sentence,
            "parser": f"pypdf/{__import__('pypdf').__version__}",
        }
    if first_text_page:
        page_number, text = first_text_page
        quote = text[:1200].strip()
        sentence = re.split(r"(?<=[.!?])\s+", quote, maxsplit=1)[0][:500].strip()
        return {
            "page_number": page_number, "page_count": len(reader.pages),
            "quote": quote, "claim": sentence if len(sentence) >= 40 else quote[:500],
            "parser": f"pypdf/{__import__('pypdf').__version__}",
        }
    raise ValueError("no extractable page text was found")
