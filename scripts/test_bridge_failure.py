from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from idea_case_loader import load_idea_case


API = "http://127.0.0.1:8080"


def main() -> None:
    case = load_idea_case("mnist-cnn")
    request = Request(
        f"{API}/api/chat",
        data=json.dumps({
            "message": case.initial_message,
            "clarification_mode": case.clarification_mode,
        }, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        urlopen(request, timeout=30)
    except HTTPError as exc:
        payload = json.loads(exc.read())
        assert exc.code == 502, payload
        assert payload["detail"]["code"] == "llm_request_failed", payload
        print(json.dumps({"status": "passed", "case_id": case.id, "code": payload["detail"]["code"]}))
        return
    raise AssertionError("Bridge failure unexpectedly returned a successful model response")


if __name__ == "__main__":
    main()
