"""Deterministic dependency impact analysis for approved project changes."""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Iterable


TERMINAL_EXPERIMENT_STATUSES = {"succeeded", "failed", "cancelled"}
RERUN_CHECKPOINT_STAGES = {"experiment_succeeded", "experiment_failed"}
SUPPORTED_CHANGE_KINDS = {
    "experiment_plan",
    "code_patch",
    "config_change",
    "idea_revision",
    "data_change",
    "dependency_install",
    "delete_artifact",
    "external_publish",
    "diagnostic_suggestion",
}


class ImpactAnalysisError(ValueError):
    """A change cannot be safely analyzed without a complete dependency root."""

    def __init__(self, code: str, message: str, **details: Any):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.details}


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _artifact_metadata(artifact: Any) -> dict[str, Any]:
    value = _value(artifact, "metadata_json", {})
    return value if isinstance(value, dict) else {}


def _checkpoint_sort_key(checkpoint: Any) -> tuple[datetime, str]:
    created_at = _value(checkpoint, "created_at")
    if not isinstance(created_at, datetime):
        created_at = datetime.min
    if created_at.tzinfo is not None:
        created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
    return created_at, str(_value(checkpoint, "id"))


def _matches_root(
    artifact: Any,
    dependencies: Iterable[Any],
    roots: set[tuple[str, str]],
    artifact_root_ids: set[str],
    change_kind: str,
    base_idea_version: int | None,
) -> bool:
    artifact_id = str(_value(artifact, "id"))
    if artifact_id in artifact_root_ids:
        return True
    metadata = _artifact_metadata(artifact)
    if base_idea_version is not None:
        recorded_version = metadata.get("idea_version")
        reproducibility = metadata.get("reproducibility")
        if isinstance(reproducibility, dict):
            recorded_version = reproducibility.get("idea_version", recorded_version)
        if str(recorded_version) == str(base_idea_version):
            return True
    for dependency in dependencies:
        if (str(_value(dependency, "upstream_type")), str(_value(dependency, "upstream_id"))) in roots:
            return True
        if change_kind == "config_change" and _value(dependency, "upstream_type") == "policy_snapshot":
            return True
        if (
            change_kind in {"code_patch", "dependency_install"}
            and ("project_git_commit", "current") in roots
            and _value(dependency, "upstream_type") == "project_git_commit"
        ):
            return True
        if (
            change_kind == "data_change"
            and ("data_version", "current") in roots
            and _value(dependency, "upstream_type") == "data_version"
        ):
            return True
    return False


