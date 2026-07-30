import asyncio
from uuid import uuid4
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest

from app import main as api_main
from app.checkpoint_recovery import CheckpointRecoveryError, build_rerun_payload, validate_rerun_payload
from app.models import Checkpoint, Experiment


def topic_plan(project_id):
    evidence_id = uuid4()
    return {
        "schema_version": "1.0", "plan_type": "topic_specific", "project_id": str(project_id),
        "idea_version": 1, "research_question": "How does the approved method affect the target outcome?",
        "objective": "Evaluate the approved topic-specific method with reproducible measurements.",
        "source_evidence_ids": [str(evidence_id)], "policy_ids": [],
        "data_sources": [{"name": "dataset", "purpose": "evaluation input", "access_and_provenance": "approved local source", "split_and_preprocessing": "fixed split"}],
        "baselines": [{"name": "baseline", "rationale": "direct comparison", "implementation_scope": "same data", "comparison": "same metrics", "basis_evidence_ids": [str(evidence_id)]}],
        "metrics": [{"name": "score", "definition": "primary evaluation score", "primary": True, "aggregation": "mean", "basis_evidence_ids": [str(evidence_id)]}],
        "ablations": [{"component": "approved component", "removed_or_changed": "remove it", "rationale": "test contribution", "expected_signal": "score changes", "basis_evidence_ids": [str(evidence_id)]}],
        "statistical_tests": [{"name": "paired test", "comparison": "method vs baseline", "null_hypothesis": "no difference", "alpha": 0.05, "multiple_comparison_correction": "none", "basis_evidence_ids": [str(evidence_id)]}],
        "random_seeds": [13, 37, 73],
        "resource_budget": {"compute_environment": "fixed runner", "max_runtime_hours": 1, "max_gpu_hours": 0, "memory_gb": 4, "budget_usd": 0, "assumptions": []},
        "risks": [{"risk": "data shift", "mitigation": "record split", "detection": "compare validation", "stop_condition": "missing data", "basis_evidence_ids": [str(evidence_id)]}],
        "success_criteria": [{"criterion": "produce the primary metric", "metric": "score", "target_or_decision_rule": "report without scientific overclaim", "basis_evidence_ids": [str(evidence_id)]}],
    }


def test_checkpoint_rerun_preserves_only_original_allowlisted_request():
    checkpoint_id = uuid4()
    experiment_id = uuid4()
    payload = build_rerun_payload(
        checkpoint_id=str(checkpoint_id),
        checkpoint_stage="experiment_succeeded",
        checkpoint_state={"run_id": str(experiment_id)},
        experiment_id=str(experiment_id),
        experiment_status="succeeded",
        experiment_type="demo_classification",
        experiment_config={
            "project_slug": "ignored-at-recovery",
            "n_samples": 600,
            "n_features": 12,
            "_random_seeds": [13, 37, 73],
            "_reproducibility": {"project_git_commit": "old"},
        },
    )
    assert payload["checkpoint_id"] == str(checkpoint_id)
    assert payload["source_experiment_id"] == str(experiment_id)
    assert payload["config"] == {"n_samples": 600, "n_features": 12}
    assert payload["random_seeds"] == [13, 37, 73]
    assert payload["rerun_mode"] == "same_allowlisted_template_on_current_snapshot"


@pytest.mark.parametrize(
    "kwargs, code",
    [
        ({"checkpoint_stage": "project_paused"}, "checkpoint_not_rerunnable"),
        ({"experiment_status": "running"}, "experiment_not_terminal"),
        ({"checkpoint_state": {"run_id": str(uuid4())}}, "checkpoint_experiment_mismatch"),
        ({"experiment_type": "topic_specific"}, "topic_plan_missing"),
        ({"experiment_config": {}}, "checkpoint_random_seeds_missing"),
    ],
)
def test_checkpoint_rerun_rejects_unsafe_or_incomplete_sources(kwargs, code):
    experiment_id = str(uuid4())
    base = {
        "checkpoint_id": str(uuid4()),
        "checkpoint_stage": "experiment_succeeded",
        "checkpoint_state": {"run_id": experiment_id},
        "experiment_id": experiment_id,
        "experiment_status": "succeeded",
        "experiment_type": "demo_classification",
        "experiment_config": {"_random_seeds": [13]},
    }
    base.update(kwargs)
    with pytest.raises(CheckpointRecoveryError) as error:
        build_rerun_payload(**base)
    assert error.value.code == code


def test_checkpoint_rerun_rejects_tampered_proposal_payload():
    experiment_id = str(uuid4())
    source = {
        "checkpoint_id": str(uuid4()),
        "checkpoint_stage": "experiment_failed",
        "checkpoint_state": {"run_id": experiment_id},
        "experiment_id": experiment_id,
        "experiment_status": "failed",
        "experiment_type": "point_cloud_demo",
        "experiment_config": {"delay_seconds": 1, "_random_seeds": [13, 37, 73]},
    }
    payload = build_rerun_payload(**source)
    payload["config"]["delay_seconds"] = 10
    with pytest.raises(CheckpointRecoveryError) as error:
        validate_rerun_payload(proposal_payload=payload, **source)
    assert error.value.code == "checkpoint_rerun_payload_mismatch"


