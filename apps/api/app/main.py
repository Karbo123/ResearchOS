from __future__ import annotations

import json
import hashlib
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc, select, text

from .clarification import QUESTIONS, apply_answer, build_spec, missing_fields
from .db import Base, engine, session_scope
from .models import (
    Artifact, ArtifactDependency, AuditEvent, Checkpoint, ConversationSession, Evidence,
    Experiment, HumanFeedback, IdeaVersion, Message, Paper, Policy, Project, Proposal,
    Report, RepositoryRecord, Task, UploadedFile,
)
from .project_service import PROJECTS_ROOT, initialize_project, safe_slug
from .llm import initial_draft_with_llm
from .evidence_pipeline import download_open_pdf, extract_page_evidence, validate_open_pdf_url
from .policy_engine import (
    PolicyConstraints, compile_policy_constraints, experiment_policy_violations,
    seeds_for_constraints,
)
from .schemas import (
    ApprovalDecision, ChangeProposalRequest, ChatRequest, ChatResponse, EvidenceIngestRequest, ExperimentRequest,
    PolicyUpdate, ProjectCreateRequest, ProjectSpec, ProjectStateRequest, ReportRequest, RunnerStatus, SearchRequest,
)
from .search import search_literature


app = FastAPI(title="Research OS MVP", version="0.1.0")
STATIC_ROOT = Path(__file__).parent.parent / "static"
ARTIFACTS_ROOT = Path(os.getenv("ARTIFACTS_ROOT", "artifacts")).resolve()
RUNNER_URL = os.getenv("RUNNER_URL", "http://localhost:8010")
RUNNER_SECRET = os.getenv("RUNNER_SHARED_SECRET", "runner-dev-secret")
N8N_RESEARCH_WEBHOOK_URL = os.getenv("N8N_RESEARCH_WEBHOOK_URL", "").strip()
N8N_INTERNAL_URL = os.getenv("N8N_INTERNAL_URL", "http://n8n:5678").rstrip("/")
N8N_PUBLIC_URL = os.getenv("N8N_PUBLIC_URL", "http://127.0.0.1:5678").rstrip("/")
N8N_LOCAL_OWNER_EMAIL = os.getenv("N8N_LOCAL_OWNER_EMAIL", "").strip()
N8N_LOCAL_OWNER_PASSWORD = os.getenv("N8N_LOCAL_OWNER_PASSWORD", "")


@app.on_event("startup")
def startup() -> None:
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    ARTIFACTS_ROOT.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb"))


def audit(session, action: str, project_id: UUID | None, details: dict[str, Any], actor: str = "system"):
    session.add(AuditEvent(project_id=project_id, actor=actor, action=action, details=details))


def serialize_project(project: Project) -> dict[str, Any]:
    return {
        "id": str(project.id), "slug": project.slug, "title": project.title,
        "status": project.status, "stage": project.current_stage,
        "idea_version": project.current_idea_version,
        "created_at": project.created_at.isoformat(), "updated_at": project.updated_at.isoformat(),
    }


def require_active_project(session, project_id: UUID, operation: str) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    if project.status != "active":
        raise HTTPException(409, detail={
            "code": "project_not_active",
            "project_id": str(project.id),
            "project_status": project.status,
            "operation": operation,
            "message": f"Project must be active before {operation}.",
        })
    return project


def load_policy_constraints(session, project_id: UUID) -> PolicyConstraints:
    policies = session.scalars(
        select(Policy).where(Policy.project_id == project_id, Policy.active.is_(True))
    ).all()
    return compile_policy_constraints(policies)


def policy_enforcement_snapshot(session, project_id: UUID, constraints: PolicyConstraints | None = None) -> dict[str, Any]:
    constraints = constraints or load_policy_constraints(session, project_id)
    papers = session.scalars(select(Paper).where(Paper.project_id == project_id)).all()
    evidence = session.scalars(select(Evidence).where(Evidence.project_id == project_id)).all()
    source_records = sum(1 for paper in papers if paper.doi or paper.source_url)
    fulltext_evidence = [
        item for item in evidence
        if item.quote.strip() and item.locator and not item.locator.lower().startswith("metadata/")
    ]
    result = constraints.public_dict()
    result["citation_readiness"] = {
        "paper_records": len(papers),
        "records_with_doi_or_source_url": source_records,
        "page_or_section_quoted_evidence": len(fulltext_evidence),
        "doi_or_source_url_requirement_satisfied": (
            not constraints.citation.doi_or_source_url
            or (bool(papers) and source_records == len(papers))
        ),
        "quoted_evidence_requirement_satisfied": (
            not constraints.citation.quoted_evidence or bool(fulltext_evidence)
        ),
        "note": "metadata/title evidence is excluded from full-text quoted-evidence counts",
    }
    return result


def trigger_research_workflow(project_id: UUID, task_id: UUID) -> None:
    with session_scope() as session:
        project = session.get(Project, project_id)
        task = session.get(Task, task_id)
        if not project or project.status != "active":
            if task:
                task.status = "cancelled"
                task.error = f"Project is {project.status if project else 'missing'}; workflow was not started."
            audit(session, "workflow.blocked_by_project_state", project_id, {"status": project.status if project else "missing"})
            return
        if not task or task.status == "cancelled":
            return
        task.status = "running"
        task.attempts += 1
    if not N8N_RESEARCH_WEBHOOK_URL:
        with session_scope() as session:
            task = session.get(Task, task_id)
            if task:
                task.status = "failed"
                task.error = "N8N_RESEARCH_WEBHOOK_URL is not configured"
            audit(session, "workflow.trigger_skipped", project_id, {"reason": "N8N_RESEARCH_WEBHOOK_URL is not configured"})
        return
    try:
        response = httpx.post(N8N_RESEARCH_WEBHOOK_URL, json={"project_id": str(project_id)}, timeout=90)
        response.raise_for_status()
        with session_scope() as session:
            project = session.get(Project, project_id)
            task = session.get(Task, task_id)
            if task and project and project.status == "active" and task.status != "cancelled":
                task.status = "succeeded"
                audit(session, "workflow.triggered", project_id, {"status_code": response.status_code})
            else:
                audit(session, "workflow.completed_after_state_change", project_id, {"status": project.status if project else "missing"})
    except httpx.HTTPError as exc:
        with session_scope() as session:
            project = session.get(Project, project_id)
            task = session.get(Task, task_id)
            if task and project and project.status != "active":
                task.status = "cancelled"
                task.error = f"Project became {project.status} while the workflow was running."
            elif task:
                task.status = "failed"
                task.error = str(exc)[:2000]
            if project and project.status == "active" and project.current_stage == "workflow_queued":
                project.current_stage = "workflow_trigger_failed"
            audit(session, "workflow.trigger_failed", project_id, {"error": str(exc)[:2000]})


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "research-os-api",
        "llm": {
            "provider": "codex_bridge" if os.getenv("CODEX_BRIDGE_URL") else "openai_api" if os.getenv("OPENAI_API_KEY") else "deterministic_fallback",
            "model": os.getenv("OPENAI_MODEL", "gpt-5.6-sol"),
            "reasoning_effort": os.getenv("OPENAI_REASONING_EFFORT", "high"),
            "codex_bridge_configured": bool(os.getenv("CODEX_BRIDGE_URL")),
        },
    }


