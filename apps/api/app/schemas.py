from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


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
    session_id: UUID | None = None
    project_id: UUID | None = None
    message: str = Field(min_length=1, max_length=20_000)
    attachments: list[Attachment] = Field(default_factory=list)


class ChatResponse(BaseModel):
    session_id: UUID
    project_id: UUID | None = None
    phase: str
    reply: str
    spec: ProjectSpec | None = None
    missing_fields: list[str] = Field(default_factory=list)
    action_required: str | None = None


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
        "experiment_plan", "code_patch", "config_change", "idea_revision",
        "dependency_install", "delete_artifact", "external_publish"
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


class ExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    proposal_id: UUID
    experiment_type: Literal["demo_classification", "point_cloud_demo", "compile_latex"]
    config: dict[str, Any] = Field(default_factory=dict)
    random_seeds: list[int] = Field(default_factory=lambda: [13, 37, 73], min_length=1, max_length=10)

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
            "demo_classification": {"n_samples", "n_features", "delay_seconds"},
            "point_cloud_demo": {"delay_seconds"},
            "compile_latex": {"delay_seconds"},
        }[self.experiment_type]
        unknown = set(self.config) - allowed
        if unknown:
            raise ValueError(f"config contains unsupported fields: {sorted(unknown)}")
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
        return self


class RunnerSubmitRequest(BaseModel):
    run_id: UUID
    project_id: UUID
    experiment_type: Literal["demo_classification", "point_cloud_demo", "compile_latex"]
    config: dict[str, Any] = Field(default_factory=dict)
    random_seeds: list[int]


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


class PolicyUpdate(BaseModel):
    project_id: UUID
    rule: str = Field(min_length=5, max_length=2000)
    rationale: str | None = Field(default=None, max_length=2000)


class ReportRequest(BaseModel):
    project_id: UUID
    period: Literal["daily", "weekly", "manual"] = "manual"


class ProjectStateRequest(BaseModel):
    action: Literal["pause", "resume", "cancel"]
    reason: str = Field(min_length=3, max_length=2000)
