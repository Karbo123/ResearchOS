from uuid import uuid4
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from scripts.idea_case_loader import IDEA_CASES_ROOT, load_enabled_idea_cases, load_idea_case

from app.clarification import build_spec, initial_draft, required_spec_gaps
from app.llm import LLMRequestError, _system_prompt, clarification_mode_instruction, clarify_idea_with_llm, select_model_route
from app.policy_engine import compile_policy_constraints, experiment_policy_violations, seeds_for_constraints
from app.evidence_pipeline import validate_open_pdf_url
from app.related_work import build_related_work_analysis
from app.schemas import ChangeProposalRequest, ChatRequest, ExperimentRequest


def test_clarification_produces_valid_project_spec():
    case = load_idea_case("active-learning-3d")
    draft = initial_draft(case.initial_message)
    facts = case.confirmed_facts
    draft.update({
        "research_question": facts["research_question"],
        "domain": facts["domain"],
        "hypotheses": facts["hypotheses"].split("; "),
        "expected_contributions": facts["expected_contributions"].split("; "),
        "available_data": facts["available_data"],
        "constraints": {"compute": facts["constraints"], "budget_usd": 50, "deadline": facts["constraints"], "data_access": "public"},
        "success_criteria": [facts["success_criteria"]],
        "target_venues": facts["target_venues"].split("; "),
        "ethics_and_compliance": facts["ethics_and_compliance"],
    })
    assert required_spec_gaps(draft) == []
    spec = build_spec(draft)
    assert spec.idea.domain == facts["domain"]
    assert spec.feasibility.value == case.expect["final_feasibility"]
    assert spec.idea.target_venues == facts["target_venues"].split("; ")


def test_unconfirmed_data_or_compute_placeholders_block_ready_spec():
    case = load_idea_case("active-learning-3d")
    draft = initial_draft(case.initial_message)
    facts = case.confirmed_facts
    draft.update({
        "research_question": facts["research_question"],
        "domain": facts["domain"],
        "hypotheses": facts["hypotheses"].split("; "),
        "expected_contributions": facts["expected_contributions"].split("; "),
        "available_data": "Dataset access is not confirmed.",
        "success_criteria": [facts["success_criteria"]],
        "ethics_and_compliance": facts["ethics_and_compliance"],
        "constraints": {"compute": "GPU to be confirmed", "data_access": "not provided"},
    })
    gaps = required_spec_gaps(draft)
    assert {"available_data", "constraints.compute", "constraints.data_access"}.issubset(gaps)


def test_short_idea_requires_a_research_question():
    case = load_idea_case("insufficient-ai")
    draft = initial_draft(case.initial_message)
    assert all(field in required_spec_gaps(draft) for field in case.expect["missing_fields_contains"])


def test_mnist_idea_uses_medium_tier():
    case = load_idea_case("mnist-cnn")
    draft = initial_draft(case.initial_message)
    route = select_model_route(case.initial_message, draft)
    assert route.tier == case.expect["model_tier"]


def test_direct_model_failure_is_an_error_and_never_switches_provider(monkeypatch):
    case = load_idea_case("mnist-cnn")
    monkeypatch.setenv("RESEARCH_LLM_PROVIDER", "openai")
    monkeypatch.setenv("RESEARCH_MODEL_URL_MEDIUM", "https://model.invalid/v1")
    monkeypatch.setenv("RESEARCH_MODEL_KEY_MEDIUM", "test-key")

    def direct_failure(*args, **kwargs):
        raise RuntimeError("model timed out")

    monkeypatch.setattr("app.llm.OpenAI", direct_failure)
    with pytest.raises(LLMRequestError) as error:
        clarify_idea_with_llm(case.initial_message, clarification_mode=case.clarification_mode)
    assert error.value.code == "llm_request_failed"
    assert error.value.status_code == 502


def test_model_tiers_are_independent(monkeypatch, tmp_path):
    monkeypatch.setenv("MODEL_SETTINGS_PATH", str(tmp_path / "model-settings.json"))
    monkeypatch.setenv("RESEARCH_MODEL_URL_SIMPLE", "https://simple.invalid/v1")
    monkeypatch.setenv("RESEARCH_MODEL_KEY_SIMPLE", "simple-key")
    monkeypatch.setenv("RESEARCH_MODEL_URL_MEDIUM", "https://medium.invalid/v1")
    monkeypatch.setenv("RESEARCH_MODEL_KEY_MEDIUM", "medium-key")
    monkeypatch.setenv("RESEARCH_MODEL_URL_COMPLEX", "https://complex.invalid/v1")
    monkeypatch.setenv("RESEARCH_MODEL_KEY_COMPLEX", "complex-key")
    from app.model_settings import public_settings

    catalog = public_settings()
    assert catalog["simple"]["url"] == "https://simple.invalid/v1"
    assert catalog["medium"]["url"] == "https://medium.invalid/v1"
    assert catalog["complex"]["url"] == "https://complex.invalid/v1"
    assert all("key" not in item for item in catalog.values())


