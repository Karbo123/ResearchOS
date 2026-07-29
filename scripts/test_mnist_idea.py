from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from idea_case_loader import load_idea_case


API = "http://127.0.0.1:8080"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "idea-tests"


def post_chat(body: dict[str, Any]) -> dict[str, Any]:
    request = Request(
        f"{API}/api/chat",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=300) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"MNIST Idea request returned {exc.code}: {payload}") from exc


def main() -> None:
    case = load_idea_case("mnist-cnn")
    result = post_chat({
        "message": case.initial_message,
        "attachments": [],
        "clarification_mode": case.clarification_mode,
    })
    expected = case.expect
    assert result["phase"] == expected["phase"]
    assert result["model_tier"] == expected["model_tier"]
    assert result["model"] == expected["model"]
    assert result["clarification_mode"] == case.clarification_mode
    assert result["fallback_used"] is False
    assert any(term in result["reply"] for term in expected["reply_contains_any"])
    assert all(term not in result["reply"] for term in expected["reply_excludes"])
    safe_result = {
        "case_id": case.id,
        "case_source": str(case.source_path),
        "session_id": result["session_id"],
        "phase": result["phase"],
        "clarification_mode": result["clarification_mode"],
        "model_tier": result["model_tier"],
        "model": result["model"],
        "reasoning_effort": result["reasoning_effort"],
        "fallback_used": result["fallback_used"],
        "reply": result["reply"],
        "missing_fields": result["missing_fields"],
    }
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_ROOT / "mnist-cnn-latest.json"
    target.write_text(json.dumps(safe_result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "passed", "result_file": str(target), **safe_result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
