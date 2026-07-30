from types import SimpleNamespace
from uuid import uuid4

from app.impact_analysis import analyze_impact


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
        checkpoints=[SimpleNamespace(id=checkpoint_id, state={"run_id": str(experiment_id)})],
    )
    assert impact["affected_checkpoint_ids"] == [str(checkpoint_id)]
    assert impact["recommended_checkpoint_ids"] == [str(checkpoint_id)]
    assert impact["rerun_candidates"][0]["checkpoint_id"] == str(checkpoint_id)


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