@app.get("/api/n8n/open")
def open_n8n():
    """Issue a real n8n session cookie for the localhost-only editor."""
    if not N8N_LOCAL_OWNER_EMAIL or len(N8N_LOCAL_OWNER_PASSWORD) < 12:
        raise HTTPException(503, "n8n local auto-login is not configured")
    login_payload = {
        "emailOrLdapLoginId": N8N_LOCAL_OWNER_EMAIL,
        "password": N8N_LOCAL_OWNER_PASSWORD,
    }
    try:
        with httpx.Client(timeout=20) as client:
            auth_response = client.post(f"{N8N_INTERNAL_URL}/rest/login", json=login_payload)
            if auth_response.status_code == 401:
                settings_response = client.get(f"{N8N_INTERNAL_URL}/rest/settings")
                settings_response.raise_for_status()
                settings = settings_response.json().get("data", settings_response.json())
                owner_is_setup = bool((settings.get("userManagement") or {}).get("isInstanceOwnerSetUp"))
                if owner_is_setup:
                    raise HTTPException(502, "n8n local owner credentials are out of sync")
                auth_response = client.post(f"{N8N_INTERNAL_URL}/rest/owner/setup", json={
                    "email": N8N_LOCAL_OWNER_EMAIL,
                    "firstName": "Research",
                    "lastName": "Owner",
                    "password": N8N_LOCAL_OWNER_PASSWORD,
                })
            auth_response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"n8n auto-login failed: {exc}") from exc
    cookies = auth_response.headers.get_list("set-cookie")
    if not cookies:
        raise HTTPException(502, "n8n did not issue a session cookie")
    response = RedirectResponse(f"{N8N_PUBLIC_URL}/home/workflows", status_code=302)
    for cookie in cookies:
        response.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
    return response


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    with session_scope() as session:
        conversation = session.get(ConversationSession, request.session_id) if request.session_id else None
        if request.session_id and not conversation:
            raise HTTPException(404, "conversation not found")
        if not conversation:
            draft = initial_draft_with_llm(request.message)
            remaining = missing_fields(draft)
            pending_field = remaining[0]
            conversation = ConversationSession(draft=draft, pending_field=pending_field, phase="clarifying")
            session.add(conversation); session.flush()
            session.add(Message(session_id=conversation.id, role="user", content=request.message, metadata_json={"attachments": [a.model_dump(mode="json") for a in request.attachments]}))
            reply = QUESTIONS[pending_field]
            session.add(Message(session_id=conversation.id, role="assistant", content=reply))
            return ChatResponse(session_id=conversation.id, phase=conversation.phase, reply=reply, missing_fields=remaining)

        session.add(Message(session_id=conversation.id, role="user", content=request.message, metadata_json={"attachments": [a.model_dump(mode="json") for a in request.attachments]}))
        if conversation.project_id:
            project = session.get(Project, conversation.project_id)
            change_markers = ["修改", "改为", "调整", "重新", "change", "update", "rerun"]
            is_change = any(marker in request.message.lower() for marker in change_markers)
            session.add(HumanFeedback(
                project_id=project.id,
                session_id=conversation.id,
                category="change_request" if is_change else "explanation_or_advice",
                instruction=request.message,
            ))
            if is_change:
                policy_markers = ["所有实验", "所有引用", "必须", "每个实验", "always", "every experiment", "every citation"]
                is_policy = any(marker in request.message.lower() for marker in policy_markers)
                target_field = "research_question"
                revised_value = request.message.split("改为", 1)[-1].strip() if "改为" in request.message else request.message
                proposal = Proposal(
                    project_id=project.id, kind="config_change" if is_policy else "idea_revision", reason="User requested a project change through chat",
                    summary=request.message,
                    diff=(f"+ project_policy: {request.message}" if is_policy else f"--- /idea/{target_field}\n+++ /idea/{target_field}\n+ {revised_value}"),
                    impact={
                        "will_revalidate": ["literature search", "experiments", "metrics", "artifacts", "paper claims"],
                        "invalidated_immediately": [], "rerun_scope": "pending structured impact analysis",
                    }, payload={"user_instruction": request.message, **({"policy_rule": request.message} if is_policy else {"target_field": target_field, "value": revised_value})},
                )
                session.add(proposal); session.flush()
                reply = "我已把这条指令转换为变更提案，但尚未执行。请在审批面板检查影响范围并批准或驳回。"
                session.add(Message(session_id=conversation.id, role="assistant", content=reply, metadata_json={"proposal_id": str(proposal.id)}))
                audit(session, "change.proposed", project.id, {"proposal_id": str(proposal.id)}, "local-user")
                return ChatResponse(session_id=conversation.id, project_id=project.id, phase="supervising", reply=reply, action_required=str(proposal.id))
            reply = f"项目当前阶段为 {project.current_stage}。这条消息被识别为解释或建议请求，没有触发执行。需要执行变更时请明确写出要修改的内容。"
            session.add(Message(session_id=conversation.id, role="assistant", content=reply))
            return ChatResponse(session_id=conversation.id, project_id=project.id, phase="supervising", reply=reply)

        if conversation.phase == "ready_for_confirmation":
            reply = "规格已经生成。请使用“确认并创建项目”按钮；继续输入则会作为补充说明记录，但不会静默启动工作流。"
            session.add(Message(session_id=conversation.id, role="assistant", content=reply))
            return ChatResponse(session_id=conversation.id, phase=conversation.phase, reply=reply, spec=build_spec(conversation.draft))

        draft = json.loads(json.dumps(conversation.draft))
        apply_answer(draft, conversation.pending_field, request.message)
        conversation.draft = draft
        remaining = missing_fields(draft)
        if remaining:
            conversation.pending_field = remaining[0]
            reply = QUESTIONS[remaining[0]]
            spec = None
        else:
            conversation.phase = "ready_for_confirmation"
            conversation.pending_field = None
            spec = build_spec(draft)
            if spec.feasibility == "blocked":
                reply = "当前规格包含安全、伦理或合法性阻断项，不能创建项目。请缩小为防御性/合规研究、移除危险执行目标，或补充正式伦理与数据授权证明后重新评估。"
            else:
                reply = "研究规格已经结构化完成。请检查右侧规格、风险和审批要求；确认前不会创建项目或运行实验。"
        session.add(Message(session_id=conversation.id, role="assistant", content=reply))
        return ChatResponse(session_id=conversation.id, phase=conversation.phase, reply=reply, spec=spec, missing_fields=remaining)


