from __future__ import annotations

import re
from typing import Any, Iterable

from pydantic import BaseModel, ConfigDict, Field


MAX_RUNNER_SEEDS = 10
DEFAULT_SEEDS = [13, 37, 73, 101, 137, 173, 211, 251, 293, 337]


class CitationRequirements(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doi_or_source_url: bool = False
    quoted_evidence: bool = False


class ApprovalRequirements(BaseModel):
    model_config = ConfigDict(extra="forbid")

    high_cost_actions: bool = False
    external_actions: bool = False


class PolicyConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minimum_random_seed_count: int = Field(default=1, ge=1, le=100)
    citation: CitationRequirements = Field(default_factory=CitationRequirements)
    approval: ApprovalRequirements = Field(default_factory=ApprovalRequirements)
    active_policy_count: int = 0
    recognized_policy_ids: list[str] = Field(default_factory=list)
    unrecognized_policy_ids: list[str] = Field(default_factory=list)
    matches: list[dict[str, Any]] = Field(default_factory=list)
    unsupported_constraints: list[dict[str, Any]] = Field(default_factory=list)

    @property
    def runner_compatible(self) -> bool:
        return self.minimum_random_seed_count <= MAX_RUNNER_SEEDS and not self.unsupported_constraints

    def public_dict(self) -> dict[str, Any]:
        result = self.model_dump(mode="json")
        result["runner_compatible"] = self.runner_compatible
        result["status"] = (
            "no_active_policies"
            if self.active_policy_count == 0
            else "partially_enforced"
            if self.unrecognized_policy_ids or self.unsupported_constraints
            else "enforced"
        )
        return result


_ENGLISH_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
_CHINESE_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _number(value: str) -> int | None:
    value = value.strip().lower()
    if value.isdigit():
        return int(value)
    if value in _ENGLISH_NUMBERS:
        return _ENGLISH_NUMBERS[value]
    if value in _CHINESE_DIGITS:
        return _CHINESE_DIGITS[value]
    if "十" in value:
        left, right = value.split("十", 1)
        tens = _CHINESE_DIGITS.get(left, 1) if left else 1
        units = _CHINESE_DIGITS.get(right, 0) if right else 0
        return tens * 10 + units
    return None


def _seed_count(rule: str) -> int | None:
    patterns = [
        r"(?:至少|最少|不少于)\s*(?:使用|采用|运行)?\s*([0-9一二两三四五六七八九十]+)\s*(?:个|组)?\s*(?:独立)?\s*随机(?:数)?种子",
        r"(?:at\s+least|minimum(?:\s+of)?|no\s+fewer\s+than)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:distinct\s+)?random\s+seeds?",
    ]
    for pattern in patterns:
        match = re.search(pattern, rule, re.IGNORECASE)
        if match:
            return _number(match.group(1))
    return None


def _policy_parts(policy: Any) -> tuple[str, str]:
    if isinstance(policy, dict):
        return str(policy.get("id", "unknown")), str(policy.get("rule", ""))
    return str(getattr(policy, "id", "unknown")), str(getattr(policy, "rule", ""))


def compile_policy_constraints(policies: Iterable[Any]) -> PolicyConstraints:
    constraints = PolicyConstraints()
    for policy in policies:
        policy_id, rule = _policy_parts(policy)
        text = rule.lower()
        requirements: list[str] = []

        seed_count = _seed_count(rule)
        if seed_count:
            constraints.minimum_random_seed_count = max(constraints.minimum_random_seed_count, seed_count)
            requirements.append(f"minimum_random_seed_count={seed_count}")
            if seed_count > MAX_RUNNER_SEEDS:
                constraints.unsupported_constraints.append({
                    "code": "seed_count_exceeds_runner_limit",
                    "policy_id": policy_id,
                    "required": seed_count,
                    "runner_maximum": MAX_RUNNER_SEEDS,
                })

        citation_rule = any(marker in text for marker in ("citation", "citations", "reference", "references", "引用", "参考文献"))
        if citation_rule and any(marker in text for marker in ("doi", "source url", "source link", "来源链接", "来源 url", "来源url", "可验证来源")):
            constraints.citation.doi_or_source_url = True
            requirements.append("citation_doi_or_source_url")
        if citation_rule and any(marker in text for marker in ("quoted evidence", "quote evidence", "verbatim evidence", "原文证据", "原文引文", "页码证据")):
            constraints.citation.quoted_evidence = True
            requirements.append("citation_quoted_evidence")

        approval_rule = any(marker in text for marker in ("approval", "approve", "approved", "批准", "审批", "批复"))
        if approval_rule and any(marker in text for marker in ("high-cost", "high cost", "expensive", "高成本", "高费用")):
            constraints.approval.high_cost_actions = True
            requirements.append("approval_for_high_cost_actions")
        if approval_rule and any(marker in text for marker in ("externally visible", "external action", "external publish", "publish", "对外", "发布")):
            constraints.approval.external_actions = True
            requirements.append("approval_for_external_actions")

        constraints.active_policy_count += 1
        if requirements:
            constraints.recognized_policy_ids.append(policy_id)
            constraints.matches.append({"policy_id": policy_id, "rule": rule, "requirements": requirements})
        else:
            constraints.unrecognized_policy_ids.append(policy_id)
    return constraints


def seeds_for_constraints(constraints: PolicyConstraints, default_count: int = 3) -> list[int]:
    count = max(default_count, constraints.minimum_random_seed_count)
    return DEFAULT_SEEDS[:count]


def experiment_policy_violations(
    constraints: PolicyConstraints,
    experiment_type: str,
    random_seeds: list[int],
    approval_granted: bool,
    estimated_cost_usd: float = 0,
) -> list[dict[str, Any]]:
    violations = list(constraints.unsupported_constraints)
    if experiment_type in {"topic_specific", "demo_classification", "point_cloud_demo", "python_analysis", "cpp_cmake", "gpu_python", "conda_python"}:
        distinct_seed_count = len(set(random_seeds))
        if distinct_seed_count < constraints.minimum_random_seed_count:
            violations.append({
                "code": "minimum_random_seed_count",
                "message": "The experiment does not satisfy the active minimum random-seed policy.",
                "required": constraints.minimum_random_seed_count,
                "actual": distinct_seed_count,
                "policy_ids": constraints.recognized_policy_ids,
            })
    if constraints.approval.high_cost_actions and estimated_cost_usd > 0 and not approval_granted:
        violations.append({
            "code": "explicit_approval_required_for_high_cost_action",
            "message": "An active policy requires explicit approval for this cost-bearing action.",
            "estimated_cost_usd": estimated_cost_usd,
            "policy_ids": constraints.recognized_policy_ids,
        })
    return violations
