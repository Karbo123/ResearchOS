from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from html.parser import HTMLParser
import os
import re
import urllib.robotparser
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import httpx

from .schemas import PaperRecord


USER_AGENT = "ResearchOS-MVP/0.2 (mailto:research-os@localhost)"

PROVIDER_POLICIES: dict[str, dict[str, str]] = {
    "crossref": {"terms_url": "https://www.crossref.org/terms/", "robots_status": "not_applicable_api"},
    "openalex": {"terms_url": "https://docs.openalex.org/api-entities/works", "robots_status": "not_applicable_api"},
    "semantic_scholar": {"terms_url": "https://www.semanticscholar.org/product/api", "robots_status": "not_applicable_api"},
    "arxiv": {"terms_url": "https://info.arxiv.org/help/api/tou.html", "robots_status": "not_applicable_api"},
    "dblp": {"terms_url": "https://dblp.org/faq/13536573.html", "robots_status": "not_applicable_api"},
    "github": {"terms_url": "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service", "robots_status": "not_applicable_api"},
    "gitlab": {"terms_url": "https://about.gitlab.com/terms/", "robots_status": "not_applicable_api"},
    "huggingface": {"terms_url": "https://huggingface.co/terms", "robots_status": "not_applicable_api"},
    "web_search": {"terms_url": "https://duckduckgo.com/terms", "robots_status": "deferred_until_fetch"},
}

# A single process-wide limiter prevents concurrent search requests from
# bursting the same public provider. It is deliberately conservative and
# does not claim a quota that the provider has not advertised.
_RATE_LOCK = asyncio.Lock()
_NEXT_PROVIDER_REQUEST: dict[str, float] = {}
_PROVIDER_INTERVAL_SECONDS = {
    "crossref": 0.25, "openalex": 0.25, "semantic_scholar": 0.5,
    "arxiv": 3.0, "dblp": 0.5, "github": 0.5, "gitlab": 0.5,
    "huggingface": 0.25, "web_search": 1.0,
}


