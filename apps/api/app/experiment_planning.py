"""Validation helpers for evidence-backed, Idea-specific experiment plans."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable
from uuid import UUID

from .policy_engine import PolicyConstraints
from .schemas import ExperimentPlan, ProjectSpec


class ExperimentPlanValidationError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.details}


def fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def is_verified_page_evidence(item: dict[str, Any]) -> bool:
    metadata = item.get("metadata") or item.get("metadata_json") or {}
    locator = str(item.get("locator") or "").strip().lower()
    return bool(
        metadata.get("verified") is True
        and str(item.get("quote") or "").strip()
        and locator
        and not locator.startswith("metadata/")
        and metadata.get("pdf_sha256")
        and metadata.get("bibtex")
        and str(item.get("source_url") or "").strip()
    )


def verified_evidence_ids(evidence: Iterable[dict[str, Any]]) -> set[UUID]:
    result: set[UUID] = set()
    for item in evidence:
        if not is_verified_page_evidence(item):
            continue
        try:
            result.add(UUID(str(item["id"])))
        except (KeyError, ValueError, TypeError):
            continue
    return result


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9][a-z0-9_+\-]{2,}", (value or "").lower()))


def _all_plan_evidence_ids(plan: ExperimentPlan) -> set[UUID]:
    ids = set(plan.source_evidence_ids)
    for collection in (
        plan.data_sources, plan.baselines, plan.metrics, plan.ablations,
        plan.statistical_tests, plan.risks, plan.success_criteria,
    ):
        for item in collection:
            ids.update(item.basis_evidence_ids)
    return ids


def validate_topic_specific_plan(
    plan: ExperimentPlan,
    *,
    project_id: UUID,
    idea_version: int,
    project_spec: ProjectSpec,
    evidence: list[dict[str, Any]],
    policy_constraints: PolicyConstraints,
    active_policy_ids: set[UUID],
) -> dict[str, Any]:
    if plan.project_id != project_id or plan.idea_version != idea_version:
        raise ExperimentPlanValidationError(
            "experiment_plan_stale",
            "实验计划不再绑定当前项目或 Idea 版本，必须重新生成。",
            {"expected_project_id": str(project_id), "expected_idea_version": idea_version},
        )

    allowed_evidence = verified_evidence_ids(evidence)
    if not allowed_evidence:
        raise ExperimentPlanValidationError(
            "verified_evidence_required",
            "当前项目没有可用于实验计划的页码级全文证据；请先完成全文证据提取。",
        )
    referenced = _all_plan_evidence_ids(plan)
    invalid_evidence = sorted(str(item) for item in referenced - allowed_evidence)
    if invalid_evidence:
        raise ExperimentPlanValidationError(
            "invalid_plan_evidence",
            "实验计划引用了不属于当前项目的证据，或引用了未经页码验证的元数据候选。",
            {"invalid_evidence_ids": invalid_evidence},
        )
    if not set(plan.source_evidence_ids).issubset(allowed_evidence):
        raise ExperimentPlanValidationError("invalid_source_evidence", "计划的主证据必须来自当前项目的页码级全文证据。")

    if plan.policy_ids and not set(plan.policy_ids).issubset(active_policy_ids):
        raise ExperimentPlanValidationError("invalid_plan_policy", "实验计划引用了不属于当前快照的项目策略。")
    if policy_constraints.unsupported_constraints:
        raise ExperimentPlanValidationError(
            "unsupported_policy_constraint",
            "当前项目策略包含 Runner 无法执行的约束，不能生成可执行实验计划。",
            {"unsupported_constraints": policy_constraints.unsupported_constraints},
        )
    distinct_seeds = set(plan.random_seeds)
    if len(distinct_seeds) < policy_constraints.minimum_random_seed_count:
        raise ExperimentPlanValidationError(
            "minimum_random_seed_count",
            "实验计划的随机种子数量不满足当前项目策略。",
            {"required": policy_constraints.minimum_random_seed_count, "actual": len(distinct_seeds)},
        )

    configured_budget = project_spec.idea.constraints.budget_usd
    if configured_budget is not None and plan.resource_budget.budget_usd > configured_budget:
        raise ExperimentPlanValidationError(
            "resource_budget_exceeded",
            "实验计划预算超过 ProjectSpec 中已确认的项目预算。",
            {"maximum_budget_usd": configured_budget, "planned_budget_usd": plan.resource_budget.budget_usd},
        )

    idea_terms = _tokens(" ".join([
        project_spec.idea.research_question,
        project_spec.idea.domain,
        *project_spec.idea.keywords,
        *project_spec.idea.hypotheses,
        *project_spec.idea.expected_contributions,
    ]))
    plan_terms = _tokens(" ".join([
        plan.research_question,
        plan.objective,
        *(item.name + " " + item.purpose for item in plan.data_sources),
        *(item.name + " " + item.rationale for item in plan.baselines),
        *(item.name + " " + item.definition for item in plan.metrics),
    ]))
    if idea_terms and not idea_terms.intersection(plan_terms):
        raise ExperimentPlanValidationError(
            "plan_topic_mismatch",
            "实验计划内容与当前 ProjectSpec 没有可验证的主题关联，拒绝继续。",
        )

    forbidden = {"demo_classification", "point_cloud_demo", "synthetic demo", "合成演示", "点云演示"}
    plan_text = json.dumps(plan.model_dump(mode="json"), ensure_ascii=False).lower()
    if any(term in plan_text for term in forbidden):
        raise ExperimentPlanValidationError(
            "unrelated_demo_plan",
            "实验计划包含已废弃的通用 demo 任务，必须重新生成当前 Idea 专属计划。",
        )

    return {
        "verified_evidence_ids": sorted(str(item) for item in allowed_evidence),
        "referenced_evidence_ids": sorted(str(item) for item in referenced),
        "minimum_random_seed_count": policy_constraints.minimum_random_seed_count,
        "idea_fingerprint": fingerprint(project_spec.model_dump(mode="json")),
    }
