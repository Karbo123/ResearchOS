import asyncio
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from app import main as api_main
from app.checkpoint_recovery import CheckpointRecoveryError, build_rerun_payload, validate_rerun_payload


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
        ({"experiment_type": "topic_specific"}, "experiment_type_not_rerunnable"),
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
