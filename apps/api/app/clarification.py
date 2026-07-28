from __future__ import annotations

import re
from typing import Any

from .schemas import ProjectSpec


QUESTIONS = {
    "research_question": "请把研究 Idea 明确成一个可检验的研究问题，并说明研究对象和预期比较对象。",
    "domain": "这个 Idea 主要属于哪个研究领域？请给出尽量具体的子领域。",
    "hypotheses": "你希望验证的核心假设是什么？可以列出一到三个可证伪的假设。",
    "expected_contributions": "预期创新点或贡献是什么？请说明它应当区别于现有工作的地方。",
    "available_data": "可用数据是什么？请说明来源、规模、访问条件，以及隐私或许可证限制。",
    "constraints": "可用算力、预算和截止时间是什么？例如 GPU 型号/数量、预算上限和目标日期。",
    "success_criteria": "怎样算研究成功？请给出目标指标、基线、统计要求或目标会议/期刊。",
    "target_venues": "目标会议、期刊或其他发表渠道是什么？尚未确定时请明确写“未确定”。",
    "ethics_and_compliance": "是否涉及人类受试者、个人/敏感数据、双重用途、安全或其他合规风险？",
}

ORDER = list(QUESTIONS)


def _split_items(text: str) -> list[str]:
    parts = re.split(r"[\n;；] |[\n;；]|(?:\d+[.)、]\s*)", text)
    return [p.strip(" -，,") for p in parts if p.strip(" -，,")]


def initial_draft(message: str) -> dict[str, Any]:
    clean = message.strip()
    title = clean.splitlines()[0][:120]
    if len(title) < 3:
        title = "Untitled research idea"
    keywords = [w for w in re.findall(r"[A-Za-z][A-Za-z0-9+._-]{2,}|[\u4e00-\u9fff]{2,6}", clean)[:10]]
    return {
        "title": title,
        "research_question": clean,
        "keywords": list(dict.fromkeys(keywords)),
        "hypotheses": [],
        "expected_contributions": [],
        "target_venues": [],
        "success_criteria": [],
        "risks": [],
        "open_questions": [],
        "constraints": {},
    }


def apply_answer(draft: dict[str, Any], field: str, answer: str) -> None:
    if field in {"hypotheses", "expected_contributions", "success_criteria", "target_venues"}:
        draft[field] = _split_items(answer)
    elif field == "constraints":
        budget_match = re.search(r"(?:\$|USD\s*)(\d+(?:\.\d+)?)", answer, re.I)
        draft[field] = {
            "compute": answer,
            "budget_usd": float(budget_match.group(1)) if budget_match else None,
            "deadline": answer if any(x in answer for x in ["月", "周", "202", "day", "week"]) else None,
            "data_access": None,
        }
    else:
        draft[field] = answer.strip()


def missing_fields(draft: dict[str, Any]) -> list[str]:
    missing = []
    for field in ORDER:
        value = draft.get(field)
        if not value or (field == "research_question" and len(str(value).strip()) < 10):
            missing.append(field)
    return missing


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
    return ProjectSpec.model_validate({
        "idea": {
            **draft,
            "domain": draft["domain"],
            "available_data": draft.get("available_data"),
            "ethics_and_compliance": ethics,
        },
        "feasibility": feasibility,
        "feasibility_notes": notes,
        "required_approvals": approvals,
        "candidate_modifications": candidate_modifications,
    })
