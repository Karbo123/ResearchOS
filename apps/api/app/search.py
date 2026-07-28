from __future__ import annotations

import asyncio
import os
import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import quote

import httpx

from .schemas import PaperRecord


USER_AGENT = "ResearchOS-MVP/0.2 (mailto:research-os@localhost)"


def _clean(value: str | None) -> str:
    return re.sub(r"<[^>]+>", "", value or "").strip()


def _doi(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"^https?://doi\.org/", "", value, flags=re.I).strip() or None


def _crossref_record(item: dict[str, Any]) -> PaperRecord | None:
    titles = item.get("title") or []
    if not titles or not item.get("URL"):
        return None
    date_parts = (item.get("published-print") or item.get("published-online") or item.get("issued") or {}).get("date-parts", [[]])
    year = date_parts[0][0] if date_parts and date_parts[0] else None
    authors = [" ".join(filter(None, [a.get("given"), a.get("family")])) for a in item.get("author", [])]
    doi = _doi(item.get("DOI"))
    return PaperRecord(
        title=_clean(titles[0]), authors=authors, year=year, doi=doi,
        source_url=item["URL"], venue=(item.get("container-title") or [None])[0],
        abstract=_clean(item.get("abstract")) or None,
        citation_count=item.get("is-referenced-by-count"), verified=bool(doi),
        source_provider="crossref", external_ids={"doi": doi} if doi else {},
        evidence=[{"source": "Crossref", "field": "metadata", "url": item["URL"]}],
    )


