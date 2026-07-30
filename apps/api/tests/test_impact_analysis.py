from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.impact_analysis import ImpactAnalysisError, analyze_impact


def test_idea_revision_invalidates_only_old_idea_descendants():
    old_artifact = uuid4()
    unrelated_artifact = uuid4()
    old_experiment = uuid4()
    artifacts = [
        SimpleNamespace(id=old_artifact, experiment_id=old_experiment, metadata_json={}),
        SimpleNamespace(id=unrelated_artifact, experiment_id=None, metadata_json={}),
    ]
    dependencies = [
        SimpleNamespace(artifact_id=old_artifact, upstream_type="idea_version", upstream_id="1"),
    ]
    impact = analyze_impact(
        change_kind="idea_revision",
        payload={"base_idea_version": 1},
        current_idea_version=1,
        artifacts=artifacts,
        dependencies=dependencies,
        experiments=[SimpleNamespace(id=old_experiment, experiment_type="topic", status="succeeded")],
        checkpoints=[],
    )
    assert impact["affected_artifact_ids"] == [str(old_artifact)]
    assert impact["unaffected_artifact_ids"] == [str(unrelated_artifact)]
    assert impact["rerun_candidates"][0]["experiment_id"] == str(old_experiment)


def test_policy_change_follows_artifact_descendant_edges():
    policy_artifact = uuid4()
    descendant = uuid4()
    artifacts = [
        SimpleNamespace(id=policy_artifact, experiment_id=None, metadata_json={}),
        SimpleNamespace(id=descendant, experiment_id=None, metadata_json={}),
    ]
    dependencies = [
        SimpleNamespace(artifact_id=policy_artifact, upstream_type="policy_snapshot", upstream_id="old"),
        SimpleNamespace(artifact_id=descendant, upstream_type="artifact", upstream_id=str(policy_artifact)),
    ]
    impact = analyze_impact(
        change_kind="config_change",
        payload={"policy_rule": "use five seeds"},
        current_idea_version=1,
        artifacts=artifacts,
        dependencies=dependencies,
        experiments=[],
        checkpoints=[],
    )
    assert set(impact["affected_artifact_ids"]) == {str(policy_artifact), str(descendant)}


def test_policy_change_does_not_invalidate_artifacts_only_because_idea_version_matches():
    artifact = uuid4()
    impact = analyze_impact(
        change_kind="config_change",
        payload={"base_idea_version": 1, "policy_rule": "use five seeds"},
        current_idea_version=1,
        artifacts=[SimpleNamespace(id=artifact, experiment_id=None, metadata_json={"idea_version": 1})],
        dependencies=[], experiments=[], checkpoints=[],
    )
    assert impact["affected_artifact_ids"] == []


def test_unrelated_change_has_no_implicit_global_invalidation():
    artifact = SimpleNamespace(id=uuid4(), experiment_id=None, metadata_json={})
    impact = analyze_impact(
        change_kind="experiment_plan",
        payload={},
        current_idea_version=1,
        artifacts=[artifact],
        dependencies=[],
        experiments=[],
        checkpoints=[],
    )
    assert impact["affected_artifact_ids"] == []
    assert impact["rerun_scope"] == "none"


def test_code_and_data_changes_follow_only_matching_dependency_types():
    code_artifact = uuid4()
    data_artifact = uuid4()
    unrelated = uuid4()
    dependencies = [
        SimpleNamespace(artifact_id=code_artifact, upstream_type="project_git_commit", upstream_id="abc"),
        SimpleNamespace(artifact_id=data_artifact, upstream_type="data_version", upstream_id="v2"),
        SimpleNamespace(artifact_id=unrelated, upstream_type="idea_version", upstream_id="1"),
    ]
    code_impact = analyze_impact(
        change_kind="code_patch", payload={"base_git_commit": "abc"}, current_idea_version=1,
        artifacts=[SimpleNamespace(id=item, experiment_id=None, metadata_json={}) for item in (code_artifact, data_artifact, unrelated)],
        dependencies=dependencies, experiments=[], checkpoints=[],
    )
    data_impact = analyze_impact(
        change_kind="data_change", payload={"base_data_version": "v2"}, current_idea_version=1,
        artifacts=[SimpleNamespace(id=item, experiment_id=None, metadata_json={}) for item in (code_artifact, data_artifact, unrelated)],
        dependencies=dependencies, experiments=[], checkpoints=[],
    )
    assert code_impact["affected_artifact_ids"] == [str(code_artifact)]
    assert data_impact["affected_artifact_ids"] == [str(data_artifact)]


