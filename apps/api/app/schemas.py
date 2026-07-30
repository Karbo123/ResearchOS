from __future__ import annotations

from datetime import datetime
from enum import Enum
import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from .reproducibility import ReproducibilityContract


TOPIC_PLAN_FIELDS = {
    "schema_version", "plan_type", "project_id", "idea_version", "research_question", "objective",
    "source_evidence_ids", "policy_ids", "data_sources", "baselines", "metrics", "ablations",
    "statistical_tests", "random_seeds", "resource_budget", "risks", "success_criteria",
}


class RiskLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    blocked = "blocked"


class ResourceConstraints(BaseModel):
    compute: str | None = None
    budget_usd: float | None = Field(default=None, ge=0)
    deadline: str | None = None
    data_access: str | None = None


class ResearchIdea(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=240)
    research_question: str = Field(min_length=10)
    domain: str = Field(min_length=2)
    hypotheses: list[str] = Field(default_factory=list)
    expected_contributions: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    target_venues: list[str] = Field(default_factory=list)
    available_data: str | None = None
    constraints: ResourceConstraints = Field(default_factory=ResourceConstraints)
    success_criteria: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    ethics_and_compliance: str | None = None


class ResearchIdeaDraft(BaseModel):
    """A partial Idea used during adaptive clarification, never as an execution contract."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=240)
    research_question: str | None = None
    domain: str | None = None
    hypotheses: list[str] = Field(default_factory=list, max_length=10)
    expected_contributions: list[str] = Field(default_factory=list, max_length=10)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    target_venues: list[str] = Field(default_factory=list, max_length=10)
    available_data: str | None = None
    constraints: ResourceConstraints = Field(default_factory=ResourceConstraints)
    success_criteria: list[str] = Field(default_factory=list, max_length=10)
    risks: list[str] = Field(default_factory=list, max_length=20)
    open_questions: list[str] = Field(default_factory=list, max_length=12)
    ethics_and_compliance: str | None = None


class AdaptiveClarificationResult(BaseModel):
    """Strict model output for one bounded, non-executing clarification turn."""

    model_config = ConfigDict(extra="forbid")

    draft: ResearchIdeaDraft
    assistant_reply: str = Field(min_length=1, max_length=6000)
    ready_for_confirmation: bool = False
    unresolved_items: list[str] = Field(default_factory=list, max_length=12)
    assumptions: list[str] = Field(default_factory=list, max_length=12)
    risk_flags: list[str] = Field(default_factory=list, max_length=12)


class ProjectSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    idea: ResearchIdea
    feasibility: RiskLevel = RiskLevel.medium
    feasibility_notes: list[str] = Field(default_factory=list)
    required_approvals: list[str] = Field(default_factory=list)
    candidate_modifications: list[str] = Field(default_factory=list)
    policies: list[str] = Field(default_factory=lambda: [
        "Every citation must retain a DOI or source URL and quoted evidence.",
        "High-cost or externally visible actions require explicit approval.",
    ])


class Attachment(BaseModel):
    name: str
    artifact_id: UUID | None = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID | None = None
    project_id: UUID | None = None
    message: str = Field(min_length=1, max_length=20_000)
    attachments: list[Attachment] = Field(default_factory=list)
    clarification_mode: Literal["automatic", "detailed"] = "automatic"


class ChatResponse(BaseModel):
    session_id: UUID
    project_id: UUID | None = None
    phase: str
    reply: str
    spec: ProjectSpec | None = None
    missing_fields: list[str] = Field(default_factory=list)
    action_required: str | None = None
    model_tier: Literal["simple", "medium", "complex"] | None = None
    model: str | None = None
    reasoning_effort: str | None = None
    clarification_mode: Literal["automatic", "detailed"] = "automatic"


class ProjectCreateRequest(BaseModel):
    session_id: UUID
    confirmed: Literal[True]


class SearchRequest(BaseModel):
    project_id: UUID
    query: str | None = Field(default=None, max_length=500)
    limit: int = Field(default=8, ge=1, le=30)


class EvidenceIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=3, ge=1, le=10)


class PaperRecord(BaseModel):
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    source_url: str
    venue: str | None = None
    abstract: str | None = None
    citation_count: int | None = None
    source_provider: str
    pdf_url: str | None = None
    external_ids: dict[str, str] = Field(default_factory=dict)
    bibtex: str | None = None
    verified: bool = False
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    code_repositories: list[dict[str, Any]] = Field(default_factory=list)


class ChangeProposalRequest(BaseModel):
    project_id: UUID
    kind: Literal[
        "experiment_plan", "code_patch", "config_change", "idea_revision", "data_change",
        "dependency_install", "delete_artifact", "external_publish", "diagnostic_suggestion"
    ]
    reason: str = Field(min_length=5)
    summary: str = Field(min_length=5)
    diff: str | None = None
    impact: dict[str, Any] = Field(default_factory=dict)
    estimated_cost_usd: float = Field(default=0, ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_diff_for_file_or_config_changes(self):
        if self.kind in {"code_patch", "config_change"} and not self.diff:
            raise ValueError("code and config changes require an explicit diff")
        return self


class ApprovalDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: str | None = Field(default=None, max_length=4000)
    actor: str = Field(default="local-user", max_length=200)


class CheckpointRerunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=5, max_length=2000)


class ExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    proposal_id: UUID
    experiment_type: Literal["topic_specific", "demo_classification", "point_cloud_demo", "compile_latex", "python_analysis", "cpp_cmake", "gpu_python", "conda_python"]
    config: dict[str, Any] = Field(default_factory=dict)
    random_seeds: list[int] = Field(default_factory=lambda: [13, 37, 73], min_length=1, max_length=10)
    topic_plan: dict[str, Any] | None = None
    topic_resume: dict[str, Any] | None = None

    @field_validator("config")
    @classmethod
    def reject_command_fields(cls, value: dict[str, Any]) -> dict[str, Any]:
        forbidden = {"command", "cmd", "shell", "cwd", "path"}
        if forbidden.intersection(value):
            raise ValueError("arbitrary command and path fields are forbidden")
        return value

    @model_validator(mode="after")
    def validate_allowlisted_config(self):
        allowed = {
            "topic_specific": set(),
            "demo_classification": {"n_samples", "n_features", "delay_seconds"},
            "point_cloud_demo": {"delay_seconds"},
            "compile_latex": {"delay_seconds"},
            "python_analysis": {"entrypoint", "delay_seconds"},
            "cpp_cmake": {"delay_seconds"},
            "gpu_python": {"entrypoint", "delay_seconds"},
            "conda_python": {"entrypoint", "delay_seconds"},
        }[self.experiment_type]
        unknown = set(self.config) - allowed
        if unknown:
            raise ValueError(f"config contains unsupported fields: {sorted(unknown)}")
        if self.experiment_type == "topic_specific":
            if not isinstance(self.topic_plan, dict) or not self.topic_plan:
                raise ValueError("topic_specific execution requires a structured topic_plan")
            if set(self.topic_plan) != TOPIC_PLAN_FIELDS or self.topic_plan.get("plan_type") != "topic_specific":
                raise ValueError("topic_plan does not match the strict topic-specific plan schema")
            if self.topic_resume is not None and not isinstance(self.topic_resume, dict):
                raise ValueError("topic_resume must be an object when supplied")
        elif self.topic_plan is not None or self.topic_resume is not None:
            raise ValueError("topic_plan and topic_resume are only valid for topic_specific execution")
        delay = self.config.get("delay_seconds", 0)
        if not isinstance(delay, (int, float)) or isinstance(delay, bool) or not 0 <= delay <= 10:
            raise ValueError("delay_seconds must be between 0 and 10")
        if self.experiment_type == "demo_classification":
            n_samples = self.config.get("n_samples", 600)
            n_features = self.config.get("n_features", 12)
            if not isinstance(n_samples, int) or isinstance(n_samples, bool) or not 100 <= n_samples <= 100_000:
                raise ValueError("n_samples must be an integer between 100 and 100000")
            if not isinstance(n_features, int) or isinstance(n_features, bool) or not 2 <= n_features <= 1_000:
                raise ValueError("n_features must be an integer between 2 and 1000")
        if self.experiment_type in {"python_analysis", "gpu_python", "conda_python"}:
            entrypoint = self.config.get("entrypoint", "experiment/main.py")
            if not isinstance(entrypoint, str) or not re.fullmatch(r"experiment/[A-Za-z0-9_.-]+\.py", entrypoint):
                raise ValueError("entrypoint must be a single Python file under experiment/")
        return self


class ExperimentPlanDataSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=300)
    purpose: str = Field(min_length=5, max_length=2000)
    access_and_provenance: str = Field(min_length=5, max_length=2000)
    split_and_preprocessing: str = Field(min_length=5, max_length=2000)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlanBaseline(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=300)
    rationale: str = Field(min_length=5, max_length=2000)
    implementation_scope: str = Field(min_length=5, max_length=2000)
    comparison: str = Field(min_length=5, max_length=2000)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlanMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    definition: str = Field(min_length=5, max_length=2000)
    primary: bool = False
    aggregation: str = Field(min_length=3, max_length=500)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlanAblation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    component: str = Field(min_length=2, max_length=300)
    removed_or_changed: str = Field(min_length=5, max_length=2000)
    rationale: str = Field(min_length=5, max_length=2000)
    expected_signal: str = Field(min_length=5, max_length=2000)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlanStatisticalTest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=200)
    comparison: str = Field(min_length=5, max_length=1000)
    null_hypothesis: str = Field(min_length=5, max_length=1000)
    alpha: float = Field(default=0.05, gt=0, lt=1)
    multiple_comparison_correction: str = Field(min_length=2, max_length=300)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlanResourceBudget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    compute_environment: str = Field(min_length=3, max_length=1000)
    max_runtime_hours: float = Field(gt=0, le=100_000)
    max_gpu_hours: float = Field(default=0, ge=0, le=100_000)
    memory_gb: float = Field(gt=0, le=1_000_000)
    budget_usd: float = Field(default=0, ge=0, le=1_000_000)
    assumptions: list[str] = Field(default_factory=list, max_length=20)


class ExperimentPlanRisk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    risk: str = Field(min_length=3, max_length=500)
    mitigation: str = Field(min_length=5, max_length=2000)
    detection: str = Field(min_length=5, max_length=1000)
    stop_condition: str = Field(min_length=5, max_length=1000)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlanSuccessCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterion: str = Field(min_length=5, max_length=1000)
    metric: str = Field(min_length=2, max_length=160)
    target_or_decision_rule: str = Field(min_length=5, max_length=1000)
    basis_evidence_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ExperimentPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    plan_type: Literal["topic_specific"] = "topic_specific"
    project_id: UUID
    idea_version: int = Field(ge=1)
    research_question: str = Field(min_length=10, max_length=4000)
    objective: str = Field(min_length=10, max_length=4000)
    source_evidence_ids: list[UUID] = Field(min_length=1, max_length=100)
    policy_ids: list[UUID] = Field(default_factory=list, max_length=100)
    data_sources: list[ExperimentPlanDataSource] = Field(min_length=1, max_length=30)
    baselines: list[ExperimentPlanBaseline] = Field(min_length=1, max_length=30)
    metrics: list[ExperimentPlanMetric] = Field(min_length=1, max_length=30)
    ablations: list[ExperimentPlanAblation] = Field(min_length=1, max_length=30)
    statistical_tests: list[ExperimentPlanStatisticalTest] = Field(min_length=1, max_length=20)
    random_seeds: list[int] = Field(min_length=1, max_length=10)
    resource_budget: ExperimentPlanResourceBudget
    risks: list[ExperimentPlanRisk] = Field(min_length=1, max_length=30)
    success_criteria: list[ExperimentPlanSuccessCriterion] = Field(min_length=1, max_length=30)


class RunnerSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    project_id: UUID
    experiment_type: Literal["topic_specific", "demo_classification", "point_cloud_demo", "compile_latex", "python_analysis", "cpp_cmake", "gpu_python", "conda_python"]
    config: dict[str, Any] = Field(default_factory=dict)
    random_seeds: list[int]
    reproducibility: ReproducibilityContract
    topic_plan: dict[str, Any] | None = None
    topic_resume: dict[str, Any] | None = None


class ArtifactInfo(BaseModel):
    name: str
    kind: str
    relative_path: str
    mime_type: str
    sha256: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunnerStatus(BaseModel):
    run_id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    metrics: dict[str, float] = Field(default_factory=dict)
    artifacts: list[ArtifactInfo] = Field(default_factory=list)
    mlflow_run_id: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    reproducibility: ReproducibilityContract | None = None


class PolicyUpdate(BaseModel):
    project_id: UUID
    rule: str = Field(min_length=5, max_length=2000)
    rationale: str | None = Field(default=None, max_length=2000)


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    period: Literal["daily", "weekly", "manual"] = "manual"
    notify: bool = False


class ModelTierSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=500)
    key: str = Field(min_length=0, max_length=1000)
    reasoning_effort: Literal["low", "medium", "high"]


class ModelSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    simple: ModelTierSettings
    medium: ModelTierSettings
    complex: ModelTierSettings


class ProjectStateRequest(BaseModel):
    action: Literal["pause", "resume", "cancel"]
    reason: str = Field(min_length=3, max_length=2000)
