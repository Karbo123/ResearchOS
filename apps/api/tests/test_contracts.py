from uuid import uuid4
import json
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from scripts.idea_case_loader import IDEA_CASES_ROOT, load_enabled_idea_cases, load_idea_case

from app.clarification import build_spec, initial_draft, required_spec_gaps
from app.llm import LLMRequestError, _system_prompt, clarification_mode_instruction, clarify_idea_with_llm, select_model_route
from app.policy_engine import compile_policy_constraints, experiment_policy_violations, seeds_for_constraints
from app.evidence_pipeline import validate_open_pdf_url
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


def test_short_idea_requires_a_research_question():
    case = load_idea_case("insufficient-ai")
    draft = initial_draft(case.initial_message)
    assert all(field in required_spec_gaps(draft) for field in case.expect["missing_fields_contains"])


def test_mnist_idea_uses_medium_tier():
    case = load_idea_case("mnist-cnn")
    draft = initial_draft(case.initial_message)
    route = select_model_route(case.initial_message, draft)
    assert route.tier == case.expect["model_tier"]


def test_model_failure_is_an_error_and_never_switches_provider(monkeypatch):
    case = load_idea_case("mnist-cnn")
    monkeypatch.setenv("RESEARCH_LLM_PROVIDER", "codex_bridge")
    monkeypatch.setenv("CODEX_BRIDGE_URL", "http://bridge.invalid")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-used")

    def bridge_failure(*args, **kwargs):
        raise httpx.TimeoutException("bridge timed out")

    monkeypatch.setattr("app.llm.httpx.post", bridge_failure)
    monkeypatch.setattr("app.llm.OpenAI", lambda *args, **kwargs: pytest.fail("provider switch attempted"))
    with pytest.raises(LLMRequestError) as error:
        clarify_idea_with_llm(case.initial_message, clarification_mode=case.clarification_mode)
    assert error.value.code == "llm_timeout"
    assert error.value.status_code == 504


def test_model_provider_must_be_explicit(monkeypatch):
    monkeypatch.setenv("RESEARCH_LLM_PROVIDER", "")
    with pytest.raises(LLMRequestError) as error:
        clarify_idea_with_llm("简短研究想法")
    assert error.value.code == "llm_provider_not_configured"
    assert error.value.status_code == 503


def test_router_uses_simple_and_complex_cost_tiers():
    simple_case = load_idea_case("insufficient-ai")
    complex_case = load_idea_case("complex-medical-detailed")
    assert select_model_route(simple_case.initial_message, initial_draft(simple_case.initial_message)).tier == simple_case.expect["model_tier"]
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
