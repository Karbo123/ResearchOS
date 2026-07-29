from __future__ import annotations

from typing import Any

from .schemas import ProjectSpec

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
        if not draft.get(field):
            gaps.append(field)
    constraints = draft.get("constraints") or {}
    if not constraints.get("compute"):
        gaps.append("constraints.compute")
    return gaps


def build_spec(draft: dict[str, Any]) -> ProjectSpec:
    risks = list(draft.get("risks", []))
    ethics = draft.get("ethics_and_compliance", "")
    blocked_terms = ["违法", "攻击", "武器", "绕过安全", "illegal", "weapon", "malware"]
    sensitive_terms = ["患者", "医疗", "个人数据", "人脸", "human subject", "personal data"]
    feasibility = "high"
    notes = ["核心目标、假设、资源约束和成功标准已完成结构化。"]
    candidate_modifications = []
    approvals = ["实验计划与预计资源成本", "任何代码/配置变更", "论文对外发布"]
    all_text = f"{draft.get('research_question', '')} {ethics}".lower()
    for negated_phrase in [
        "no personal data or human subjects", "no patient data or human subjects",
        "no personal data", "no human subjects", "no patient data", "not involving personal data",
        "不涉及个人数据", "不涉及人类受试者", "无个人数据", "没有个人数据",
    ]:
        all_text = all_text.replace(negated_phrase, "")
    if any(term in all_text for term in blocked_terms):
        feasibility = "blocked"
        risks.append("检测到安全、伦理或合法性阻断项，必须人工审查后才能继续。")
        approvals.insert(0, "伦理与安全审查")
        candidate_modifications.extend([
            "将目标缩小为防御性、检测性或合规评估，不执行攻击、绕过或有害部署。",
            "使用公开、去标识且获得授权的数据，并补充正式伦理、安全与数据许可证明。",
        ])
    elif any(term in all_text for term in sensitive_terms):
        feasibility = "medium"
        risks.append("可能涉及敏感或个人数据，需要确认授权、最小化和伦理审批。")
        approvals.insert(0, "数据合规与伦理审查")
        candidate_modifications.append("改用公开去标识数据或合成数据，并在运行前完成数据授权与伦理审批。")
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
