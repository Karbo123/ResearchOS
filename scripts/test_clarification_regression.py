from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from idea_case_loader import IdeaCase, load_enabled_idea_cases


API = "http://127.0.0.1:8080"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "idea-tests"
MAX_CONVERGENCE_TURNS = 4
REQUEST_TIMEOUT_SECONDS = 90


def request(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = Request(f"{API}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        raise AssertionError(f"{method} {path} returned {exc.code}: {exc.read().decode('utf-8', errors='replace')}") from exc


def post_initial(case: IdeaCase) -> dict[str, Any]:
    return request("POST", "/api/chat", {
        "message": case.initial_message,
        "clarification_mode": case.clarification_mode,
    })


def confirmed_facts_message(case: IdeaCase) -> str:
    return "\n".join(f"{field}: {value}" for field, value in case.confirmed_facts.items()) + (
        "\nThese are explicit user-confirmed facts. Update the entire draft and prepare it for ProjectSpec review; "
        "do not create or execute a project."
    )


def safe_response(case: IdeaCase, response: dict[str, Any]) -> dict[str, Any]:
    return {
        "case_id": case.id,
        "session_id": response["session_id"],
        "phase": response["phase"],
        "clarification_mode": response["clarification_mode"],
        "model_tier": response["model_tier"],
        "model": response["model"],
        "reasoning_effort": response["reasoning_effort"],
        "missing_fields": response["missing_fields"],
        "ready_for_confirmation": response["phase"] == "ready_for_confirmation",
    }


def write_report(target: Path, report: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def assert_route(case: IdeaCase, response: dict[str, Any], configured_models: dict[str, Any]) -> None:
    expected = case.expect
    tier = expected["model_tier"]
    assert response["model_tier"] == tier, (case.id, response)
    assert response["model"] == configured_models[tier]["model"], (case.id, response)
    assert response["reasoning_effort"] == configured_models[tier]["reasoning_effort"], (case.id, response)
    assert response["clarification_mode"] == case.clarification_mode, (case.id, response)


def run_case(case: IdeaCase, configured_models: dict[str, Any]) -> dict[str, Any]:
    response = post_initial(case)
    assert_route(case, response, configured_models)
    expected = case.expect
    if "phase" in expected:
        assert response["phase"] == expected["phase"], (case.id, response)
    if "missing_fields_contains" in expected:
        assert all(item in response["missing_fields"] for item in expected["missing_fields_contains"]), (case.id, response)
    if "reply_contains_any" in expected:
        assert any(item in response["reply"] for item in expected["reply_contains_any"]), (case.id, response)
    if "reply_excludes" in expected:
        assert all(item not in response["reply"] for item in expected["reply_excludes"]), (case.id, response)
    if not case.confirmed_facts:
        return safe_response(case, response)
    message = confirmed_facts_message(case)
    for _ in range(MAX_CONVERGENCE_TURNS):
        if response["phase"] == "ready_for_confirmation":
            assert response["spec"], (case.id, response)
            return safe_response(case, response)
        response = request("POST", "/api/chat", {
            "session_id": response["session_id"],
            "message": message,
            "clarification_mode": case.clarification_mode,
        })
        assert_route(case, response, configured_models)
    raise AssertionError(f"{case.id} did not converge after {MAX_CONVERGENCE_TURNS} confirmation turns")


def main() -> None:
    health = request("GET", "/api/health")
    configured_models = health["llm"]["routing"]["models"]
    cases = load_enabled_idea_cases()
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    target = OUTPUT_ROOT / "clarification-regression-latest.json"
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "request_timeout_seconds": REQUEST_TIMEOUT_SECONDS,
        "configured_models": configured_models,
        "cases": results,
        "failures": failures,
        "concurrent_mnist": [],
    }
    write_report(target, report)
    for case in cases:
        try:
            results.append(run_case(case, configured_models))
        except Exception as exc:
            failures.append({"case_id": case.id, "error": str(exc)})
        write_report(target, report)
    concurrent_results: list[dict[str, Any]] = []
    if not failures:
        mnist = next(case for case in cases if case.id == "mnist-cnn")
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                concurrent_results = list(executor.map(lambda _: run_case(mnist, configured_models), range(2)))
        except Exception as exc:
            failures.append({"case_id": "mnist-cnn-concurrent", "error": str(exc)})
    report["concurrent_mnist"] = concurrent_results
    write_report(target, report)
    if failures:
        raise AssertionError(f"clarification regression failures: {failures}")
    print(json.dumps({"status": "passed", "result_file": str(target), "case_count": len(results)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