def test_topic_checkpoint_rerun_preserves_plan_and_fixed_resume_context():
    experiment_id = str(uuid4())
    plan = topic_plan(uuid4())
    source = {
        "checkpoint_id": str(uuid4()),
        "checkpoint_stage": "experiment_succeeded",
        "checkpoint_state": {"run_id": experiment_id, "topic_checkpoint": {"schema_version": "1.0", "name": "epoch-1", "state": {"step": 1}}},
        "experiment_id": experiment_id,
        "experiment_status": "succeeded",
        "experiment_type": "topic_specific",
        "experiment_config": {"_random_seeds": [13, 37, 73], "_topic_plan": plan},
    }
    payload = build_rerun_payload(**source)
    assert payload["config"] == {}
    assert payload["topic_plan"] == plan
    assert payload["topic_resume"]["checkpoint_id"] == source["checkpoint_id"]
    assert payload["rerun_mode"] == "topic_specific_fixed_entrypoint_resume"


def test_approved_checkpoint_rerun_uses_the_normal_submission_chain(monkeypatch):
    proposal_id = uuid4()
    project_id = uuid4()
    run_id = uuid4()
    proposal = type("ProposalStub", (), {
        "id": proposal_id,
        "project_id": project_id,
        "kind": "experiment_rerun",
        "status": "approved",
        "payload": {
            "checkpoint_id": str(uuid4()),
            "source_experiment_id": str(uuid4()),
            "experiment_type": "demo_classification",
            "config": {"n_samples": 100, "n_features": 4},
            "random_seeds": [13, 37, 73],
        },
        "impact": {"no_fallback": True},
    })()

    class FakeSession:
        def get(self, model, identifier):
            return proposal if identifier == proposal_id else None

        def add(self, value):
            return None

    class FakeContext:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, *args):
            return False

    submit = AsyncMock(return_value={"run_id": str(run_id), "status": "queued"})
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext())
    monkeypatch.setattr(api_main, "submit_experiment", submit)

    result = asyncio.run(api_main._auto_submit_checkpoint_rerun(proposal_id))

    assert result == {
        "status": "queued",
        "run_id": str(run_id),
        "mode": "automatic_checkpoint_rerun",
    }
    submit.assert_awaited_once()
    request = submit.await_args.args[0]
    assert request.project_id == project_id
    assert request.proposal_id == proposal_id
    assert request.experiment_type == "demo_classification"
    assert request.config == {"n_samples": 100, "n_features": 4}
    assert request.random_seeds == [13, 37, 73]
    assert proposal.impact["automatic_execution"]["run_id"] == str(run_id)


def test_checkpoint_rerun_submission_failure_stays_structured_and_never_falls_back(monkeypatch):
    proposal_id = uuid4()
    project_id = uuid4()
    proposal = type("ProposalStub", (), {
        "id": proposal_id,
        "project_id": project_id,
        "kind": "experiment_rerun",
        "status": "approved",
        "payload": {
            "experiment_type": "point_cloud_demo",
            "config": {"delay_seconds": 0},
            "random_seeds": [13],
        },
        "impact": {"no_fallback": True},
    })()

    class FakeSession:
        def get(self, model, identifier):
            return proposal if identifier == proposal_id else None

        def add(self, value):
            return None

    class FakeContext:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, *args):
            return False

    failure = api_main.HTTPException(status_code=503, detail={
        "code": "runner_unavailable",
        "message": "Runner unavailable",
    })
    submit = AsyncMock(side_effect=failure)
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext())
    monkeypatch.setattr(api_main, "submit_experiment", submit)

    with pytest.raises(api_main.HTTPException) as error:
        asyncio.run(api_main._auto_submit_checkpoint_rerun(proposal_id))

    assert error.value.status_code == 503
    assert error.value.detail == {"code": "runner_unavailable", "message": "Runner unavailable"}
    submit.assert_awaited_once()
    request = submit.await_args.args[0]
    assert request.experiment_type == "point_cloud_demo"
    assert request.random_seeds == [13]


def test_approved_change_creates_pending_rerun_from_impact_graph():
    project_id = uuid4()
    proposal_id = uuid4()
    experiment_id = uuid4()
    checkpoint_id = uuid4()
    project = SimpleNamespace(id=project_id)
    source_proposal = SimpleNamespace(id=proposal_id)
    checkpoint = SimpleNamespace(
        id=checkpoint_id, project_id=project_id, stage="experiment_succeeded",
        state={"run_id": str(experiment_id)},
    )
    experiment = SimpleNamespace(
        id=experiment_id, project_id=project_id, status="succeeded",
        experiment_type="python_analysis", config={"entrypoint": "experiment/main.py", "_random_seeds": [13, 37, 73]},
    )

    class FakeResult:
        def all(self):
            return []

    class FakeSession:
        def __init__(self):
            self.added = []

        def get(self, model, identifier):
            if model is Checkpoint and identifier == checkpoint_id:
                return checkpoint
            if model is Experiment and identifier == experiment_id:
                return experiment
            return None

        def scalars(self, _statement):
            return FakeResult()

        def add(self, value):
            self.added.append(value)

        def flush(self):
            for value in self.added:
                if getattr(value, "id", None) is None:
                    value.id = uuid4()

    impact = {
        "rerun_candidates": [{
            "experiment_id": str(experiment_id),
            "checkpoint_id": str(checkpoint_id),
        }],
    }
    session = FakeSession()
    api_main._create_impact_rerun_proposals(session, project, source_proposal, impact)

    reruns = [item for item in session.added if getattr(item, "kind", None) == "experiment_rerun"]
    assert len(reruns) == 1
    assert reruns[0].status == "pending"
    assert reruns[0].payload["source_experiment_id"] == str(experiment_id)
    assert reruns[0].impact["source_proposal_id"] == str(proposal_id)
    assert reruns[0].impact["automatic_execution"] is False
    assert impact["automatic_rerun_proposals"] == [str(reruns[0].id)]
