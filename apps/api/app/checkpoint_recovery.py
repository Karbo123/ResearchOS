"""Validation for approval-gated, checkpoint-scoped experiment reruns."""

from __future__ import annotations

from typing import Any


TERMINAL_RERUN_STATUSES = {"succeeded", "failed", "cancelled"}
RERUN_CHECKPOINT_STAGES = {"experiment_succeeded", "experiment_failed"}
RERUN_CONFIG_FIELDS = {
    "topic_specific": set(),
    "demo_classification": {"n_samples", "n_features", "delay_seconds"},
    "point_cloud_demo": {"delay_seconds"},
    "compile_latex": {"delay_seconds"},
    "python_analysis": {"entrypoint", "delay_seconds"},
    "cpp_cmake": {"delay_seconds"},
    "gpu_python": {"entrypoint", "delay_seconds"},
    "conda_python": {"entrypoint", "delay_seconds"},
}
TOPIC_PLAN_FIELDS = {
    "schema_version", "plan_type", "project_id", "idea_version", "research_question", "objective",
    "source_evidence_ids", "policy_ids", "data_sources", "baselines", "metrics", "ablations",
    "statistical_tests", "random_seeds", "resource_budget", "risks", "success_criteria",
}
FORBIDDEN_TOPIC_KEYS = {"command", "cmd", "shell", "cwd", "path", "url", "network", "image", "environment", "dependencies"}


class CheckpointRecoveryError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def _validate_topic_tree(value: Any, *, depth: int = 0) -> None:
    if depth > 8:
        raise CheckpointRecoveryError("topic_checkpoint_invalid", "主题计划或检查点嵌套层级超过固定上限。")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or key.lower() in FORBIDDEN_TOPIC_KEYS:
                raise CheckpointRecoveryError("topic_checkpoint_invalid", "主题计划或检查点包含禁止的执行字段。")
            _validate_topic_tree(child, depth=depth + 1)
    elif isinstance(value, list):
        for child in value:
            _validate_topic_tree(child, depth=depth + 1)
    elif not isinstance(value, (str, int, float, bool)) and value is not None:
        raise CheckpointRecoveryError("topic_checkpoint_invalid", "主题计划或检查点只能包含 JSON 标量、数组和对象。")


def _validate_topic_plan(plan: Any) -> dict[str, Any]:
    if not isinstance(plan, dict) or set(plan) != TOPIC_PLAN_FIELDS or plan.get("plan_type") != "topic_specific":
        raise CheckpointRecoveryError("topic_plan_missing", "源主题实验没有可验证的结构化计划，不能恢复。")
    if len(str(plan).encode("utf-8")) > 256 * 1024:
        raise CheckpointRecoveryError("topic_plan_too_large", "主题计划超过固定大小上限。")
    _validate_topic_tree(plan)
    return plan


def build_rerun_payload(
    *,
    checkpoint_id: str,
    checkpoint_stage: str,
    checkpoint_state: dict[str, Any] | None,
    experiment_id: str,
    experiment_status: str,
    experiment_type: str,
    experiment_config: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return only the original allowlisted execution payload for a rerun."""
    state = checkpoint_state or {}
    if not isinstance(state, dict):
        raise CheckpointRecoveryError(
            "checkpoint_state_invalid",
            "检查点状态不是有效对象，不能重建实验请求。",
        )
    if checkpoint_stage not in RERUN_CHECKPOINT_STAGES:
        raise CheckpointRecoveryError(
            "checkpoint_not_rerunnable",
            "只有实验成功或失败检查点可以提出局部重跑。",
        )
    if experiment_status not in TERMINAL_RERUN_STATUSES:
        raise CheckpointRecoveryError(
            "experiment_not_terminal",
            "只有已经结束的实验可以提出局部重跑。",
        )
    if str(state.get("run_id") or "") != str(experiment_id):
        raise CheckpointRecoveryError(
            "checkpoint_experiment_mismatch",
            "检查点没有指向请求的源实验。",
        )
    allowed = RERUN_CONFIG_FIELDS.get(experiment_type)
    if allowed is None:
        raise CheckpointRecoveryError(
            "experiment_type_not_rerunnable",
            "该实验类型没有受控的检查点重跑模板。",
        )
    config = experiment_config or {}
    if not isinstance(config, dict):
        raise CheckpointRecoveryError(
            "experiment_config_invalid",
            "源实验配置不是有效对象，不能重建实验请求。",
        )
    random_seeds = config.get("_random_seeds")
    if (
        not isinstance(random_seeds, list)
        or not 1 <= len(random_seeds) <= 10
        or not all(isinstance(seed, int) and not isinstance(seed, bool) for seed in random_seeds)
    ):
        raise CheckpointRecoveryError(
            "checkpoint_random_seeds_missing",
            "源实验没有持久化随机种子，不能安全重建原始运行请求。",
        )
    if experiment_type == "topic_specific":
        plan = _validate_topic_plan(config.get("_topic_plan"))
        resume = {
            "checkpoint_id": str(checkpoint_id),
            "source_experiment_id": str(experiment_id),
            "checkpoint_stage": checkpoint_stage,
            "state": state,
        }
        _validate_topic_tree(resume)
        if len(str(resume).encode("utf-8")) > 128 * 1024:
            raise CheckpointRecoveryError("topic_checkpoint_too_large", "主题检查点恢复状态超过固定大小上限。")
        return {
            "checkpoint_id": str(checkpoint_id),
            "source_experiment_id": str(experiment_id),
            "experiment_type": experiment_type,
            "config": {},
            "random_seeds": random_seeds,
            "topic_plan": plan,
            "topic_resume": resume,
            "rerun_mode": "topic_specific_fixed_entrypoint_resume",
        }
    sanitized_config = {key: config[key] for key in allowed if key in config}
    return {
        "checkpoint_id": str(checkpoint_id),
        "source_experiment_id": str(experiment_id),
        "experiment_type": experiment_type,
        "config": sanitized_config,
        "random_seeds": random_seeds,
        "rerun_mode": "same_allowlisted_template_on_current_snapshot",
    }


def validate_rerun_payload(
    *,
    proposal_payload: dict[str, Any] | None,
    checkpoint_id: str,
    checkpoint_stage: str,
    checkpoint_state: dict[str, Any] | None,
    experiment_id: str,
    experiment_status: str,
    experiment_type: str,
    experiment_config: dict[str, Any] | None,
) -> dict[str, Any]:
    """Rebuild and compare the approved payload so it cannot be altered in transit."""
    expected = build_rerun_payload(
        checkpoint_id=checkpoint_id,
        checkpoint_stage=checkpoint_stage,
        checkpoint_state=checkpoint_state,
        experiment_id=experiment_id,
        experiment_status=experiment_status,
        experiment_type=experiment_type,
        experiment_config=experiment_config,
    )
    if proposal_payload != expected:
        raise CheckpointRecoveryError(
            "checkpoint_rerun_payload_mismatch",
            "检查点重跑 Proposal 与源实验快照不一致，不能审批或执行。",
        )
    return expected
