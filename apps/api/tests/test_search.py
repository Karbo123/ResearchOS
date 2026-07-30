import asyncio

import httpx

from app.search import _search_gitlab, _search_huggingface, _search_web_pages


class FakeClient:
    def __init__(self, response: httpx.Response):
        self.response = response
        self.calls = []

    async def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.response


def response(status_code: int, *, json=None, text: str = "", headers=None, url: str = "https://provider.invalid/api"):
    request = httpx.Request("GET", url)
    return httpx.Response(status_code, json=json, text=text if json is None else None, headers=headers, request=request)


def test_gitlab_candidates_are_unverified_and_record_compliance(monkeypatch):
    monkeypatch.setattr("app.search._throttle", lambda provider: asyncio.sleep(0))
    client = FakeClient(response(200, json=[{
        "id": 7,
        "path_with_namespace": "group/project",
        "name": "project",
        "web_url": "https://gitlab.com/group/project",
        "description": "candidate",
        "default_branch": "main",
    }], headers={"x-ratelimit-remaining": "12"}))

    candidates = asyncio.run(_search_gitlab(client, "active learning", 5))

    assert candidates[0]["resource_type"] == "code"
    assert candidates[0]["verified_official"] is False
    assert candidates[0]["compliance"]["provider"] == "gitlab"
    assert candidates[0]["compliance"]["rate_limit"]["remaining"] == "12"


def test_huggingface_registry_separates_dataset_and_model_candidates(monkeypatch):
    monkeypatch.setattr("app.search._throttle", lambda provider: asyncio.sleep(0))
    client = FakeClient(response(200, json=[{"id": "org/example", "downloads": 3, "likes": 1}]))

    dataset = asyncio.run(_search_huggingface(client, "example", 5, "dataset"))
    model = asyncio.run(_search_huggingface(client, "example", 5, "model"))

    assert dataset[0]["resource_type"] == "dataset"
    assert dataset[0]["url"] == "https://huggingface.co/datasets/org/example"
    assert model[0]["resource_type"] == "model"
    assert model[0]["url"] == "https://huggingface.co/org/example"
    assert dataset[0]["compliance"]["robots_status"] == "not_applicable_api"


def test_web_search_is_only_a_compliant_metadata_candidate(monkeypatch):
    monkeypatch.setattr("app.search._throttle", lambda provider: asyncio.sleep(0))
    html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpaper">Paper result</a>'
    client = FakeClient(response(200, text=html))

    candidates = asyncio.run(_search_web_pages(client, "research topic", 5))

    assert candidates[0]["resource_type"] == "web_page"
    assert candidates[0]["verified_official"] is False
    assert candidates[0]["compliance"]["robots_status"] == "deferred_until_fetch"
    assert candidates[0]["compliance"]["robots_url"] == "https://example.org/robots.txt"


def test_web_search_stops_when_provider_robots_disallow(monkeypatch):
    async def deny(client, provider, method, url, **kwargs):
        return response(200, text="User-agent: *\nDisallow: /")

    monkeypatch.setattr("app.search._provider_request", deny)
    client = FakeClient(response(200, text="unused"))

    try:
        asyncio.run(_search_web_pages(client, "research topic", 5))
    except RuntimeError as exc:
        assert str(exc) == "web_search_robots_disallowed"
    else:
        raise AssertionError("robots disallow must stop web search")