def analyze_impact(
    *,
    change_kind: str,
    payload: dict[str, Any] | None,
    current_idea_version: int,
    artifacts: Iterable[Any],
    dependencies: Iterable[Any],
    experiments: Iterable[Any],
    checkpoints: Iterable[Any],
) -> dict[str, Any]:
    """Return a reviewable impact graph without mutating database state."""
    if change_kind not in SUPPORTED_CHANGE_KINDS:
        raise ImpactAnalysisError(
            "impact_change_kind_unsupported",
            "影响分析拒绝未知的变更类型；请使用已登记的 Proposal 类型。",
            change_kind=change_kind,
        )
    if not isinstance(payload, dict):
        raise ImpactAnalysisError("impact_payload_invalid", "影响分析的变更载荷必须是 JSON 对象。")
    payload = payload.copy()
    artifact_rows = list(artifacts)
    dependency_rows = list(dependencies)
    checkpoint_rows = list(checkpoints)
    artifact_ids = {str(_value(artifact, "id")) for artifact in artifact_rows}

    if change_kind in {"code_patch", "dependency_install"}:
        base_git_commit = str(payload.get("base_git_commit", "")).strip()
        if not base_git_commit:
            raise ImpactAnalysisError(
                "impact_base_git_commit_required",
                "代码或依赖变更必须绑定基准 Git commit，不能把未知版本当作当前版本。",
            )
    if change_kind == "data_change":
        base_data_version = str(payload.get("base_data_version", "")).strip()
        if not base_data_version:
            raise ImpactAnalysisError(
                "impact_base_data_version_required",
                "数据变更必须绑定基准数据版本，不能把未知版本当作当前版本。",
            )
    if change_kind == "delete_artifact":
        artifact_id = str(payload.get("artifact_id", "")).strip()
        if not artifact_id:
            raise ImpactAnalysisError("impact_artifact_id_required", "删除产物必须提供 artifact_id。")
        if artifact_id not in artifact_ids:
            raise ImpactAnalysisError(
                "impact_artifact_not_found",
                "删除产物的目标不属于当前项目或不存在。",
                artifact_id=artifact_id,
            )

    dependencies_by_artifact: dict[str, list[Any]] = defaultdict(list)
    children_by_upstream: dict[tuple[str, str], set[str]] = defaultdict(set)
    for dependency in dependency_rows:
        artifact_id = str(_value(dependency, "artifact_id"))
        upstream = (str(_value(dependency, "upstream_type")), str(_value(dependency, "upstream_id")))
        dependencies_by_artifact[artifact_id].append(dependency)
        children_by_upstream[upstream].add(artifact_id)

    base_idea_version = payload.get("base_idea_version") if change_kind == "idea_revision" else None
    if base_idea_version is None and change_kind == "idea_revision":
        base_idea_version = current_idea_version
    try:
        base_idea_version = int(base_idea_version) if base_idea_version is not None else None
    except (TypeError, ValueError):
        base_idea_version = None

    roots: set[tuple[str, str]] = set()
    artifact_root_ids: set[str] = set()
    if change_kind == "idea_revision" and base_idea_version is not None:
        roots.add(("idea_version", str(base_idea_version)))
    elif change_kind == "config_change":
        roots.add(("policy_snapshot", "active"))
    elif change_kind in {"code_patch", "dependency_install"}:
        roots.add(("project_git_commit", str(payload.get("base_git_commit", "current"))))
    elif change_kind == "data_change":
        roots.add(("data_version", str(payload.get("base_data_version", "current"))))
    elif change_kind == "delete_artifact":
        artifact_root_ids.add(str(payload.get("artifact_id", "")))

    affected: set[str] = set()
    pending_upstreams: deque[tuple[str, str]] = deque(roots)
    for artifact in artifact_rows:
        artifact_id = str(_value(artifact, "id"))
        if _matches_root(
            artifact,
            dependencies_by_artifact.get(artifact_id, []),
            roots,
            artifact_root_ids,
            change_kind,
            base_idea_version,
        ):
            affected.add(artifact_id)
            pending_upstreams.append(("artifact", artifact_id))

    # Follow explicit artifact-to-artifact edges if a producer later records one.
    while pending_upstreams:
        upstream = pending_upstreams.popleft()
        for child in children_by_upstream.get(upstream, set()):
            if child not in affected:
                affected.add(child)
                pending_upstreams.append(("artifact", child))

    affected_experiments: set[str] = set()
    for artifact in artifact_rows:
        if str(_value(artifact, "id")) in affected and _value(artifact, "experiment_id"):
            affected_experiments.add(str(_value(artifact, "experiment_id")))
    for dependency in dependency_rows:
        if str(_value(dependency, "artifact_id")) in affected and _value(dependency, "upstream_type") == "experiment":
            affected_experiments.add(str(_value(dependency, "upstream_id")))

    affected_checkpoints: set[str] = set()
    for checkpoint in checkpoint_rows:
        state = _value(checkpoint, "state", {}) or {}
        if str(state.get("run_id", "")) in affected_experiments:
            affected_checkpoints.add(str(_value(checkpoint, "id")))

    experiment_rows = list(experiments)
    checkpoint_by_run: dict[str, Any] = {}
    for checkpoint in checkpoint_rows:
        state = _value(checkpoint, "state", {}) or {}
        if not isinstance(state, dict) or not state.get("run_id"):
            continue
        if _value(checkpoint, "stage") not in RERUN_CHECKPOINT_STAGES:
            continue
        run_id = str(state["run_id"])
        previous = checkpoint_by_run.get(run_id)
        if previous is None or _checkpoint_sort_key(checkpoint) > _checkpoint_sort_key(previous):
            checkpoint_by_run[run_id] = checkpoint
    rerun_candidates = [
        {
            "experiment_id": str(_value(experiment, "id")),
            "experiment_type": _value(experiment, "experiment_type"),
            "status": _value(experiment, "status"),
            "reason": "An upstream dependency is affected by this approved change.",
            "checkpoint_id": str(_value(checkpoint_by_run[str(_value(experiment, "id"))], "id"))
            if str(_value(experiment, "id")) in checkpoint_by_run else None,
        }
        for experiment in experiment_rows
        if str(_value(experiment, "id")) in affected_experiments
        and _value(experiment, "status") in TERMINAL_EXPERIMENT_STATUSES
    ]
    unaffected = sorted(artifact_ids - affected)
    dependency_graph = {
        "nodes": [
            {
                "id": artifact_id,
                "type": "artifact",
                "experiment_id": str(_value(artifact, "experiment_id")) if _value(artifact, "experiment_id") else None,
                "valid": bool(_value(artifact, "valid", True)),
                "affected": artifact_id in affected,
            }
            for artifact in artifact_rows
        ],
        "edges": [
            {
                "artifact_id": str(_value(dependency, "artifact_id")),
                "upstream_type": str(_value(dependency, "upstream_type")),
                "upstream_id": str(_value(dependency, "upstream_id")),
                "relation": str(_value(dependency, "relation", "generated_from")),
                "affected": str(_value(dependency, "artifact_id")) in affected,
            }
            for dependency in dependency_rows
        ],
    }
    return {
        "schema_version": "1.0",
        "change_kind": change_kind,
        "base_idea_version": base_idea_version,
        "roots": [{"type": kind, "id": value} for kind, value in sorted(roots)]
        + [{"type": "artifact", "id": value} for value in sorted(artifact_root_ids)],
        "affected_artifact_ids": sorted(affected),
        "affected_experiment_ids": sorted(affected_experiments),
        "affected_checkpoint_ids": sorted(affected_checkpoints),
        "unaffected_artifact_ids": unaffected,
        "rerun_candidates": rerun_candidates,
        "recommended_checkpoint_ids": [
            candidate["checkpoint_id"] for candidate in rerun_candidates if candidate["checkpoint_id"]
        ],
        "invalidated_immediately": sorted(affected),
        "rerun_scope": "dependent_descendants_only" if affected else "none",
        "requires_manual_review": bool(affected_experiments),
        "dependency_graph": dependency_graph,
    }


def apply_impact(session: Any, impact: dict[str, Any]) -> list[str]:
    """Invalidate only currently valid artifacts listed by a prior analysis."""
    from .models import Artifact

    changed: list[str] = []
    for artifact_id in impact.get("affected_artifact_ids", []):
        artifact = session.get(Artifact, artifact_id)
        if artifact and artifact.valid:
            artifact.valid = False
            changed.append(str(artifact.id))
    impact["invalidated_artifact_ids"] = sorted(changed)
    impact["applied"] = True
    return changed