@app.post("/api/projects")
def create_project(request: ProjectCreateRequest, background_tasks: BackgroundTasks):
    with session_scope() as session:
        conversation = session.get(ConversationSession, request.session_id)
        if not conversation or conversation.phase != "ready_for_confirmation":
            raise HTTPException(409, "idea is not ready for confirmation")
        spec = build_spec(conversation.draft)
        if spec.feasibility == "blocked":
            raise HTTPException(409, "idea requires ethics or safety review before project creation")
        project_id = uuid.uuid4()
        slug = safe_slug(spec.idea.title, project_id)
        project = Project(id=project_id, slug=slug, title=spec.idea.title)
        project.current_stage = "workflow_queued"
        session.add(project); session.flush()
        session.add(IdeaVersion(project_id=project.id, version=1, spec=spec.model_dump(mode="json")))
        task = Task(project_id=project.id, kind="research_bootstrap", payload={"idea_version": 1})
        session.add(task)
        session.add(Checkpoint(
            project_id=project.id,
            stage="project_initialized",
            idea_version=1,
            state={"slug": slug, "project_spec": "idea/project-spec.v1.json"},
        ))
        for uploaded in session.scalars(select(UploadedFile).where(UploadedFile.session_id == conversation.id)).all():
            uploaded.project_id = project.id
        for rule in spec.policies:
            session.add(Policy(project_id=project.id, rule=rule))
        initialize_project(project.id, slug, spec)
        conversation.project_id = project.id
        conversation.phase = "supervising"
        audit(session, "project.created", project.id, {"slug": slug}, "local-user")
        session.flush()
        background_tasks.add_task(trigger_research_workflow, project.id, task.id)
        return {"project": serialize_project(project), "session_id": str(conversation.id), "next_action": "automatic novelty, literature search and experiment planning queued"}


@app.get("/api/projects")
def list_projects(status: Literal["active", "paused", "cancelled"] | None = None):
    with session_scope() as session:
        query = select(Project)
        if status:
            query = query.where(Project.status == status)
        projects = session.scalars(query.order_by(desc(Project.updated_at))).all()
        return [serialize_project(p) for p in projects]


@app.get("/api/projects/{project_id}")
def project_detail(project_id: UUID):
    with session_scope() as session:
        project = session.get(Project, project_id)
        if not project: raise HTTPException(404, "project not found")
        idea = session.scalar(select(IdeaVersion).where(IdeaVersion.project_id == project_id).order_by(desc(IdeaVersion.version)))
        papers = session.scalars(select(Paper).where(Paper.project_id == project_id)).all()
        proposals = session.scalars(select(Proposal).where(Proposal.project_id == project_id).order_by(desc(Proposal.created_at))).all()
        experiments = session.scalars(select(Experiment).where(Experiment.project_id == project_id).order_by(desc(Experiment.created_at))).all()
        artifacts = session.scalars(select(Artifact).where(Artifact.project_id == project_id).order_by(desc(Artifact.created_at))).all()
        policies = session.scalars(select(Policy).where(Policy.project_id == project_id, Policy.active.is_(True))).all()
        uploads = session.scalars(select(UploadedFile).where(UploadedFile.project_id == project_id).order_by(desc(UploadedFile.created_at))).all()
        reports = session.scalars(select(Report).where(Report.project_id == project_id).order_by(desc(Report.created_at)).limit(20)).all()
        tasks = session.scalars(select(Task).where(Task.project_id == project_id).order_by(desc(Task.created_at))).all()
        checkpoints = session.scalars(select(Checkpoint).where(Checkpoint.project_id == project_id).order_by(desc(Checkpoint.created_at))).all()
        repositories = session.scalars(select(RepositoryRecord).where(RepositoryRecord.project_id == project_id).order_by(desc(RepositoryRecord.retrieved_at))).all()
        feedback = session.scalars(select(HumanFeedback).where(HumanFeedback.project_id == project_id).order_by(desc(HumanFeedback.created_at)).limit(50)).all()
        dependencies = session.scalars(select(ArtifactDependency).where(ArtifactDependency.project_id == project_id)).all()
        evidence = session.scalars(select(Evidence).where(Evidence.project_id == project_id)).all()
        conversation = session.scalar(select(ConversationSession).where(ConversationSession.project_id == project_id).order_by(desc(ConversationSession.updated_at)))
        constraints = compile_policy_constraints(policies)
        enforcement = policy_enforcement_snapshot(session, project_id, constraints)
        policy_matches = {item["policy_id"]: item["requirements"] for item in constraints.matches}
        fulltext_counts: dict[UUID, int] = {}
        for item in evidence:
            if item.paper_id and item.locator and not item.locator.lower().startswith("metadata/"):
                fulltext_counts[item.paper_id] = fulltext_counts.get(item.paper_id, 0) + 1
        return {
            "project": serialize_project(project), "spec": idea.spec, "session_id": str(conversation.id) if conversation else None,
            "counts": {
                "papers": len(papers), "proposals": len(proposals), "experiments": len(experiments),
                "artifacts": len(artifacts), "tasks": len(tasks), "checkpoints": len(checkpoints),
                "repositories": len(repositories), "feedback": len(feedback), "evidence": len(evidence),
            },
            "papers": [{
                "id": str(p.id), "title": p.title, "doi": p.doi, "source_url": p.source_url,
                "verified": p.verified, "bibtex": p.bibtex,
                "fulltext_evidence_count": fulltext_counts.get(p.id, 0), **p.metadata_json,
            } for p in papers],
            "proposals": [{"id": str(p.id), "kind": p.kind, "status": p.status, "summary": p.summary, "reason": p.reason, "impact": p.impact, "diff": p.diff, "estimated_cost_usd": p.estimated_cost_usd, "payload": p.payload} for p in proposals],
            "experiments": [{"id": str(e.id), "status": e.status, "experiment_type": e.experiment_type, "metrics": e.metrics, "mlflow_run_id": e.mlflow_run_id, "error": e.error} for e in experiments],
            "artifacts": [{"id": str(a.id), "name": a.name, "kind": a.kind, "mime_type": a.mime_type, "url": f"/api/artifacts/{a.id}", "metadata": a.metadata_json, "valid": a.valid} for a in artifacts],
            "policies": [{
                "id": str(p.id), "rule": p.rule, "rationale": p.rationale,
                "enforced_requirements": policy_matches.get(str(p.id), []),
                "recognized": str(p.id) in constraints.recognized_policy_ids,
            } for p in policies],
            "policy_enforcement": enforcement,
            "uploads": [{"id": str(u.id), "name": u.name, "mime_type": u.mime_type, "size_bytes": u.size_bytes, "sha256": u.sha256} for u in uploads],
            "reports": [{"id": str(r.id), "period": r.period, "content": r.content, "created_at": r.created_at.isoformat()} for r in reports],
            "tasks": [{"id": str(t.id), "kind": t.kind, "status": t.status, "attempts": t.attempts, "error": t.error, "payload": t.payload} for t in tasks],
            "checkpoints": [{"id": str(c.id), "stage": c.stage, "idea_version": c.idea_version, "git_commit": c.git_commit, "data_version": c.data_version, "state": c.state, "created_at": c.created_at.isoformat()} for c in checkpoints],
            "repositories": [{"id": str(r.id), "paper_id": str(r.paper_id) if r.paper_id else None, "source_url": r.source_url, "license_spdx": r.license_spdx, "commit_or_tag": r.commit_or_tag, "verified_official": r.verified_official, "metadata": r.metadata_json, "retrieved_at": r.retrieved_at.isoformat()} for r in repositories],
            "feedback": [{"id": str(f.id), "category": f.category, "instruction": f.instruction, "created_at": f.created_at.isoformat()} for f in feedback],
            "artifact_dependencies": [{"artifact_id": str(d.artifact_id), "upstream_type": d.upstream_type, "upstream_id": d.upstream_id, "relation": d.relation} for d in dependencies],
            "evidence": [{
                "id": str(item.id), "paper_id": str(item.paper_id) if item.paper_id else None,
                "claim": item.claim, "quote": item.quote, "locator": item.locator,
                "source_url": item.source_url, "metadata": item.metadata_json,
            } for item in evidence],
        }


