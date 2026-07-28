from uuid import uuid4
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.clarification import ORDER, apply_answer, build_spec, initial_draft, missing_fields
from app.policy_engine import compile_policy_constraints, experiment_policy_violations, seeds_for_constraints
from app.evidence_pipeline import validate_open_pdf_url
from app.schemas import ChangeProposalRequest, ExperimentRequest


def test_clarification_produces_valid_project_spec():
    draft = initial_draft("Can active learning reduce annotation cost for point cloud classification?")
    answers = {
        "research_question": "Can active learning reduce annotation cost for point cloud classification?",
        "domain": "3D computer vision",
        "hypotheses": "Uncertainty sampling beats random sampling at equal annotation cost",
        "expected_contributions": "A calibrated acquisition function; reproducible benchmark",
        "available_data": "ModelNet40 under its published license",
        "constraints": "One 24GB GPU, $50, eight weeks",
        "success_criteria": "At least two percentage points above random sampling across five seeds",
        "target_venues": "CVPR workshop",
        "ethics_and_compliance": "No personal data or human subjects",
    }
    for field in ORDER:
        apply_answer(draft, field, answers[field])
    assert missing_fields(draft) == []
    spec = build_spec(draft)
    assert spec.idea.domain == "3D computer vision"
    assert spec.feasibility == "high"
    assert spec.idea.target_venues == ["CVPR workshop"]


def test_short_idea_requires_a_research_question():
    draft = initial_draft("AI")
    assert "research_question" in missing_fields(draft)


def test_blocked_idea_includes_candidate_modifications():
    draft = initial_draft("Build malware that bypasses endpoint security controls")
    answers = {
        "research_question": "Can malware bypass endpoint security controls in production?",
        "domain": "Offensive security",
        "hypotheses": "A bypass can evade current controls",
        "expected_contributions": "A working bypass",
        "available_data": "Private endpoint telemetry",
        "constraints": "One GPU, USD 100, four weeks",
        "success_criteria": "Successful execution on production endpoints",
        "target_venues": "Undetermined",
        "ethics_and_compliance": "No authorization is available",
    }
    for field in ORDER:
        apply_answer(draft, field, answers[field])
    spec = build_spec(draft)
    assert spec.feasibility == "blocked"
    assert spec.candidate_modifications


def test_runner_contract_rejects_arbitrary_shell_and_path():
    with pytest.raises(ValidationError):
        ExperimentRequest(
            project_id=uuid4(), proposal_id=uuid4(), experiment_type="demo_classification",
            config={"command": "rm -rf /"}, random_seeds=[1],
        )
    with pytest.raises(ValidationError):
        ExperimentRequest(
            project_id=uuid4(), proposal_id=uuid4(), experiment_type="demo_classification",
            config={"path": "../../outside"}, random_seeds=[1],
        )


def test_runner_contract_limits_seed_count():
    with pytest.raises(ValidationError):
        ExperimentRequest(
            project_id=uuid4(), proposal_id=uuid4(), experiment_type="point_cloud_demo",
            config={}, random_seeds=list(range(11)),
        )


def test_runner_contract_rejects_unknown_config_and_long_delay():
    with pytest.raises(ValidationError):
        ExperimentRequest(
            project_id=uuid4(), proposal_id=uuid4(), experiment_type="demo_classification",
            config={"learning_rate": 0.1}, random_seeds=[1],
        )
    with pytest.raises(ValidationError):
        ExperimentRequest(
            project_id=uuid4(), proposal_id=uuid4(), experiment_type="point_cloud_demo",
            config={"delay_seconds": 11}, random_seeds=[1],
        )
    with pytest.raises(ValidationError):
        ExperimentRequest(
            project_id=uuid4(), proposal_id=uuid4(), experiment_type="demo_classification",
            config={"n_samples": 10_000_000}, random_seeds=[1],
        )


def test_policy_engine_parses_chinese_and_english_requirements():
    constraints = compile_policy_constraints([
        {"id": "seed-zh", "rule": "所有实验至少使用五个随机种子"},
        {"id": "seed-en", "rule": "Every experiment must use at least four random seeds."},
        {"id": "citation", "rule": "所有引用必须保存 DOI 或来源链接以及原文证据"},
        {"id": "approval", "rule": "High-cost or externally visible actions require explicit approval."},
    ])
    assert constraints.minimum_random_seed_count == 5
    assert constraints.citation.doi_or_source_url is True
    assert constraints.citation.quoted_evidence is True
    assert constraints.approval.high_cost_actions is True
    assert constraints.approval.external_actions is True
    assert constraints.public_dict()["status"] == "enforced"
    assert len(seeds_for_constraints(constraints)) == 5


def test_policy_engine_returns_structured_seed_violation():
    constraints = compile_policy_constraints([
        {"id": "seed-policy", "rule": "All experiments require at least five random seeds."},
    ])
    violations = experiment_policy_violations(
        constraints, "demo_classification", [13, 37, 73], approval_granted=True,
    )
    assert violations == [{
        "code": "minimum_random_seed_count",
        "message": "The experiment does not satisfy the active minimum random-seed policy.",
        "required": 5,
        "actual": 3,
        "policy_ids": ["seed-policy"],
    }]


def test_policy_engine_rejects_constraint_above_runner_limit():
    constraints = compile_policy_constraints([
        {"id": "too-many", "rule": "所有实验至少使用十二个随机种子"},
    ])
    assert constraints.runner_compatible is False
    assert constraints.unsupported_constraints[0]["code"] == "seed_count_exceeds_runner_limit"


def test_evidence_pipeline_restricts_pdf_sources():
    validate_open_pdf_url("https://arxiv.org/pdf/2401.00001")
    with pytest.raises(ValueError):
        validate_open_pdf_url("http://arxiv.org/pdf/2401.00001")
    with pytest.raises(ValueError):
        validate_open_pdf_url("https://example.com/paper.pdf")
    with pytest.raises(ValueError):
        validate_open_pdf_url("https://arxiv.org.evil.example/paper.pdf")


def test_tool_catalog_contains_valid_schemas():
    catalog_path = Path(__file__).parents[3] / "schemas" / "tool-contracts.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    expected = {
        "clarify_research_idea", "create_research_project", "evaluate_novelty_and_feasibility",
        "search_papers_and_bibtex", "find_official_code_repository", "download_open_source_code",
        "retrieve_citation_evidence", "generate_experiment_plan", "submit_experiment",
        "query_experiment_status", "read_metrics", "collect_visual_artifacts",
        "render_point_cloud_preview", "propose_code_patch", "update_project_policy", "compile_latex",
    }
    assert {tool["name"] for tool in catalog["tools"]} == expected
    for tool in catalog["tools"]:
        assert isinstance(tool["input"], dict) and tool["input"]
        assert isinstance(tool["output"], dict) and tool["output"]
        assert any(keyword in tool["input"] for keyword in {"type", "$ref", "allOf"})


def test_code_change_requires_diff():
    with pytest.raises(ValidationError):
        ChangeProposalRequest(
            project_id=uuid4(), kind="code_patch", reason="Fix evaluation bug",
            summary="Change metric aggregation", payload={},
        )
