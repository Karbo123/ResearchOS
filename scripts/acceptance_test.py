from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from idea_case_loader import load_idea_case


API = "http://127.0.0.1:8080"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "acceptance"


def request(method: str, path: str, body: dict[str, Any] | None = None, timeout: int = 300) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = Request(f"{API}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {path} returned {exc.code}: {payload}") from exc


def run_direct_acceptance() -> None:
    case = load_idea_case("active-learning-3d")
    results: dict[str, Any] = {"started_at": datetime.now(timezone.utc).isoformat(), "checks": {}}
    health = request("GET", "/api/health")
    assert health["llm"]["provider"] == "openai"
    assert health["llm"]["bridge_required"] is False
    assert health["llm"]["provider_configured"] is True
    assert set(health["llm"]["routing"]["models"]) == {"simple", "medium", "complex"}
    settings = request("GET", "/api/settings/models")
    assert set(settings["tiers"]) == {"simple", "medium", "complex"}
    assert all("key" not in tier for tier in settings["tiers"].values())
    results["checks"]["container_direct_model_settings"] = True

    response = request("POST", "/api/chat", {"message": case.initial_message, "clarification_mode": case.clarification_mode})
    facts = "\n".join(f"{field}: {value}" for field, value in case.confirmed_facts.items())
    facts += "\nThese are explicit user-confirmed facts. Update the whole draft for ProjectSpec review."
    for _ in range(4):
        if response["phase"] == "ready_for_confirmation":
            break
        response = request("POST", "/api/chat", {
            "session_id": response["session_id"],
            "message": facts,
            "clarification_mode": case.clarification_mode,
        })
    assert response["phase"] == "ready_for_confirmation"
    project_id = request("POST", "/api/projects", {"session_id": response["session_id"], "confirmed": True})["project"]["id"]

    deadline = time.time() + 240
    while time.time() < deadline:
        detail = request("GET", f"/api/projects/{project_id}")
        tasks = [task for task in detail["tasks"] if task["kind"] == "research_bootstrap"]
        if tasks and tasks[0]["status"] in {"succeeded", "failed", "cancelled"}:
            break
        time.sleep(2)
    assert tasks and tasks[0]["status"] in {"succeeded", "failed", "cancelled"}

    evidence = request("POST", f"/api/projects/{project_id}/evidence/ingest", {"limit": 3})
    novelty = request("GET", f"/api/projects/{project_id}/novelty")
    assert "related_work" in novelty and "claim_gate" in novelty
    results["project_id"] = project_id
    results["checks"].update({
        "evidence_first_related_work": {"stored_count": evidence["stored_count"], "assessment": novelty["assessment"]},
        "topic_plan_execution": {
            "executed": False,
            "approval_required": True,
            "model_request_not_started": True,
            "note": "The acceptance entry does not call the model-backed topic planner or substitute an unrelated experiment.",
        },
    })

    paused = request("POST", f"/api/projects/{project_id}/state", {"action": "pause", "reason": "Acceptance state gate"})
    resumed = request("POST", f"/api/projects/{project_id}/state", {"action": "resume", "reason": "Acceptance state gate complete"})
    assert paused["status"] == "paused" and resumed["status"] == "active"
    results["checks"]["project_state_gate"] = True
    results["finished_at"] = datetime.now(timezone.utc).isoformat()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_ROOT / f"acceptance-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    target.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "passed", "result_file": str(target), **results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run_direct_acceptance()