class _WebResultParser(HTMLParser):
    """Parse only DuckDuckGo's result anchors; snippets remain candidates."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._capture = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if tag == "a" and "result__a" in classes:
            href = attributes.get("href") or ""
            query = parse_qs(urlparse(href).query).get("uddg", [href])[0]
            self._current = {"url": query, "title": "", "snippet": ""}
            self._capture = True
        elif tag in {"a", "div"} and "result__snippet" in classes and self._current:
            self._capture = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._current and self._current["title"]:
            self.results.append(self._current)
            self._current = None
            self._capture = False

    def handle_data(self, data: str) -> None:
        if self._capture and self._current:
            text = " ".join(data.split())
            if not text:
                return
            if not self._current["title"]:
                self._current["title"] = text
            else:
                self._current["snippet"] = (self._current["snippet"] + " " + text).strip()


async def _throttle(provider: str) -> None:
    interval = _PROVIDER_INTERVAL_SECONDS.get(provider, 1.0)
    async with _RATE_LOCK:
        now = asyncio.get_running_loop().time()
        wait_for = max(0.0, _NEXT_PROVIDER_REQUEST.get(provider, 0.0) - now)
        _NEXT_PROVIDER_REQUEST[provider] = now + wait_for + interval
    if wait_for:
        await asyncio.sleep(wait_for)


def _rate_limit_snapshot(response: httpx.Response) -> dict[str, Any]:
    headers = response.headers
    values: dict[str, Any] = {"status": "observed"}
    for name, key in (("x-ratelimit-limit", "limit"), ("x-ratelimit-remaining", "remaining"), ("x-ratelimit-reset", "reset"), ("retry-after", "retry_after")):
        if headers.get(name) is not None:
            values[key] = headers[name]
    if len(values) == 1:
        values["status"] = "not_provided"
    return values


def _compliance(provider: str, response: httpx.Response | None = None, *, robots_status: str | None = None) -> dict[str, Any]:
    policy = PROVIDER_POLICIES[provider]
    return {
        "provider": provider,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "robots_url": None,
        "robots_status": robots_status or policy["robots_status"],
        "terms_url": policy["terms_url"],
        "terms_status": "linked_provider_terms",
        "rate_limit": _rate_limit_snapshot(response) if response is not None else {"status": "not_observed"},
    }


def _resource_compliance(provider: str, response: httpx.Response, source_url: str | None = None) -> dict[str, Any]:
    compliance = _compliance(provider, response)
    if source_url:
        parsed = urlparse(source_url)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            compliance["robots_url"] = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    return compliance


async def _check_robots(client: httpx.AsyncClient, target_url: str) -> tuple[str, str]:
    parsed = urlparse(target_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return "unavailable", ""
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        response = await _provider_request(
            client, "web_search", "GET", robots_url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/plain"},
        )
    except httpx.HTTPError:
        return "unavailable", robots_url
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    parser.parse(response.text.splitlines())
    return ("allowed" if parser.can_fetch(USER_AGENT, target_url) else "disallowed"), robots_url


async def _provider_request(client: httpx.AsyncClient, provider: str, method: str, url: str, **kwargs: Any) -> httpx.Response:
    await _throttle(provider)
    response = await client.request(method, url, **kwargs)
    response.raise_for_status()
    return response


def _clean(value: str | None) -> str:
    return re.sub(r"<[^>]+>", "", value or "").strip()


def _error_text(exc: BaseException) -> str:
    message = str(exc).strip()
    if message:
        return message[:500]
    response = getattr(exc, "response", None)
    if response is not None:
        return f"{type(exc).__name__}: HTTP {response.status_code}"
    return type(exc).__name__


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
    response = await _provider_request(client, "crossref", "GET",
        "https://api.crossref.org/works",
        params={"query": query, "rows": limit, "select": "DOI,title,author,published-print,published-online,issued,URL,container-title,abstract,is-referenced-by-count"},
        headers={"User-Agent": USER_AGENT},
    )
    compliance = _compliance("crossref", response)
    records = [record for item in response.json()["message"]["items"] if (record := _crossref_record(item))]
    for record in records:
        record.compliance = compliance
    return records


async def _search_openalex(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await _provider_request(client, "openalex", "GET",
        "https://api.openalex.org/works",
        params={"search": query, "per-page": limit, "mailto": "research-os@localhost"},
        headers={"User-Agent": USER_AGENT},
    )
    compliance = _compliance("openalex", response)
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
            compliance=compliance,
        ))
    return records


async def _search_semantic_scholar(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    headers = {"User-Agent": USER_AGENT}
    if os.getenv("SEMANTIC_SCHOLAR_API_KEY"):
        headers["x-api-key"] = os.environ["SEMANTIC_SCHOLAR_API_KEY"]
    response = await _provider_request(client, "semantic_scholar", "GET",
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={"query": query, "limit": min(limit, 20), "fields": "title,authors,year,venue,externalIds,url,abstract,citationCount,openAccessPdf"},
        headers=headers,
    )
    compliance = _compliance("semantic_scholar", response)
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
            compliance=compliance,
        ))
    return records


async def _search_arxiv(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await _provider_request(client, "arxiv", "GET",
        "https://export.arxiv.org/api/query",
        params={"search_query": f"all:{query}", "start": 0, "max_results": min(limit, 20)},
        headers={"User-Agent": USER_AGENT},
    )
    compliance = _compliance("arxiv", response)
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
            compliance=compliance,
        ))
    return records


async def _search_dblp(client: httpx.AsyncClient, query: str, limit: int) -> list[PaperRecord]:
    response = await _provider_request(client, "dblp", "GET",
        "https://dblp.org/search/publ/api",
        params={"q": query, "h": min(limit, 20), "format": "json"},
        headers={"User-Agent": USER_AGENT},
    )
    compliance = _compliance("dblp", response)
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
            compliance=compliance,
        ))
    return records


async def _search_gitlab(client: httpx.AsyncClient, query: str, limit: int) -> list[dict[str, Any]]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    token = os.getenv("GITLAB_TOKEN", "").strip()
    if token:
        headers["PRIVATE-TOKEN"] = token
    response = await _provider_request(
        client, "gitlab", "GET", "https://gitlab.com/api/v4/projects",
        params={"search": query[:180], "simple": "true", "per_page": min(limit, 10)},
        headers=headers,
    )
    compliance = _compliance("gitlab", response)
    return [{
        "resource_type": "code",
        "provider": "gitlab",
        "url": item.get("web_url"),
        "name": item.get("path_with_namespace") or item.get("name"),
        "description": item.get("description"),
        "default_branch": item.get("default_branch"),
        "license": None,
        "match_type": "candidate_text_match",
        "verified_official": False,
        "compliance": compliance,
    } for item in response.json() if item.get("web_url")]


async def _search_huggingface(client: httpx.AsyncClient, query: str, limit: int, resource_type: str) -> list[dict[str, Any]]:
    if resource_type not in {"dataset", "model"}:
        raise ValueError("unsupported Hugging Face resource type")
    endpoint = f"https://huggingface.co/api/{'datasets' if resource_type == 'dataset' else 'models'}"
    response = await _provider_request(
        client, "huggingface", "GET", endpoint,
        params={"search": query[:180], "limit": min(limit, 20)},
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    compliance = _compliance("huggingface", response)
    candidates = []
    for item in response.json():
        identifier = item.get("id") or item.get("modelId")
        if not identifier:
            continue
        candidates.append({
            "resource_type": resource_type,
            "provider": "huggingface",
            "id": identifier,
            "url": f"https://huggingface.co/{'datasets/' if resource_type == 'dataset' else ''}{identifier}",
            "name": identifier,
            "description": item.get("description"),
            "downloads": item.get("downloads"),
            "likes": item.get("likes"),
            "verified_official": False,
            "match_type": "candidate_text_match",
            "compliance": compliance,
        })
    return candidates


async def _search_web_pages(client: httpx.AsyncClient, query: str, limit: int) -> list[dict[str, Any]]:
    robots_status, robots_url = await _check_robots(client, "https://html.duckduckgo.com/html/")
    if robots_status != "allowed":
        raise RuntimeError(f"web_search_robots_{robots_status}")
    response = await _provider_request(
        client, "web_search", "GET", "https://html.duckduckgo.com/html/",
        params={"q": query[:180], "kl": "wt-wt"},
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
    )
    compliance = _compliance("web_search", response)
    compliance["robots_url"] = robots_url
    compliance["robots_status"] = robots_status
    parser = _WebResultParser()
    parser.feed(response.text)
    candidates = []
    for item in parser.results[:limit]:
        source_url = item["url"].strip()
        if not source_url.startswith(("https://", "http://")):
            continue
        item_compliance = dict(compliance)
        parsed = urlparse(source_url)
        item_compliance["robots_url"] = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        item_compliance["robots_status"] = "deferred_until_fetch"
        candidates.append({
            "resource_type": "web_page",
            "provider": "web_search",
            "url": source_url,
            "title": item["title"],
            "snippet": item["snippet"],
            "verified_official": False,
            "match_type": "search_snippet_candidate",
            "compliance": item_compliance,
        })
    return candidates


async def _fetch_bibtex(client: httpx.AsyncClient, record: PaperRecord) -> dict[str, str] | None:
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
        return None
    try:
        response = await _provider_request(
            client, "crossref", "GET",
            f"https://doi.org/{quote(record.doi, safe='/')}",
            headers={"Accept": "application/x-bibtex", "User-Agent": USER_AGENT},
        )
        if response.text.lstrip().startswith("@"):
            record.bibtex = response.text.strip()
        return None
    except httpx.HTTPError as exc:
        record.compliance["bibtex"] = {
            "status": "error",
            "provider": "doi_bibtex",
            "error": _error_text(exc),
        }
        return {"provider": "doi_bibtex", "error": _error_text(exc)}


async def _github_candidates(client: httpx.AsyncClient, record: PaperRecord) -> tuple[list[dict[str, Any]], dict[str, str] | None]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT}
    if os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    query = re.sub(r"[^\w\s-]", "", record.title)[:180]
    try:
        response = await _provider_request(
            client, "github", "GET", "https://api.github.com/search/repositories",
            params={"q": f'"{query}"', "per_page": 3}, headers=headers,
        )
        compliance = _compliance("github", response)
        repositories = [{
                "resource_type": "code", "provider": "github",
                "url": item["html_url"], "name": item["full_name"],
                "license": (item.get("license") or {}).get("spdx_id"),
                "default_branch": item.get("default_branch"),
                "match_type": "candidate_title_match", "verified_official": False,
                "compliance": compliance,
            } for item in response.json().get("items", [])]
        record.code_repositories = repositories
        return repositories, None
    except Exception as exc:
        return [], {"provider": "github", "error": _error_text(exc)}


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


async def search_literature(
    query: str, limit: int = 8,
) -> tuple[list[PaperRecord], list[dict[str, Any]], list[dict[str, Any]]]:
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
                errors.append({"provider": name, "error": _error_text(result)})
            else:
                groups.append(result)
        records = _deduplicate(groups, limit)
        bibtex_results = await asyncio.gather(*[_fetch_bibtex(client, record) for record in records])
        errors.extend(result for result in bibtex_results if result)
        repository_results = await asyncio.gather(*[_github_candidates(client, record) for record in records[:5]])
        resource_candidates: list[dict[str, Any]] = []
        for repositories, error in repository_results:
            resource_candidates.extend(repositories)
            if error:
                errors.append(error)
        registry_tasks = {
            "gitlab": _search_gitlab(client, query, limit),
            "huggingface_datasets": _search_huggingface(client, query, limit, "dataset"),
            "huggingface_models": _search_huggingface(client, query, limit, "model"),
            "web_search": _search_web_pages(client, query, limit),
        }
        registry_results = await asyncio.gather(*registry_tasks.values(), return_exceptions=True)
        for name, result in zip(registry_tasks, registry_results):
            if isinstance(result, Exception):
                errors.append({"provider": name, "error": _error_text(result)})
            else:
                resource_candidates.extend(result)
        return records, errors, resource_candidates