def test_model_provider_must_be_explicit(monkeypatch):
    monkeypatch.setenv("RESEARCH_LLM_PROVIDER", "")
    with pytest.raises(LLMRequestError) as error:
        clarify_idea_with_llm("简短研究想法")
    assert error.value.code == "llm_provider_not_configured"
    assert error.value.status_code == 503


def test_related_work_keeps_metadata_candidates_out_of_factual_evidence():
    analysis = build_related_work_analysis(
        {"research_question": "Does active learning improve point cloud labeling?", "hypotheses": ["active learning improves labeling"], "expected_contributions": ["a labeling budget comparison"]},
        [{"id": "paper-1", "title": "Active learning for point cloud labeling", "doi": "10.1000/example", "source_url": "https://example.invalid/paper"}],
        [{"id": "evidence-1", "paper_id": "paper-1", "claim": "Metadata record", "quote": "Title-only metadata", "locator": "metadata/title", "source_url": "https://example.invalid/paper", "metadata": {"verified": False}}],
    )
    assert analysis["fulltext_evidence_count"] == 0
    assert analysis["metadata_candidate_count"] == 1
    assert analysis["related_work"][0]["status"] == "metadata_candidate"
    assert analysis["evidence"] == []
    assert analysis["assessment"] == "metadata_only_insufficient_evidence"


def test_related_work_links_only_verified_page_evidence_and_marks_candidates_for_review():
    analysis = build_related_work_analysis(
        {"research_question": "Does active learning improve point cloud labeling?", "hypotheses": ["active learning improves labeling"], "expected_contributions": ["a labeling budget comparison"]},
        [{"id": "paper-1", "title": "Active learning for point cloud labeling", "doi": "10.1000/example", "source_url": "https://example.invalid/paper", "verified": True}],
        [{"id": "evidence-1", "paper_id": "paper-1", "claim": "Active learning improves labeling", "quote": "Active learning improves labeling under a fixed budget.", "locator": "page 4", "source_url": "https://example.invalid/paper", "metadata": {"verified": True, "pdf_sha256": "a" * 64, "bibtex": "@article{example}"}}],
    )
    assert analysis["fulltext_evidence_count"] == 1
    assert analysis["related_work"][0]["status"] == "fulltext_evidence"
    assert analysis["coverage"][0]["status"] == "covered_candidate"
    assert analysis["duplicate_candidates"][0]["requires_human_review"] is True
    assert analysis["claim_gate"].startswith("Only verified page-level evidence")


def test_router_uses_simple_and_complex_cost_tiers():
    simple_case = load_idea_case("insufficient-ai")
    active_learning_case = load_idea_case("active-learning-3d")
    complex_case = load_idea_case("complex-medical-detailed")
    assert select_model_route(simple_case.initial_message, initial_draft(simple_case.initial_message)).tier == simple_case.expect["model_tier"]
    assert select_model_route(active_learning_case.initial_message, initial_draft(active_learning_case.initial_message)).tier == active_learning_case.expect["model_tier"]
    assert select_model_route(complex_case.initial_message, initial_draft(complex_case.initial_message)).tier == complex_case.expect["model_tier"]


def test_all_idea_cases_load_from_the_public_fixed_directory():
    cases = load_enabled_idea_cases()
    assert cases and all(case.source_path.parent == IDEA_CASES_ROOT for case in cases)


def test_chat_mode_defaults_to_automatic_and_rejects_unknown_values():
    case = load_idea_case("mnist-cnn")
    assert ChatRequest(message=case.initial_message).clarification_mode == "automatic"
    with pytest.raises(ValidationError):
        ChatRequest(message=case.initial_message, clarification_mode="scripted")


def test_mode_prompts_minimize_or_expand_questions_without_fixed_queue():
    automatic = clarification_mode_instruction("automatic")
    detailed = clarification_mode_instruction("detailed")
    assert "no more than two" in automatic and "minimize" in automatic
    assert "four to eight" in detailed and "scripted checklist" in detailed
    assert automatic in _system_prompt("automatic")
    assert detailed in _system_prompt("detailed")


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
        "retrieve_citation_evidence", "generate_experiment_plan", "configure_model_settings", "submit_experiment",
        "query_experiment_status", "read_metrics", "collect_visual_artifacts", "rerun_experiment_from_checkpoint",
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