def test_affected_terminal_experiment_exposes_its_checkpoint_for_local_rerun():
    artifact_id = uuid4()
    experiment_id = uuid4()
    checkpoint_id = uuid4()
    impact = analyze_impact(
        change_kind="idea_revision",
        payload={"base_idea_version": 1},
        current_idea_version=1,
        artifacts=[SimpleNamespace(id=artifact_id, experiment_id=experiment_id, metadata_json={})],
        dependencies=[SimpleNamespace(artifact_id=artifact_id, upstream_type="idea_version", upstream_id="1")],
        experiments=[SimpleNamespace(id=experiment_id, experiment_type="topic", status="succeeded")],
        checkpoints=[SimpleNamespace(id=checkpoint_id, stage="experiment_succeeded", state={"run_id": str(experiment_id)})],
    )
    assert impact["affected_checkpoint_ids"] == [str(checkpoint_id)]
    assert impact["recommended_checkpoint_ids"] == [str(checkpoint_id)]
    assert impact["rerun_candidates"][0]["checkpoint_id"] == str(checkpoint_id)


def test_recommended_checkpoint_is_latest_rerunnable_terminal_checkpoint():
    artifact_id = uuid4()
    experiment_id = uuid4()
    older = uuid4()
    newer = uuid4()
    paused = uuid4()
    impact = analyze_impact(
        change_kind="idea_revision",
        payload={"base_idea_version": 1},
        current_idea_version=1,
        artifacts=[SimpleNamespace(id=artifact_id, experiment_id=experiment_id, metadata_json={})],
        dependencies=[SimpleNamespace(artifact_id=artifact_id, upstream_type="idea_version", upstream_id="1")],
        experiments=[SimpleNamespace(id=experiment_id, experiment_type="topic", status="succeeded")],
        checkpoints=[
            SimpleNamespace(id=older, stage="experiment_succeeded", state={"run_id": str(experiment_id)}, created_at=datetime(2026, 7, 29, tzinfo=timezone.utc)),
            SimpleNamespace(id=paused, stage="project_paused", state={"run_id": str(experiment_id)}, created_at=datetime(2026, 7, 31, tzinfo=timezone.utc)),
            SimpleNamespace(id=newer, stage="experiment_failed", state={"run_id": str(experiment_id)}, created_at=datetime(2026, 7, 30, tzinfo=timezone.utc)),
        ],
    )
    assert impact["recommended_checkpoint_ids"] == [str(newer)]
    assert impact["rerun_candidates"][0]["checkpoint_id"] == str(newer)


def test_impact_contains_reviewable_dependency_graph_and_experiment_edges():
    artifact_id = uuid4()
    experiment_id = uuid4()
    impact = analyze_impact(
        change_kind="data_change",
        payload={"base_data_version": "v1"},
        current_idea_version=1,
        artifacts=[SimpleNamespace(id=artifact_id, experiment_id=None, valid=True, metadata_json={})],
        dependencies=[SimpleNamespace(
            artifact_id=artifact_id, upstream_type="experiment", upstream_id=str(experiment_id), relation="generated_by",
        ), SimpleNamespace(
            artifact_id=artifact_id, upstream_type="data_version", upstream_id="v1", relation="captured_data",
        )],
        experiments=[SimpleNamespace(id=experiment_id, experiment_type="python_analysis", status="succeeded")],
        checkpoints=[],
    )
    assert impact["affected_artifact_ids"] == [str(artifact_id)]
    assert impact["affected_experiment_ids"] == [str(experiment_id)]
    assert impact["dependency_graph"]["nodes"][0]["affected"] is True
    assert {edge["upstream_type"] for edge in impact["dependency_graph"]["edges"]} == {"experiment", "data_version"}


@pytest.mark.parametrize(
    "change_kind,payload,code",
    [
        ("unknown_change", {}, "impact_change_kind_unsupported"),
        ("code_patch", {}, "impact_base_git_commit_required"),
        ("dependency_install", {}, "impact_base_git_commit_required"),
        ("data_change", {}, "impact_base_data_version_required"),
        ("delete_artifact", {}, "impact_artifact_id_required"),
    ],
)
def test_impact_rejects_incomplete_or_unknown_change_roots(change_kind, payload, code):
    with pytest.raises(ImpactAnalysisError) as error:
        analyze_impact(
            change_kind=change_kind,
            payload=payload,
            current_idea_version=1,
            artifacts=[], dependencies=[], experiments=[], checkpoints=[],
        )
    assert error.value.code == code


def test_impact_rejects_deleting_an_artifact_outside_the_project():
    with pytest.raises(ImpactAnalysisError) as error:
        analyze_impact(
            change_kind="delete_artifact",
            payload={"artifact_id": str(uuid4())},
            current_idea_version=1,
            artifacts=[], dependencies=[], experiments=[], checkpoints=[],
        )
    assert error.value.code == "impact_artifact_not_found"
