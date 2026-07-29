from uuid import uuid4

import pytest

from app.experiment_planning import ExperimentPlanValidationError, validate_topic_specific_plan
from app.policy_engine import compile_policy_constraints
from app.schemas import (
    ExperimentPlan, ExperimentPlanAblation, ExperimentPlanBaseline, ExperimentPlanDataSource,
    ExperimentPlanMetric, ExperimentPlanResourceBudget, ExperimentPlanRisk,
    ExperimentPlanStatisticalTest, ExperimentPlanSuccessCriterion, ProjectSpec,
)


def make_plan(project_id, evidence_id, seeds=None, baseline_name="Contrastive encoder"):
    return ExperimentPlan(
        project_id=project_id,
        idea_version=1,
        research_question="Does contrastive pretraining improve image retrieval?",
        objective="Compare the proposed representation against relevant supervised baselines.",
        source_evidence_ids=[evidence_id],
        data_sources=[ExperimentPlanDataSource(
            name="Project-provided labeled images",
            purpose="Evaluate the image retrieval objective on the confirmed data source.",
            access_and_provenance="Use the dataset identified in the ProjectSpec; no new source is assumed.",
            split_and_preprocessing="Use the confirmed train/validation/test split and record preprocessing.",
            basis_evidence_ids=[evidence_id],
        )],
        baselines=[ExperimentPlanBaseline(
            name=baseline_name,
            rationale="This baseline tests the same retrieval objective with a standard representation.",
            implementation_scope="Implement the comparable encoder and keep training budget fixed.",
            comparison="Compare against the proposed method on the primary retrieval metric.",
            basis_evidence_ids=[evidence_id],
        )],
        metrics=[ExperimentPlanMetric(
            name="Recall@K", definition="Fraction of queries with a relevant item in the top K.",
            primary=True, aggregation="Report mean and per-seed dispersion.", basis_evidence_ids=[evidence_id],
        )],
        ablations=[ExperimentPlanAblation(
            component="contrastive objective", removed_or_changed="Replace it with the supervised objective.",
            rationale="Isolate the contribution of the proposed representation learning objective.",
            expected_signal="The primary metric should reveal whether the objective contributes beyond the baseline.",
            basis_evidence_ids=[evidence_id],
        )],
        statistical_tests=[ExperimentPlanStatisticalTest(
            name="paired permutation test", comparison="Per-query Recall@K differences across methods.",
            null_hypothesis="The paired metric difference is centered at zero.", alpha=0.05,
            multiple_comparison_correction="Holm correction for the prespecified metric family.",
            basis_evidence_ids=[evidence_id],
        )],
        random_seeds=seeds or [13, 37, 73],
        resource_budget=ExperimentPlanResourceBudget(
            compute_environment="The compute environment confirmed in the ProjectSpec.",
            max_runtime_hours=8, max_gpu_hours=8, memory_gb=16, budget_usd=10,
            assumptions=["Stop if the confirmed budget or data access changes."],
        ),
        risks=[ExperimentPlanRisk(
            risk="The confirmed dataset may not support the intended split.",
            mitigation="Validate the split before training and record any approved adjustment.",
            detection="Check sample counts and label availability before the first run.",
            stop_condition="Stop when the confirmed data contract cannot be met.",
            basis_evidence_ids=[evidence_id],
        )],
        success_criteria=[ExperimentPlanSuccessCriterion(
            criterion="The proposed method is practically better under the prespecified comparison.",
            metric="Recall@K", target_or_decision_rule="Report effect size and corrected uncertainty; do not infer success from one seed.",
            basis_evidence_ids=[evidence_id],
        )],
    )


def project_spec():
    return ProjectSpec.model_validate({
        "idea": {
            "title": "Contrastive image retrieval",
            "research_question": "Does contrastive pretraining improve image retrieval?",
            "domain": "computer vision",
            "hypotheses": ["Contrastive pretraining improves retrieval."],
            "expected_contributions": ["A controlled representation comparison."],
            "keywords": ["image", "retrieval", "contrastive"],
            "available_data": "Project-provided labeled images",
            "constraints": {"budget_usd": 20, "compute": "one GPU"},
        }
    })


def evidence_row(evidence_id):
    return {
        "id": str(evidence_id), "quote": "Contrastive representations improve retrieval under a controlled evaluation.",
        "locator": "page 4", "source_url": "https://arxiv.org/pdf/2401.00001",
        "metadata": {"verified": True, "pdf_sha256": "a" * 64, "bibtex": "@article{e}"},
    }


def test_topic_specific_plan_validates_against_current_idea_evidence_and_policy():
    project_id, evidence_id = uuid4(), uuid4()
    plan = make_plan(project_id, evidence_id)
    result = validate_topic_specific_plan(
        plan, project_id=project_id, idea_version=1, project_spec=project_spec(),
        evidence=[evidence_row(evidence_id)], policy_constraints=compile_policy_constraints([]),
        active_policy_ids=set(),
    )
    assert result["referenced_evidence_ids"] == [str(evidence_id)]
    assert result["idea_fingerprint"]


def test_topic_specific_plan_rejects_metadata_and_unrelated_demo():
    project_id, evidence_id = uuid4(), uuid4()
    metadata_only = evidence_row(evidence_id)
    metadata_only["locator"] = "metadata/title"
    with pytest.raises(ExperimentPlanValidationError) as error:
        validate_topic_specific_plan(
            make_plan(project_id, evidence_id), project_id=project_id, idea_version=1, project_spec=project_spec(),
            evidence=[metadata_only], policy_constraints=compile_policy_constraints([]), active_policy_ids=set(),
        )
    assert error.value.code == "verified_evidence_required"
    with pytest.raises(ExperimentPlanValidationError) as error:
        validate_topic_specific_plan(
            make_plan(project_id, evidence_id, baseline_name="point_cloud_demo"),
            project_id=project_id, idea_version=1, project_spec=project_spec(),
            evidence=[evidence_row(evidence_id)], policy_constraints=compile_policy_constraints([]), active_policy_ids=set(),
        )
    assert error.value.code == "unrelated_demo_plan"


def test_topic_specific_plan_enforces_policy_seed_count_and_budget():
    project_id, evidence_id = uuid4(), uuid4()
    plan = make_plan(project_id, evidence_id, seeds=[13, 37, 73, 101])
    constraints = compile_policy_constraints([{"id": "seed-policy", "rule": "All experiments require at least five random seeds."}])
    with pytest.raises(ExperimentPlanValidationError) as error:
        validate_topic_specific_plan(
            plan, project_id=project_id, idea_version=1, project_spec=project_spec(),
            evidence=[evidence_row(evidence_id)], policy_constraints=constraints, active_policy_ids=set(),
        )
    assert error.value.code == "minimum_random_seed_count"