async def _search_crossref(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await client.get(
        "https://api.crossref.org/works",
        params={"query": query, "rows": limit, "select": "DOI,title,author,published-print,published-online,issued,URL,container-title,abstract,is-referenced-by-count"},
        headers={"User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    return [record for item in response.json()["message"]["items"] if (record := _crossref_record(item))]


async def _search_openalex(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await client.get(
        "https://api.openalex.org/works",
        params={"search": query, "per-page": limit, "mailto": "research-os@localhost"},
        headers={"User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    records = []
    for item in response.json().get("results", []):
        title = _clean(item.get("display_name"))
        if not title:
            continue
        doi = _doi(item.get("doi"))
        location = item.get("primary_location") or {}
        source = location.get("source") or {}
        pdf_url = location.get("pdf_url") or (item.get("best_oa_location") or {}).get("pdf_url")
        records.append(PaperRecord(
            title=title,
            authors=[a.get("author", {}).get("display_name", "") for a in item.get("authorships", []) if a.get("author")],
            year=item.get("publication_year"), doi=doi, source_url=item.get("id") or doi or "https://openalex.org",
            venue=source.get("display_name"), citation_count=item.get("cited_by_count"), verified=bool(doi),
            source_provider="openalex", pdf_url=pdf_url,
            external_ids={k: str(v) for k, v in (item.get("ids") or {}).items() if v},
            evidence=[{"source": "OpenAlex", "field": "metadata", "url": item.get("id")}],
        ))
    return records


async def _search_semantic_scholar(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    headers = {"User-Agent": USER_AGENT}
    if os.getenv("SEMANTIC_SCHOLAR_API_KEY"):
        headers["x-api-key"] = os.environ["SEMANTIC_SCHOLAR_API_KEY"]
    response = await client.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={"query": query, "limit": min(limit, 20), "fields": "title,authors,year,venue,externalIds,url,abstract,citationCount,openAccessPdf"},
        headers=headers,
    )
    response.raise_for_status()
    records = []
    for item in response.json().get("data", []):
        title = _clean(item.get("title"))
        if not title:
            continue
        ids = {k: str(v) for k, v in (item.get("externalIds") or {}).items() if v}
        doi = _doi(ids.get("DOI"))
        records.append(PaperRecord(
            title=title, authors=[a.get("name", "") for a in item.get("authors", [])],
            year=item.get("year"), doi=doi, source_url=item.get("url") or f"https://www.semanticscholar.org/paper/{item['paperId']}",
            venue=item.get("venue"), abstract=item.get("abstract"), citation_count=item.get("citationCount"),
            verified=bool(doi), source_provider="semantic_scholar",
            pdf_url=(item.get("openAccessPdf") or {}).get("url"), external_ids=ids,
            evidence=[{"source": "Semantic Scholar", "field": "metadata", "url": item.get("url")}],
        ))
    return records


async def _search_arxiv(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await client.get(
        "https://export.arxiv.org/api/query",
        params={"search_query": f"all:{query}", "start": 0, "max_results": min(limit, 20)},
        headers={"User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    root = ET.fromstring(response.content)
    ns = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
    records = []
    for entry in root.findall("atom:entry", ns):
        title = _clean(entry.findtext("atom:title", default="", namespaces=ns)).replace("\n", " ")
        if not title:
            continue
        entry_url = entry.findtext("atom:id", default="", namespaces=ns)
        arxiv_id = entry_url.rsplit("/", 1)[-1]
        doi = _doi(entry.findtext("arxiv:doi", default="", namespaces=ns))
        pdf_url = next((link.get("href") for link in entry.findall("atom:link", ns) if link.get("type") == "application/pdf"), None)
        published = entry.findtext("atom:published", default="", namespaces=ns)
        records.append(PaperRecord(
            title=title,
            authors=[a.findtext("atom:name", default="", namespaces=ns) for a in entry.findall("atom:author", ns)],
            year=int(published[:4]) if published[:4].isdigit() else None,
            doi=doi, source_url=entry_url, abstract=_clean(entry.findtext("atom:summary", default="", namespaces=ns)),
            verified=bool(doi), source_provider="arxiv", pdf_url=pdf_url,
            external_ids={"arxiv": arxiv_id, **({"doi": doi} if doi else {})},
            evidence=[{"source": "arXiv", "field": "metadata", "url": entry_url}],
        ))
    return records


async def _search_dblp(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await client.get(
        "https://dblp.org/search/publ/api",
        params={"q": query, "h": min(limit, 20), "format": "json"},
        headers={"User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    records = []
    for hit in response.json().get("result", {}).get("hits", {}).get("hit", []):
        info = hit.get("info") or {}
        title = _clean(info.get("title"))
        if not title:
            continue
        authors_value = (info.get("authors") or {}).get("author", [])
        if isinstance(authors_value, dict):
            authors_value = [authors_value]
        authors = [a.get("text", "") if isinstance(a, dict) else str(a) for a in authors_value]
        doi = _doi(info.get("doi"))
        records.append(PaperRecord(
            title=title, authors=authors,
            year=int(info["year"]) if str(info.get("year", "")).isdigit() else None,
            doi=doi, source_url=info.get("url") or info.get("ee") or "https://dblp.org",
            venue=info.get("venue"), verified=bool(doi), source_provider="dblp",
            external_ids={"dblp": info.get("key", ""), **({"doi": doi} if doi else {})},
            evidence=[{"source": "DBLP", "field": "metadata", "url": info.get("url")}],
        ))
    return records


async def _fetch_bibtex(client: httpx.AsyncClient, record: PaperRecord) -> None:
    if not record.doi:
        arxiv_id = record.external_ids.get("arxiv")
        if arxiv_id:
            surname = record.authors[0].split()[-1] if record.authors else "arxiv"
            key = re.sub(r"\W+", "", surname) + str(record.year or "")
            authors = " and ".join(author for author in record.authors if author)
            record.bibtex = (
                f"@misc{{{key or 'arxiv'},\n"
                f"  title = {{{record.title}}},\n  author = {{{authors}}},\n"
                f"  year = {{{record.year or ''}}},\n  eprint = {{{arxiv_id}}},\n"
                "  archivePrefix = {arXiv}\n}"
            )
        return
    try:
        response = await client.get(
            f"https://doi.org/{quote(record.doi, safe='/')}",
            headers={"Accept": "application/x-bibtex", "User-Agent": USER_AGENT},
        )
        if response.is_success and response.text.lstrip().startswith("@"):
            record.bibtex = response.text.strip()
    except httpx.HTTPError:
        pass


async def _github_candidates(client: httpx.AsyncClient, record: PaperRecord) -> None:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT}
    if os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    query = re.sub(r"[^\w\s-]", "", record.title)[:180]
    try:
        response = await client.get("https://api.github.com/search/repositories", params={"q": f'"{query}"', "per_page": 3}, headers=headers)
        if response.is_success:
            record.code_repositories = [{
                "url": item["html_url"], "name": item["full_name"],
                "license": (item.get("license") or {}).get("spdx_id"),
                "default_branch": item.get("default_branch"),
                "match_type": "candidate_title_match", "verified_official": False,
            } for item in response.json().get("items", [])]
    except httpx.HTTPError:
        pass


def _deduplicate(groups: list[list[PaperRecord]], limit: int) -> list[PaperRecord]:
    merged: dict[str, PaperRecord] = {}
    for records in groups:
        for record in records:
            normalized_title = re.sub(r"\W+", "", record.title.lower())
            key = f"doi:{record.doi.lower()}" if record.doi else f"title:{normalized_title}"
            if key not in merged:
                merged[key] = record
                continue
            existing = merged[key]
            existing.external_ids.update(record.external_ids)
            existing.evidence.extend(x for x in record.evidence if x not in existing.evidence)
            existing.pdf_url = existing.pdf_url or record.pdf_url
            existing.abstract = existing.abstract or record.abstract
            counts = [x for x in [existing.citation_count, record.citation_count] if x is not None]
            existing.citation_count = max(counts) if counts else None
    return sorted(
        merged.values(),
        key=lambda item: (
            bool(item.pdf_url), bool(item.bibtex or item.doi),
            item.citation_count if item.citation_count is not None else -1,
        ),
        reverse=True,
    )[:limit]


async def search_literature(query: str, limit: int = 8) -> tuple[list[PaperRecord], list[dict[str, str]]]:
    timeout = httpx.Timeout(25, connect=10)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        providers = {
            "crossref": _search_crossref(client, query, limit),
            "openalex": _search_openalex(client, query, limit),
            "semantic_scholar": _search_semantic_scholar(client, query, limit),
            "arxiv": _search_arxiv(client, query, limit),
            "dblp": _search_dblp(client, query, limit),
        }
        results = await asyncio.gather(*providers.values(), return_exceptions=True)
        groups = []
        errors = []
        for name, result in zip(providers, results):
            if isinstance(result, Exception):
                errors.append({"provider": name, "error": str(result)[:500]})
            else:
                groups.append(result)
        records = _deduplicate(groups, limit)
        await asyncio.gather(*[_fetch_bibtex(client, record) for record in records])
        await asyncio.gather(*[_github_candidates(client, record) for record in records[:5]])
        return records, errors
