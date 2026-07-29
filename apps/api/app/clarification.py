from __future__ import annotations

from typing import Any

from .schemas import ProjectSpec


UNCONFIRMED_MARKERS = (
    "尚未", "未确认", "未知", "待确认", "未提供",
    "unknown", "not confirmed", "not provided", "to be confirmed",
)


def _is_unconfirmed(value: Any) -> bool:
    if not value:
        return True
    text = str(value).lower()
    return any(marker in text for marker in UNCONFIRMED_MARKERS)

def initial_draft(message: str) -> dict[str, Any]:
    clean = message.strip()
    title = clean.splitlines()[0][:120]
    if len(title) < 3:
        title = "Untitled research idea"
    return {
        "title": title,
        "research_question": clean,
        "domain": None,
        "keywords": [],
        "hypotheses": [],
        "expected_contributions": [],
        "target_venues": [],
        "available_data": None,
        "success_criteria": [],
        "risks": [],
        "open_questions": [],
        "constraints": {"compute": None, "budget_usd": None, "deadline": None, "data_access": None},
        "ethics_and_compliance": None,
    }


def required_spec_gaps(draft: dict[str, Any]) -> list[str]:
    """Return schema-level gaps without deciding which conversational question to ask."""
    gaps: list[str] = []
    if len(str(draft.get("research_question") or "").strip()) < 10:
        gaps.append("research_question")
    for field in ("domain", "hypotheses", "expected_contributions", "available_data", "success_criteria", "ethics_and_compliance"):
        if _is_unconfirmed(draft.get(field)):
            gaps.append(field)
    constraints = draft.get("constraints") or {}
    for field in ("compute", "data_access"):
        if _is_unconfirmed(constraints.get(field)):
            gaps.append(f"constraints.{field}")
    return gaps


def build_spec(draft: dict[str, Any]) -> ProjectSpec:
    risks = list(draft.get("risks", []))
    ethics = draft.get("ethics_and_compliance", "")
    feasibility = "high"
    notes = ["核心目标、假设、资源约束和成功标准已完成结构化。"]
    candidate_modifications = []
    approvals = ["实验计划与预计资源成本", "任何代码/配置变更", "论文对外发布"]
    data_text = str(draft.get("available_data", "")).lower()
    if any(term in data_text for term in ["没有数据", "无数据", "not available", "no data"]):
        feasibility = "medium" if feasibility == "high" else feasibility
        risks.append("当前没有可执行的数据来源，实验计划必须先解决数据可得性与许可证问题。")
        candidate_modifications.append("先设计公开数据集或合成数据的可复现实验，再把私有数据作为后续扩展。")
    idea = {
        key: draft.get(key)
        for key in (
            "title", "research_question", "domain", "hypotheses", "expected_contributions",
            "keywords", "target_venues", "available_data", "constraints", "success_criteria",
            "risks", "open_questions", "ethics_and_compliance",
        )
    }
    return ProjectSpec.model_validate({
        "idea": {
            **idea,
            "domain": draft["domain"],
            "ethics_and_compliance": ethics,
        },
        "feasibility": feasibility,
        "feasibility_notes": notes,
        "required_approvals": approvals,
        "candidate_modifications": candidate_modifications,
    })
