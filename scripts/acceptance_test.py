from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from idea_case_loader import IdeaCase, load_idea_case


API = "http://127.0.0.1:8080"
MLFLOW = "http://127.0.0.1:5000"
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


def expected_http_error(method: str, path: str, body: dict[str, Any], status: int) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = Request(f"{API}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        urlopen(req, timeout=60)
    except HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        assert exc.code == status, (exc.code, payload)
        return json.loads(payload)
    raise AssertionError(f"{method} {path} unexpectedly succeeded")


def clarify(case: IdeaCase) -> dict[str, Any]:
    response = request("POST", "/api/chat", {
        "message": case.initial_message,
        "clarification_mode": case.clarification_mode,
    })
    consolidated = "\n".join(f"{field}: {value}" for field, value in case.confirmed_facts.items())
    consolidated += "\nThese are explicit user-confirmed facts. Update the whole draft and prepare it for ProjectSpec review; do not create or execute a project."
    for _ in range(4):
        if response["phase"] == "ready_for_confirmation":
            assert response["spec"]
            return response
        response = request("POST", "/api/chat", {
            "session_id": response["session_id"],
            "message": consolidated,
            "clarification_mode": case.clarification_mode,
        })
    raise AssertionError("clarification did not converge")


def wait_for_project(project_id: str, terminal_stages: set[str], timeout: int = 240) -> dict[str, Any]:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = request("GET", f"/api/projects/{project_id}")
        if last["project"]["stage"] in terminal_stages:
            return last
        time.sleep(2)
    raise AssertionError(f"project stage timeout; last={last['project'] if last else None}")


def wait_for_bootstrap(project_id: str, timeout: int = 60) -> dict[str, Any]:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = request("GET", f"/api/projects/{project_id}")
        bootstrap = [task for task in last["tasks"] if task["kind"] == "research_bootstrap"]
        if bootstrap and bootstrap[0]["status"] in {"succeeded", "failed", "cancelled"}:
            return last
        time.sleep(1)
    raise AssertionError(f"bootstrap task timeout; last={last['tasks'] if last else None}")


def approve(proposal_id: str) -> None:
    result = request("POST", f"/api/proposals/{proposal_id}/decision", {
        "decision": "approved", "actor": "acceptance-test", "comment": "Approved for isolated local acceptance testing",
    })
    assert result["status"] == "approved"


def run_proposal(project_id: str, proposal: dict[str, Any], approve_first: bool = True) -> dict[str, Any]:
    if approve_first:
        approve(proposal["id"])
    payload = proposal["payload"]
    submitted = request("POST", "/api/experiments", {
        "project_id": project_id,
        "proposal_id": proposal["id"],
        "experiment_type": payload["experiment_type"],
        "config": payload.get("config", {}),
        "random_seeds": payload.get("random_seeds", [13]),
    })
    run_id = submitted["run_id"]
    deadline = time.time() + 180
    status = None
    while time.time() < deadline:
        status = request("POST", f"/api/experiments/{run_id}/sync")
        if status["status"] in {"succeeded", "failed", "cancelled"}:
            break
        time.sleep(2)
    assert status and status["status"] == "succeeded", status
    return status


def create_experiment_proposal(
    project_id: str,
    experiment_type: str,
    config: dict[str, Any],
    random_seeds: list[int],
    summary: str,
) -> dict[str, Any]:
    created = request("POST", "/api/proposals", {
        "project_id": project_id,
        "kind": "experiment_plan",
        "reason": "Acceptance test for an explicitly allowlisted isolated task",
        "summary": summary,
        "impact": {"rerun_experiments": [experiment_type], "invalidates": [], "artifacts": []},
        "estimated_cost_usd": 0,
        "payload": {
            "experiment_type": experiment_type,
            "config": config,
            "random_seeds": random_seeds,
        },
    })
    detail = request("GET", f"/api/projects/{project_id}")
    return next(item for item in detail["proposals"] if item["id"] == created["id"])


def mlflow_run_exists(run_id: str) -> bool:
    with urlopen(f"{MLFLOW}/api/2.0/mlflow/runs/get?run_id={run_id}", timeout=30) as response:
        return response.status == 200 and bool(json.loads(response.read()).get("run"))


def main() -> None:
    insufficient_case = load_idea_case("insufficient-ai")
    mnist_case = load_idea_case("mnist-cnn")
    project_case = load_idea_case("active-learning-3d")
    results: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "checks": {},
    }
    health = request("GET", "/api/health")
    assert health["llm"]["provider"] == "codex_bridge"
    assert health["llm"]["codex_bridge_configured"] is True
    assert health["llm"]["routing"]["models"] == {
        "simple": {"model": "gpt-5.6-luna", "reasoning_effort": "low"},
        "medium": {"model": "gpt-5.6-terra", "reasoning_effort": "medium"},
        "complex": {"model": "gpt-5.6-sol", "reasoning_effort": "high"},
    }
    results["llm"] = health["llm"]
    print("PASS llm_bridge adaptive Luna/Terra/Sol routing", flush=True)

    short = request("POST", "/api/chat", {
        "message": insufficient_case.initial_message,
        "clarification_mode": insufficient_case.clarification_mode,
    })
    assert short["phase"] == insufficient_case.expect["phase"]
    assert all(field in short["missing_fields"] for field in insufficient_case.expect["missing_fields_contains"])
    results["checks"]["insufficient_idea_clarifies"] = True
    print("PASS insufficient_idea_clarifies", flush=True)

    mnist = request("POST", "/api/chat", {
        "message": mnist_case.initial_message,
        "clarification_mode": mnist_case.clarification_mode,
    })
    assert mnist["phase"] == mnist_case.expect["phase"]
    assert mnist["model_tier"] == mnist_case.expect["model_tier"] and mnist["model"] == mnist_case.expect["model"]
    assert mnist["fallback_used"] is False
    assert any(term in mnist["reply"] for term in mnist_case.expect["reply_contains_any"])
    assert all(term not in mnist["reply"] for term in mnist_case.expect["reply_excludes"])
    results["checks"]["adaptive_mnist_domain"] = {
        "model_tier": mnist["model_tier"], "model": mnist["model"], "fallback_used": mnist["fallback_used"],
    }
    print("PASS adaptive_mnist_domain", flush=True)

    normal = clarify(project_case)
    created = request("POST", "/api/projects", {"session_id": normal["session_id"], "confirmed": True})
    project_id = created["project"]["id"]
    results["project_id"] = project_id
    detail = wait_for_project(project_id, {"awaiting_experiment_approval", "workflow_trigger_failed"})
    detail = wait_for_bootstrap(project_id)
    assert detail["project"]["stage"] == "awaiting_experiment_approval", detail["project"]
    assert detail["counts"]["papers"] > 0, detail["counts"]
    assert any(task["kind"] == "research_bootstrap" and task["status"] == "succeeded" for task in detail["tasks"])
    assert detail["counts"]["repositories"] >= 0
    enforcement = detail["policy_enforcement"]
    assert enforcement["citation"]["doi_or_source_url"] is True
    assert enforcement["citation"]["quoted_evidence"] is True
    assert enforcement["approval"]["high_cost_actions"] is True
    assert enforcement["approval"]["external_actions"] is True
    assert enforcement["citation_readiness"]["page_or_section_quoted_evidence"] == 0
    assert enforcement["citation_readiness"]["quoted_evidence_requirement_satisfied"] is False
    results["checks"]["n8n_automatic_bootstrap"] = {
        "papers": detail["counts"]["papers"],
        "repositories": detail["counts"]["repositories"],
    }
    print("PASS n8n_automatic_bootstrap", flush=True)

    evidence_result = request("POST", f"/api/projects/{project_id}/evidence/ingest", {"limit": 3})
    assert evidence_result["stored_count"] >= 3, evidence_result
    for item in evidence_result["evidence"]:
        assert item["locator"].startswith("page ")
        assert len(item["quote"]) >= 80
        assert len(item["pdf_sha256"]) == 64
        assert item["source_url"].startswith("https://")
        assert item["bibtex"].startswith("@")
    evidence_detail = request("GET", f"/api/projects/{project_id}")
    readiness = evidence_detail["policy_enforcement"]["citation_readiness"]
    assert readiness["page_or_section_quoted_evidence"] >= 3
    assert readiness["quoted_evidence_requirement_satisfied"] is True
    assert sum(1 for item in evidence_detail["evidence"] if item["metadata"].get("verified")) >= 3
    results["checks"]["fulltext_evidence"] = {
        "stored_count": evidence_result["stored_count"],
        "pdf_hashes": [item["pdf_sha256"] for item in evidence_result["evidence"]],
    }
    print("PASS fulltext_evidence", flush=True)

    experiment_proposal = next(p for p in detail["proposals"] if p["kind"] == "experiment_plan" and p["status"] == "pending")
    original_stage = detail["project"]["stage"]
    paused = request("POST", f"/api/projects/{project_id}/state", {"action": "pause", "reason": "Acceptance test state gate"})
    assert paused["status"] == "paused" and paused["stage"] == "paused"
    expected_http_error("POST", "/api/search", {"project_id": project_id, "limit": 1}, 409)
    expected_http_error("POST", f"/api/projects/{project_id}/experiment-plan", {}, 409)
    approve(experiment_proposal["id"])
    expected_http_error("POST", "/api/experiments", {
        "project_id": project_id,
        "proposal_id": experiment_proposal["id"],
        "experiment_type": experiment_proposal["payload"]["experiment_type"],
        "config": experiment_proposal["payload"].get("config", {}),
        "random_seeds": experiment_proposal["payload"].get("random_seeds", [13]),
    }, 409)
    resumed = request("POST", f"/api/projects/{project_id}/state", {"action": "resume", "reason": "Acceptance test resumes from checkpoint"})
    assert resumed["status"] == "active" and resumed["stage"] == original_stage, resumed
    results["checks"]["project_state_gate"] = {"blocked_while_paused": True, "resumed_stage": resumed["stage"]}
    print("PASS project_state_gate", flush=True)

    run = run_proposal(project_id, experiment_proposal, approve_first=False)
    assert run["mlflow_run_id"] and mlflow_run_exists(run["mlflow_run_id"])
    kinds = {item["kind"] for item in run["artifacts"]}
    assert {"metric_plot", "confusion_matrix", "metrics", "point_cloud", "point_cloud_preview"}.issubset(kinds), kinds
    assert all(item["metadata"].get("git_commit") not in {None, "unavailable"} for item in run["artifacts"])
    results["checks"]["isolated_experiment"] = {"metrics": run["metrics"], "artifact_kinds": sorted(kinds), "mlflow_run_id": run["mlflow_run_id"]}
    print("PASS isolated_experiment", flush=True)

    policy_change = request("POST", "/api/chat", {
        "session_id": normal["session_id"],
        "project_id": project_id,
        "message": project_case.project_messages["policy_update"],
    })
    assert policy_change["action_required"]
    approve(policy_change["action_required"])
    policy_detail = request("GET", f"/api/projects/{project_id}")
    assert policy_detail["policy_enforcement"]["minimum_random_seed_count"] == 5

    legacy_proposal = create_experiment_proposal(
        project_id, "point_cloud_demo", {}, [13, 37, 73],
        "Deliberately violate the active seed policy to verify submission revalidation.",
    )
    approve(legacy_proposal["id"])
    violation = expected_http_error("POST", "/api/experiments", {
        "project_id": project_id,
        "proposal_id": legacy_proposal["id"],
        "experiment_type": legacy_proposal["payload"]["experiment_type"],
        "config": legacy_proposal["payload"]["config"],
        "random_seeds": legacy_proposal["payload"]["random_seeds"],
    }, 409)
    assert violation["detail"]["code"] == "policy_violation"
    assert violation["detail"]["violations"][0]["code"] == "minimum_random_seed_count"

    policy_plan_result = request("POST", f"/api/projects/{project_id}/experiment-plan", {})
    assert len(set(policy_plan_result["plan"]["random_seeds"])) == 5
    policy_detail = request("GET", f"/api/projects/{project_id}")
    policy_plan = next(p for p in policy_detail["proposals"] if p["id"] == policy_plan_result["proposal_id"])
    policy_run = run_proposal(project_id, policy_plan)
    assert policy_run["metrics"]["seed_count"] == 5
    assert all(item["metadata"]["policy_constraints"]["minimum_random_seed_count"] == 5 for item in policy_run["artifacts"])
    results["checks"]["policy_execution_engine"] = {
        "minimum_random_seed_count": 5,
        "structured_submission_violation": True,
        "citation_fulltext_evidence_ready": True,
        "high_cost_and_external_approval_required": True,
        "runner_revalidated": True,
    }
    print("PASS policy_execution_engine", flush=True)

    cancellation_proposal = create_experiment_proposal(
        project_id,
        "point_cloud_demo",
        {"delay_seconds": 5},
        [101, 103, 107, 109, 113],
        "Run a delayed point-cloud task solely to verify project pause cancellation.",
    )
    approve(cancellation_proposal["id"])
    cancellation_run = request("POST", "/api/experiments", {
        "project_id": project_id,
        "proposal_id": cancellation_proposal["id"],
        "experiment_type": cancellation_proposal["payload"]["experiment_type"],
        "config": cancellation_proposal["payload"]["config"],
        "random_seeds": cancellation_proposal["payload"]["random_seeds"],
    })
    paused_run = request("POST", f"/api/projects/{project_id}/state", {"action": "pause", "reason": "Cancel active acceptance run"})
    assert paused_run["runner_outcomes"].get(cancellation_run["run_id"]) == "cancelled", paused_run
    cancelled_run = request("POST", f"/api/experiments/{cancellation_run['run_id']}/sync")
    assert cancelled_run["status"] == "cancelled", cancelled_run
    resumed = request("POST", f"/api/projects/{project_id}/state", {"action": "resume", "reason": "Continue after cancellation test"})
    assert resumed["status"] == "active" and resumed["stage"] == "results_review", resumed
    results["checks"]["active_run_cancelled_on_pause"] = {"run_id": cancellation_run["run_id"]}
    print("PASS active_run_cancelled_on_pause", flush=True)

    report = request("POST", "/api/reports", {"project_id": project_id, "period": "daily"})
    assert "## Literature" in report["content"] and "## Experiments" in report["content"]
    results["checks"]["daily_report"] = True
    print("PASS daily_report", flush=True)

    change = request("POST", "/api/chat", {
        "session_id": normal["session_id"],
        "project_id": project_id,
        "message": project_case.project_messages["idea_revision"],
    })
    assert change["action_required"]
    approve(change["action_required"])
    revised = request("GET", f"/api/projects/{project_id}")
    assert revised["project"]["idea_version"] == 2
    assert revised["project"]["stage"] == "impact_review"
    assert revised["counts"]["feedback"] > 0
    results["checks"]["approved_idea_revision"] = True
    print("PASS approved_idea_revision", flush=True)

    rerun_proposal = create_experiment_proposal(
        project_id,
        "point_cloud_demo",
        {},
        [13, 37, 73, 101, 137],
        "Rerun only the point-cloud visualization after the approved Idea revision.",
    )
    rerun = run_proposal(project_id, rerun_proposal)
    assert any(item["kind"] == "point_cloud" for item in rerun["artifacts"])
    results["checks"]["approved_partial_rerun"] = {"run_id": rerun["run_id"]}
    print("PASS approved_partial_rerun", flush=True)

    compile_plan = request("POST", f"/api/projects/{project_id}/compile-plan")
    revised = request("GET", f"/api/projects/{project_id}")
    compile_proposal = next(p for p in revised["proposals"] if p["id"] == compile_plan["proposal_id"])
    compiled = run_proposal(project_id, compile_proposal)
    assert any(item["kind"] == "paper_pdf" for item in compiled["artifacts"])
    results["checks"]["latex_compiled"] = {"run_id": compiled["run_id"], "mlflow_run_id": compiled["mlflow_run_id"]}
    print("PASS latex_compiled", flush=True)

    final = request("GET", f"/api/projects/{project_id}")
    assert final["counts"]["checkpoints"] >= 3
    assert final["artifact_dependencies"]
    results["checks"]["persistent_lineage"] = {
        "checkpoints": final["counts"]["checkpoints"],
        "dependencies": len(final["artifact_dependencies"]),
    }
    cancelled_project = request("POST", f"/api/projects/{project_id}/state", {
        "action": "cancel",
        "reason": "Acceptance project reached its terminal test state",
    })
    assert cancelled_project["status"] == "cancelled" and cancelled_project["stage"] == "cancelled"
    expected_http_error("POST", f"/api/projects/{project_id}/state", {
        "action": "resume",
        "reason": "A terminal project must not resume",
    }, 409)
    results["checks"]["cancel_is_terminal"] = True
    print("PASS cancel_is_terminal", flush=True)
    results["finished_at"] = datetime.now(timezone.utc).isoformat()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_ROOT / f"acceptance-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    target.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "passed", "result_file": str(target), **results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