@app.post("/api/search")
async def run_search(request: SearchRequest):
    with session_scope() as session:
        project = require_active_project(session, request.project_id, "literature search")
        idea = session.scalar(select(IdeaVersion).where(IdeaVersion.project_id == project.id).order_by(desc(IdeaVersion.version)))
        spec = ProjectSpec.model_validate(idea.spec)
        query = request.query or " ".join(spec.idea.keywords[:8]) or spec.idea.research_question[:300]
    try:
        records, provider_errors = await search_literature(query, request.limit)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"literature provider failed: {exc}") from exc
    with session_scope() as session:
        project = require_active_project(session, request.project_id, "storing literature search results")
        stored = []
        for record in records:
            exists = session.scalar(select(Paper).where(Paper.project_id == project.id, Paper.doi == record.doi)) if record.doi else None
            if not exists and not record.doi:
                exists = session.scalar(select(Paper).where(Paper.project_id == project.id, Paper.source_url == record.source_url))
            if exists: continue
            paper = Paper(project_id=project.id, title=record.title, doi=record.doi, source_url=record.source_url, bibtex=record.bibtex, verified=record.verified, metadata_json=record.model_dump(mode="json", exclude={"bibtex", "title", "doi", "source_url", "verified"}))
            session.add(paper); session.flush()
            session.add(Evidence(project_id=project.id, paper_id=paper.id, claim=f"Bibliographic metadata was returned by {record.source_provider}; DOI BibTeX is retained only when resolver verification succeeds.", quote=record.title, locator="metadata/title", source_url=record.source_url))
            for repository in record.code_repositories:
                source_url = str(repository.get("url", "")).strip()
                if not source_url:
                    continue
                duplicate = session.scalar(select(RepositoryRecord).where(RepositoryRecord.project_id == project.id, RepositoryRecord.source_url == source_url))
                if duplicate:
                    continue
                session.add(RepositoryRecord(
                    project_id=project.id,
                    paper_id=paper.id,
                    source_url=source_url,
                    license_spdx=repository.get("license"),
                    commit_or_tag=repository.get("commit") or repository.get("tag"),
                    verified_official=bool(repository.get("verified_official", False)),
                    metadata_json={k: v for k, v in repository.items() if k not in {"url", "license", "commit", "tag", "verified_official"}},
                ))
            stored.append(str(paper.id))
        project.current_stage = "literature_review"
        audit(session, "literature.searched", project.id, {"query": query, "new_records": len(stored), "provider_errors": provider_errors})
        return {
            "query": query,
            "new_records": len(stored),
            "paper_ids": stored,
            "provider_errors": provider_errors,
            "note": "GitHub matches are candidates until repository ownership is manually verified.",
        }


