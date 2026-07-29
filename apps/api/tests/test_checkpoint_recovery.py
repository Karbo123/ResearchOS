from uuid import uuid4

import pytest

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