@app.post("/api/projects/{project_id}/evidence/ingest")
async def ingest_fulltext_evidence(project_id: UUID, request: EvidenceIngestRequest):
    with session_scope() as session:
        project = require_active_project(session, project_id, "full-text evidence ingestion")
        candidates = []
        for paper in session.scalars(select(Paper).where(Paper.project_id == project_id)).all():
            pdf_url = str((paper.metadata_json or {}).get("pdf_url") or "").strip()
            existing = session.scalars(select(Evidence).where(Evidence.paper_id == paper.id)).all()
            has_fulltext = any(item.locator and not item.locator.lower().startswith("metadata/") for item in existing)
            if pdf_url and paper.bibtex and not has_fulltext:
                try:
                    validate_open_pdf_url(pdf_url)
                except ValueError:
                    continue
                candidates.append({
                    "id": paper.id, "title": paper.title, "pdf_url": pdf_url,
                    "bibtex": paper.bibtex, "doi": paper.doi,
                })
        project_slug = project.slug

    stored: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for candidate in candidates[:request.limit]:
        target = (ARTIFACTS_ROOT / "literature" / str(project_id) / f"{candidate['id']}.pdf").resolve()
        if ARTIFACTS_ROOT not in target.parents:
            errors.append({"paper_id": str(candidate["id"]), "error": "invalid controlled PDF path"})
            continue
        try:
            pdf_sha256, size_bytes, resolved_url = await download_open_pdf(candidate["pdf_url"], target)
            extracted = extract_page_evidence(target)
        except (httpx.HTTPError, OSError, ValueError) as exc:
            errors.append({"paper_id": str(candidate["id"]), "error": str(exc)[:500]})
            target.unlink(missing_ok=True)
            continue

        relative_path = str(target.relative_to(ARTIFACTS_ROOT)).replace("\\", "/")
        quote_sha256 = hashlib.sha256(str(extracted["quote"]).encode("utf-8")).hexdigest()
        with session_scope() as session:
            project = require_active_project(session, project_id, "storing full-text evidence")
            paper = session.get(Paper, candidate["id"])
            if not paper:
                target.unlink(missing_ok=True)
                continue
            artifact = Artifact(
                project_id=project_id, kind="paper_pdf", name=f"{paper.id}.pdf",
                relative_path=relative_path, mime_type="application/pdf", sha256=pdf_sha256,
                metadata_json={
                    "paper_id": str(paper.id), "doi": paper.doi, "source_url": candidate["pdf_url"],
                    "resolved_url": resolved_url, "size_bytes": size_bytes,
                    "access_basis": "provider-reported open PDF on an allowlisted scholarly host",
                },
            )
            session.add(artifact); session.flush()
            session.add(ArtifactDependency(
                project_id=project_id, artifact_id=artifact.id,
                upstream_type="paper", upstream_id=str(paper.id), relation="downloaded_from",
            ))
            session.add(ArtifactDependency(
                project_id=project_id, artifact_id=artifact.id,
                upstream_type="idea_version", upstream_id=str(project.current_idea_version), relation="collected_for",
            ))
            evidence_row = Evidence(
                project_id=project_id, paper_id=paper.id,
                claim=str(extracted["claim"]), quote=str(extracted["quote"]),
                locator=f"page {extracted['page_number']} of {extracted['page_count']}",
                source_url=candidate["pdf_url"],
                metadata_json={
                    "evidence_type": "fulltext_quote", "verified": True,
                    "page_number": extracted["page_number"], "page_count": extracted["page_count"],
                    "pdf_sha256": pdf_sha256, "quote_sha256": quote_sha256,
                    "pdf_artifact_id": str(artifact.id), "bibtex": paper.bibtex,
                    "parser": extracted["parser"], "stable_source_url": candidate["pdf_url"],
                },
            )
            session.add(evidence_row); session.flush()
            audit(session, "evidence.fulltext_ingested", project_id, {
                "evidence_id": str(evidence_row.id), "paper_id": str(paper.id),
                "page": extracted["page_number"], "pdf_sha256": pdf_sha256,
            })
            stored_item = {
                "evidence_id": str(evidence_row.id), "paper_id": str(paper.id),
                "title": paper.title, "claim": evidence_row.claim, "quote": evidence_row.quote,
                "locator": evidence_row.locator, "source_url": evidence_row.source_url,
                "pdf_sha256": pdf_sha256, "pdf_artifact_id": str(artifact.id), "bibtex": paper.bibtex,
            }
            stored.append(stored_item)

        evidence_root = (PROJECTS_ROOT / project_slug / "literature" / "evidence").resolve()
        project_root = (PROJECTS_ROOT / project_slug).resolve()
        if project_root == evidence_root.parents[1]:
            evidence_root.mkdir(parents=True, exist_ok=True)
            (evidence_root / f"{stored_item['evidence_id']}.json").write_text(
                json.dumps(stored_item, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    if stored:
        project_root = (PROJECTS_ROOT / project_slug).resolve()
        try:
            subprocess.run(["git", "-C", str(project_root), "add", "literature/evidence"], check=True, timeout=20)
            subprocess.run(["git", "-C", str(project_root), "commit", "-m", f"Archive {len(stored)} verified full-text evidence records"], check=True, timeout=20)
        except (subprocess.SubprocessError, FileNotFoundError):
            pass
    return {
        "stored_count": len(stored), "evidence": stored, "errors": errors,
        "claim_gate": "Only evidence records with verified=true, a page locator, PDF hash, source URL and BibTeX may support factual paper claims.",
    }


@app.get("/api/projects/{project_id}/novelty")
def novelty(project_id: UUID):
    with session_scope() as session:
        project = require_active_project(session, project_id, "novelty evaluation")
        papers = session.scalars(select(Paper).where(Paper.project_id == project_id)).all()
        verified = [p for p in papers if p.verified and p.doi]
        return {
            "assessment": "insufficient_evidence" if len(verified) < 3 else "candidate_gap_requires_full_text_review",
            "verified_paper_count": len(verified),
            "summary": "元数据检索不能单独证明创新性。下一步需要保存全文原文证据、页码并逐项对照核心假设。",
            "evidence": [{"title": p.title, "doi": p.doi, "url": p.source_url} for p in verified[:10]],
            "blocking_questions": [] if verified else ["没有足够的可验证 DOI 记录，不能形成创新性结论。"],
        }


@app.post("/api/proposals")
def create_proposal(request: ChangeProposalRequest):
    with session_scope() as session:
        if not session.get(Project, request.project_id): raise HTTPException(404, "project not found")
        proposal = Proposal(**request.model_dump())
        session.add(proposal); session.flush()
        audit(session, "proposal.created", request.project_id, {"proposal_id": str(proposal.id), "kind": proposal.kind}, "local-user")
        return {"id": str(proposal.id), "status": proposal.status}


@app.post("/api/projects/{project_id}/experiment-plan")
def generate_experiment_plan(project_id: UUID):
    with session_scope() as session:
        project = require_active_project(session, project_id, "experiment planning")
        constraints = load_policy_constraints(session, project_id)
        if not constraints.runner_compatible:
            raise HTTPException(409, detail={
                "code": "policy_constraints_unsatisfiable",
                "message": "Active project policies exceed the restricted Runner's supported limits.",
                "violations": constraints.unsupported_constraints,
                "policy_enforcement": constraints.public_dict(),
            })
        random_seeds = seeds_for_constraints(constraints)
        enforcement = policy_enforcement_snapshot(session, project_id, constraints)
        proposal = Proposal(
            project_id=project_id, kind="experiment_plan", reason="Establish a reproducible baseline before testing the research hypothesis",
            summary=f"Run an allowlisted baseline over {len(random_seeds)} deterministic seeds, calculate mean/std accuracy, generate a confusion matrix and a PLY reconstruction preview.",
            impact={
                "rerun_experiments": ["baseline-demo"], "invalidates": [],
                "artifacts": ["accuracy curve", "confusion matrix", "metrics JSON", "PLY", "point-cloud preview"],
                "policy_enforcement": enforcement,
            },
            estimated_cost_usd=0,
            payload={
                "experiment_type": "demo_classification",
                "config": {"n_samples": 600, "n_features": 12},
                "random_seeds": random_seeds,
                "policy_snapshot": constraints.public_dict(),
            },
        )
        session.add(proposal); session.flush()
        project.current_stage = "awaiting_experiment_approval"
        audit(session, "experiment_plan.proposed", project_id, {"proposal_id": str(proposal.id)})
        return {"proposal_id": str(proposal.id), "status": "pending", "plan": proposal.payload, "impact": proposal.impact, "policy_enforcement": enforcement}


@app.post("/api/projects/{project_id}/compile-plan")
def generate_compile_plan(project_id: UUID):
    with session_scope() as session:
        project = require_active_project(session, project_id, "LaTeX compilation planning")
        proposal = Proposal(
            project_id=project_id, kind="experiment_plan", reason="Compile the versioned LaTeX manuscript in the isolated runner",
            summary="Compile paper/main.tex with the fixed latexmk command and archive the resulting PDF and build log.",
            impact={"rerun_experiments": ["latex-build"], "invalidates": ["previous paper PDF"], "artifacts": ["paper PDF"]},
            estimated_cost_usd=0, payload={"experiment_type": "compile_latex", "config": {}, "random_seeds": [13]},
        )
        session.add(proposal); session.flush()
        audit(session, "latex_compile.proposed", project_id, {"proposal_id": str(proposal.id)})
        return {"proposal_id": str(proposal.id), "status": "pending", "plan": proposal.payload, "impact": proposal.impact}


@app.post("/api/proposals/{proposal_id}/decision")
def decide(proposal_id: UUID, request: ApprovalDecision):
    with session_scope() as session:
        proposal = session.get(Proposal, proposal_id)
        if not proposal: raise HTTPException(404, "proposal not found")
        if proposal.status != "pending": raise HTTPException(409, "proposal already decided")
        proposal.status = request.decision
        proposal.decided_by = request.actor
        proposal.decision_comment = request.comment
        proposal.decided_at = datetime.now(timezone.utc)
        if request.decision == "approved" and proposal.kind == "config_change" and proposal.payload.get("policy_rule"):
            session.add(Policy(project_id=proposal.project_id, rule=proposal.payload["policy_rule"], rationale="Approved project-chat guidance"))
        if request.decision == "approved" and proposal.kind == "idea_revision":
            project = session.get(Project, proposal.project_id)
            current = session.scalar(select(IdeaVersion).where(IdeaVersion.project_id == project.id).order_by(desc(IdeaVersion.version)))
            revised = json.loads(json.dumps(current.spec))
            field = proposal.payload.get("target_field", "research_question")
            if field not in {"title", "research_question", "domain", "available_data", "ethics_and_compliance"}:
                raise HTTPException(422, "revision target is not allowlisted")
            revised["idea"][field] = proposal.payload.get("value", revised["idea"][field])
            next_version = current.version + 1
            version = IdeaVersion(project_id=project.id, version=next_version, spec=revised, change_reason=proposal.reason, supersedes_id=current.id)
            session.add(version)
            project.current_idea_version = next_version
            project.current_stage = "impact_review"
            for item in session.scalars(select(Artifact).where(Artifact.project_id == project.id, Artifact.valid.is_(True))).all():
                item.valid = False
            root = (PROJECTS_ROOT / project.slug).resolve()
            spec_path = root / "idea" / f"project-spec.v{next_version}.json"
            spec_path.write_text(json.dumps(revised, ensure_ascii=False, indent=2), encoding="utf-8")
            try:
                subprocess.run(["git", "-C", str(root), "add", str(spec_path)], check=True, timeout=20)
                subprocess.run(["git", "-C", str(root), "commit", "-m", f"Revise research idea to v{next_version}"], check=True, timeout=20)
            except (subprocess.SubprocessError, FileNotFoundError):
                pass
        audit(session, f"proposal.{request.decision}", proposal.project_id, {"proposal_id": str(proposal.id), "comment": request.comment}, request.actor)
        return {"id": str(proposal.id), "status": proposal.status}


@app.post("/api/experiments", status_code=202)
async def submit_experiment(request: ExperimentRequest):
    with session_scope() as session:
        project = require_active_project(session, request.project_id, "experiment submission")
        proposal = session.get(Proposal, request.proposal_id)
        if not proposal or proposal.project_id != request.project_id: raise HTTPException(404, "proposal not found")
        if proposal.status != "approved": raise HTTPException(409, "approved proposal required")
        if proposal.kind not in {"experiment_plan", "config_change"}: raise HTTPException(409, "proposal kind cannot launch an experiment")
        constraints = load_policy_constraints(session, request.project_id)
        violations = experiment_policy_violations(
            constraints,
            request.experiment_type,
            request.random_seeds,
            approval_granted=proposal.status == "approved",
            estimated_cost_usd=float(proposal.estimated_cost_usd or 0),
        )
        if violations:
            raise HTTPException(409, detail={
                "code": "policy_violation",
                "message": "Experiment submission violates one or more active project policies.",
                "violations": violations,
                "policy_enforcement": constraints.public_dict(),
            })
        approved_payload = proposal.payload or {}
        requested_payload = {
            "experiment_type": request.experiment_type,
            "config": request.config,
            "random_seeds": request.random_seeds,
        }
        expected_payload = {
            "experiment_type": approved_payload.get("experiment_type"),
            "config": approved_payload.get("config", {}),
            "random_seeds": approved_payload.get("random_seeds", [13]),
        }
        if requested_payload != expected_payload:
            raise HTTPException(409, detail={
                "code": "proposal_payload_mismatch",
                "message": "Experiment submission must exactly match the approved proposal payload.",
                "expected": expected_payload,
                "received": requested_payload,
            })
        config = dict(request.config)
        config["project_slug"] = project.slug
        experiment = Experiment(project_id=request.project_id, proposal_id=request.proposal_id, experiment_type=request.experiment_type, config=config)
        session.add(experiment); session.flush()
        run_id = experiment.id
    payload = {
        "run_id": str(run_id), "project_id": str(request.project_id),
        "experiment_type": request.experiment_type, "config": config,
        "random_seeds": request.random_seeds,
        "policy_constraints": {
            "minimum_random_seed_count": constraints.minimum_random_seed_count,
            "explicit_approval_required": bool(
                constraints.approval.high_cost_actions and float(proposal.estimated_cost_usd or 0) > 0
            ),
            "approval_granted": proposal.status == "approved",
        },
    }
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.post(f"{RUNNER_URL}/v1/runs", json=payload, headers={"X-Runner-Secret": RUNNER_SECRET})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            with session_scope() as session:
                exp = session.get(Experiment, run_id); exp.status = "failed"; exp.error = str(exc)
            raise HTTPException(502, f"runner rejected submission: {exc}") from exc
    with session_scope() as session:
        exp = session.get(Experiment, run_id)
        project = session.get(Project, request.project_id)
        accepted = bool(project and project.status == "active")
        if accepted:
            exp.status = "queued"
            project.current_stage = "experiment_running"
            audit(session, "experiment.submitted", request.project_id, payload)
        else:
            exp.status = "cancelling"
            audit(session, "experiment.cancelled_after_state_race", request.project_id, {"run_id": str(run_id), "status": project.status if project else "missing"})
    if not accepted:
        cancellation_error = None
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                cancel_response = await client.post(f"{RUNNER_URL}/v1/runs/{run_id}/cancel", headers={"X-Runner-Secret": RUNNER_SECRET})
                if cancel_response.status_code not in {200, 409}:
                    cancel_response.raise_for_status()
            except httpx.HTTPError as exc:
                cancellation_error = str(exc)[:500]
        with session_scope() as session:
            exp = session.get(Experiment, run_id)
            exp.status = "cancelled" if cancellation_error is None else "cancelling"
            exp.finished_at = datetime.now(timezone.utc) if cancellation_error is None else None
        raise HTTPException(409, detail={
            "code": "project_state_changed",
            "project_status": project.status if project else "missing",
            "operation": "experiment submission",
            "message": "Project state changed while the Runner request was being submitted; the run was cancelled.",
            "cancellation_error": cancellation_error,
        })
    return {"run_id": str(run_id), "status": "queued"}


@app.post("/api/experiments/{run_id}/sync")
async def sync_experiment(run_id: UUID):
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(f"{RUNNER_URL}/v1/runs/{run_id}", headers={"X-Runner-Secret": RUNNER_SECRET})
        if response.status_code == 404: raise HTTPException(404, "runner run not found")
        response.raise_for_status()
        status = RunnerStatus.model_validate(response.json())
    with session_scope() as session:
        experiment = session.get(Experiment, run_id)
        if not experiment: raise HTTPException(404, "experiment not found")
        experiment.status = status.status; experiment.metrics = status.metrics; experiment.mlflow_run_id = status.mlflow_run_id; experiment.error = status.error
        if status.finished_at: experiment.finished_at = status.finished_at
        existing = {a.sha256 for a in session.scalars(select(Artifact).where(Artifact.experiment_id == run_id)).all()}
        for item in status.artifacts:
            if item.sha256 not in existing:
                artifact_row = Artifact(
                    project_id=experiment.project_id,
                    experiment_id=run_id,
                    name=item.name,
                    kind=item.kind,
                    relative_path=item.relative_path,
                    mime_type=item.mime_type,
                    sha256=item.sha256,
                    metadata_json=item.metadata,
                )
                session.add(artifact_row); session.flush()
                dependencies = [
                    ("experiment", str(run_id)),
                    ("idea_version", str(project.current_idea_version) if (project := session.get(Project, experiment.project_id)) else "unknown"),
                ]
                for key in ("git_commit", "data_version", "mlflow_run_id"):
                    value = item.metadata.get(key)
                    if value:
                        dependencies.append((key, str(value)))
                for upstream_type, upstream_id in dependencies:
                    session.add(ArtifactDependency(
                        project_id=experiment.project_id,
                        artifact_id=artifact_row.id,
                        upstream_type=upstream_type,
                        upstream_id=upstream_id,
                    ))
        project = session.get(Project, experiment.project_id)
        if status.status == "succeeded" and project.status == "active":
            project.current_stage = "results_review"
            prior = session.scalars(select(Checkpoint).where(Checkpoint.project_id == project.id, Checkpoint.stage == "experiment_succeeded")).all()
            if not any(item.state.get("run_id") == str(run_id) for item in prior):
                metadata = status.artifacts[0].metadata if status.artifacts else {}
                session.add(Checkpoint(
                    project_id=project.id,
                    stage="experiment_succeeded",
                    idea_version=project.current_idea_version,
                    git_commit=metadata.get("git_commit"),
                    data_version=metadata.get("data_version"),
                    state={"run_id": str(run_id), "mlflow_run_id": status.mlflow_run_id, "metrics": status.metrics},
                ))
        elif status.status == "failed" and project.status == "active":
            project.current_stage = "experiment_failed"
        audit(session, "experiment.synced", experiment.project_id, {"run_id": str(run_id), "status": status.status})
        return status


@app.post("/api/experiments/{run_id}/cancel")
async def cancel_experiment(run_id: UUID):
    with session_scope() as session:
        experiment = session.get(Experiment, run_id)
        if not experiment: raise HTTPException(404, "experiment not found")
        project_id = experiment.project_id
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(f"{RUNNER_URL}/v1/runs/{run_id}/cancel", headers={"X-Runner-Secret": RUNNER_SECRET})
        if response.status_code == 409: raise HTTPException(409, "experiment is already terminal")
        response.raise_for_status()
    with session_scope() as session:
        experiment = session.get(Experiment, run_id); experiment.status = "cancelled"; experiment.finished_at = datetime.now(timezone.utc)
        audit(session, "experiment.cancelled", project_id, {"run_id": str(run_id)}, "local-user")
    return response.json()


@app.get("/api/artifacts/{artifact_id}")
def get_artifact(artifact_id: UUID):
    with session_scope() as session:
        item = session.get(Artifact, artifact_id)
        if not item or not item.valid: raise HTTPException(404, "artifact not found")
        path = (ARTIFACTS_ROOT / item.relative_path).resolve()
        if ARTIFACTS_ROOT not in path.parents or not path.is_file(): raise HTTPException(404, "artifact file missing")
        return FileResponse(path, media_type=item.mime_type, filename=item.name)


@app.post("/api/uploads")
async def upload(session_id: UUID = Form(...), file: UploadFile = File(...)):
    allowed = {"application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv", "application/json", "application/zip", "application/octet-stream"}
    if file.content_type not in allowed: raise HTTPException(415, "file type not allowed")
    safe_name = Path(file.filename or "upload.bin").name
    root = (ARTIFACTS_ROOT / "inbox" / str(session_id)).resolve()
    if ARTIFACTS_ROOT not in root.parents: raise HTTPException(400, "invalid upload path")
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{uuid.uuid4()}-{safe_name}"
    size = 0
    digest = hashlib.sha256()
    with target.open("wb") as handle:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > 50 * 1024 * 1024:
                target.unlink(missing_ok=True); raise HTTPException(413, "file exceeds 50 MB")
            handle.write(chunk)
            digest.update(chunk)
    relative_path = str(target.relative_to(ARTIFACTS_ROOT)).replace("\\", "/")
    with session_scope() as session:
        conversation = session.get(ConversationSession, session_id)
        if not conversation:
            target.unlink(missing_ok=True); raise HTTPException(404, "conversation not found")
        uploaded = UploadedFile(session_id=session_id, project_id=conversation.project_id, name=safe_name, relative_path=relative_path, mime_type=file.content_type or "application/octet-stream", size_bytes=size, sha256=digest.hexdigest())
        session.add(uploaded); session.flush()
        audit(session, "attachment.uploaded", conversation.project_id, {"upload_id": str(uploaded.id), "name": safe_name, "size": size}, "local-user")
        return {"id": str(uploaded.id), "name": safe_name, "relative_path": relative_path, "size": size, "sha256": digest.hexdigest()}


@app.post("/api/policies")
def add_policy(request: PolicyUpdate):
    with session_scope() as session:
        project = session.get(Project, request.project_id)
        if not project: raise HTTPException(404, "project not found")
        if project.status == "cancelled":
            raise HTTPException(409, detail={
                "code": "cancelled_project_is_terminal",
                "message": "Policies cannot be changed on a cancelled project.",
            })
        preview = compile_policy_constraints([{"id": "pending", "rule": request.rule}]).public_dict()
        proposal = Proposal(
            project_id=request.project_id,
            kind="config_change",
            reason=request.rationale or "User proposed a persistent project policy",
            summary=f"Add project policy: {request.rule}",
            diff=f"+ project_policy: {request.rule}",
            impact={
                "will_revalidate": ["experiment plans", "Runner submissions", "citation evidence", "approval gates"],
                "policy_enforcement_preview": preview,
            },
            payload={"policy_rule": request.rule},
        )
        session.add(proposal); session.flush()
        audit(session, "policy.proposed", request.project_id, {"proposal_id": str(proposal.id), "rule": request.rule}, "local-user")
        return {"proposal_id": str(proposal.id), "status": "pending", "active": False, "enforcement_preview": preview}


@app.post("/api/reports")
def create_report(request: ReportRequest):
    with session_scope() as session:
        project = session.get(Project, request.project_id)
        if not project: raise HTTPException(404, "project not found")
        papers = session.scalars(select(Paper).where(Paper.project_id == project.id)).all()
        experiments = session.scalars(select(Experiment).where(Experiment.project_id == project.id)).all()
        pending = session.scalars(select(Proposal).where(Proposal.project_id == project.id, Proposal.status == "pending")).all()
        artifacts = session.scalars(select(Artifact).where(Artifact.project_id == project.id, Artifact.valid.is_(True))).all()
        recent = papers[-5:]
        content = "\n".join([
            f"# {project.title} - {request.period.title()} report",
            f"Generated: {datetime.now(timezone.utc).isoformat()}", f"Current stage: **{project.current_stage}**",
            f"\n## Literature\nVerified records: {sum(1 for p in papers if p.verified)} / {len(papers)}",
            *[f"- [{p.title}]({p.source_url}) DOI: {p.doi or 'not available'}" for p in recent],
            f"\n## Experiments\nTotal: {len(experiments)}; running: {sum(1 for e in experiments if e.status in {'queued', 'running'})}; failed: {sum(1 for e in experiments if e.status == 'failed')}",
            *[f"- {e.experiment_type}: {e.status}; metrics={json.dumps(e.metrics, ensure_ascii=False)}" for e in experiments[-5:]],
            f"\n## Visual artifacts\nAvailable: {len(artifacts)}",
            *[f"- {a.kind}: {a.name} (run {a.experiment_id})" for a in artifacts[-8:]],
            f"\n## Approval required\n{len(pending)} pending proposal(s).",
            *[f"- {p.kind}: {p.summary} (estimated ${p.estimated_cost_usd:.2f})" for p in pending],
            "\n## Cost\nExternal API and compute cost accounting is zero/unknown in this local MVP unless supplied by a provider.",
        ])
        report = Report(project_id=project.id, period=request.period, content=content); session.add(report); session.flush()
        audit(session, "report.generated", project.id, {"report_id": str(report.id), "period": request.period})
        return {"id": str(report.id), "content": content}


@app.get("/api/projects/{project_id}/audit")
def audit_log(project_id: UUID):
    with session_scope() as session:
        events = session.scalars(select(AuditEvent).where(AuditEvent.project_id == project_id).order_by(desc(AuditEvent.created_at)).limit(100)).all()
        return [{"id": str(e.id), "actor": e.actor, "action": e.action, "details": e.details, "created_at": e.created_at.isoformat()} for e in events]


@app.post("/api/projects/{project_id}/state")
async def change_project_state(project_id: UUID, request: ProjectStateRequest, background_tasks: BackgroundTasks):
    resume_task_id: UUID | None = None
    run_ids: list[UUID] = []
    with session_scope() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "project not found")

        if request.action == "resume":
            if project.status == "cancelled":
                raise HTTPException(409, detail={
                    "code": "cancelled_project_is_terminal",
                    "project_status": project.status,
                    "operation": "resume",
                    "message": "A cancelled project cannot be resumed; create a new project or Idea version instead.",
                })
            if project.status == "active":
                return {**serialize_project(project), "resumed_from": project.current_stage, "restarted_task_id": None}
            checkpoint = session.scalar(
                select(Checkpoint)
                .where(Checkpoint.project_id == project_id, Checkpoint.stage == "project_paused")
                .order_by(desc(Checkpoint.created_at))
            )
            restored_stage = (checkpoint.state or {}).get("resume_stage", "initialized") if checkpoint else "initialized"
            project.status = "active"
            project.current_stage = restored_stage
            cancelled_bootstrap = session.scalar(
                select(Task)
                .where(Task.project_id == project_id, Task.kind == "research_bootstrap", Task.status == "cancelled")
                .order_by(desc(Task.updated_at))
            )
            successful_bootstrap = session.scalar(
                select(Task)
                .where(Task.project_id == project_id, Task.kind == "research_bootstrap", Task.status == "succeeded")
                .order_by(desc(Task.updated_at))
            )
            if cancelled_bootstrap and not successful_bootstrap:
                task = Task(project_id=project_id, kind="research_bootstrap", payload={
                    "idea_version": project.current_idea_version,
                    "resumed_from_task_id": str(cancelled_bootstrap.id),
                })
                session.add(task)
                session.flush()
                resume_task_id = task.id
                project.current_stage = "workflow_queued"
            audit(session, "project.resumed", project_id, {
                "reason": request.reason,
                "restored_stage": project.current_stage,
                "checkpoint_id": str(checkpoint.id) if checkpoint else None,
                "restarted_task_id": str(resume_task_id) if resume_task_id else None,
            }, "local-user")
            result = {**serialize_project(project), "resumed_from": restored_stage, "restarted_task_id": str(resume_task_id) if resume_task_id else None}
        else:
            target_status = "paused" if request.action == "pause" else "cancelled"
            if project.status == "cancelled":
                return {**serialize_project(project), "affected_runs": [], "affected_tasks": 0, "cancellation_errors": []}
            project.status = target_status
            active_experiments = session.scalars(
                select(Experiment).where(Experiment.project_id == project_id, Experiment.status.in_(["queued", "running", "cancelling"]))
            ).all()
            resume_stage = project.current_stage
            if active_experiments:
                latest_success = session.scalar(
                    select(Checkpoint)
                    .where(Checkpoint.project_id == project_id, Checkpoint.stage == "experiment_succeeded")
                    .order_by(desc(Checkpoint.created_at))
                )
                if latest_success:
                    resume_stage = "results_review"
                else:
                    experiment_proposal = session.scalar(
                        select(Proposal)
                        .where(Proposal.project_id == project_id, Proposal.kind == "experiment_plan")
                        .order_by(desc(Proposal.created_at))
                    )
                    resume_stage = "awaiting_experiment_approval" if experiment_proposal else "initialized"
            project.current_stage = target_status
            run_ids = [item.id for item in active_experiments]
            active_tasks = session.scalars(
                select(Task).where(Task.project_id == project_id, Task.status.in_(["queued", "running"]))
            ).all()
            for task in active_tasks:
                task.status = "cancelled"
                task.error = f"Project {target_status}: {request.reason}"
            checkpoint = Checkpoint(
                project_id=project_id,
                stage="project_paused" if request.action == "pause" else "project_cancelled",
                idea_version=project.current_idea_version,
                state={
                    "reason": request.reason,
                    "resume_stage": resume_stage,
                    "active_run_ids": [str(run_id) for run_id in run_ids],
                    "cancelled_task_ids": [str(task.id) for task in active_tasks],
                },
            )
            session.add(checkpoint)
            audit(session, f"project.{request.action}.requested", project_id, {
                "reason": request.reason,
                "resume_stage": resume_stage,
                "active_runs": [str(run_id) for run_id in run_ids],
                "active_tasks": [str(task.id) for task in active_tasks],
            }, "local-user")
            result = {**serialize_project(project), "affected_runs": [str(run_id) for run_id in run_ids], "affected_tasks": len(active_tasks)}

    if resume_task_id:
        background_tasks.add_task(trigger_research_workflow, project_id, resume_task_id)
        return result
    if request.action == "resume":
        return result

    outcomes: dict[str, str] = {}
    errors: list[dict[str, str]] = []
    if run_ids:
        async with httpx.AsyncClient(timeout=15) as client:
            for run_id in run_ids:
                try:
                    response = await client.post(f"{RUNNER_URL}/v1/runs/{run_id}/cancel", headers={"X-Runner-Secret": RUNNER_SECRET})
                    if response.status_code == 409:
                        status_response = await client.get(f"{RUNNER_URL}/v1/runs/{run_id}", headers={"X-Runner-Secret": RUNNER_SECRET})
                        status_response.raise_for_status()
                        outcomes[str(run_id)] = status_response.json().get("status", "failed")
                    else:
                        response.raise_for_status()
                        outcomes[str(run_id)] = response.json().get("status", "cancelled")
                except (httpx.HTTPError, ValueError) as exc:
                    errors.append({"run_id": str(run_id), "error": str(exc)[:500]})

    with session_scope() as session:
        for run_id_text, status in outcomes.items():
            experiment = session.get(Experiment, UUID(run_id_text))
            if experiment and status in {"succeeded", "failed", "cancelled"}:
                experiment.status = status
                experiment.finished_at = datetime.now(timezone.utc)
        audit(session, f"project.{request.action}.completed", project_id, {
            "runner_outcomes": outcomes,
            "cancellation_errors": errors,
        }, "system")
        project = session.get(Project, project_id)
        result = {
            **serialize_project(project),
            "affected_runs": [str(run_id) for run_id in run_ids],
            "affected_tasks": result["affected_tasks"],
            "runner_outcomes": outcomes,
            "cancellation_errors": errors,
        }
    return result


app.mount("/", StaticFiles(directory=STATIC_ROOT, html=True), name="static")
