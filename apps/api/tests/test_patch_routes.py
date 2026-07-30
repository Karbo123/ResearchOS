from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app import main as api_main
from app.models import Evidence, Experiment, IdeaVersion, Paper, Project, Proposal
from app.schemas import ApprovalDecision, PatchOperationRequest, PatchProposalRequest, PatchRollbackRequest


class FakeSession:
    def __init__(self, objects=None):
        self.objects = objects or {}
        self.added = []

    def get(self, model, object_id):
        return self.objects.get((model, object_id))

    def add(self, value):
        self.added.append(value)

    def flush(self):
        for value in self.added:
            if getattr(value, "id", None) is None:
                value.id = uuid4()
            if isinstance(value, Proposal) and value.status is None:
                value.status = "pending"

    def scalar(self, _statement):
        return None


class PaperDraftSession(FakeSession):
    def __init__(self, project, idea=None, evidence=None, papers=None, experiments=None):
        super().__init__({(Project, project.id): project})
        self.idea = idea
        self.records = {
            Evidence: evidence or [],
            Paper: papers or [],
            Experiment: experiments or [],
        }

    def scalar(self, statement):
        entity = statement.column_descriptions[0].get("entity")
        return self.idea if entity is IdeaVersion else None

    def scalars(self, statement):
        entity = statement.column_descriptions[0].get("entity")
        return SimpleNamespace(all=lambda: list(self.records.get(entity, [])))


class FakeContext:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, exc_type, exc, traceback):
        return False


def project(project_id):
    return SimpleNamespace(id=project_id, slug="route-test", status="active", current_idea_version=1)


def paper_draft_spec():
    return {
        "schema_version": "1.0",
        "idea": {
            "title": "Evidence route test",
            "research_question": "Does verified evidence improve a bounded research workflow?",
            "domain": "research automation",
            "hypotheses": ["Verified evidence improves traceability."],
            "expected_contributions": ["A reviewable evidence map."],
            "available_data": "A local test corpus.",
            "success_criteria": ["Every factual claim has a retained source."],
            "constraints": {"compute": "CPU", "data_access": "public"},
        },
    }


def test_patch_proposal_route_persists_structured_diff(monkeypatch):
    project_id = uuid4()
    base_commit = "a" * 40
    fake_project = project(project_id)
    session = FakeSession()
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "require_active_project", lambda *_args: fake_project)
    monkeypatch.setattr(api_main, "project_git_commit", lambda *_args: base_commit)
    monkeypatch.setattr(api_main, "validate_git_workspace", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(api_main, "validate_patch_against_workspace", lambda *_args: [])
    monkeypatch.setattr(api_main, "build_patch_diff", lambda *_args: "--- a/experiment/main.py\n+++ b/experiment/main.py\n")
    monkeypatch.setattr(api_main, "project_change_impact", lambda *_args: {"changed": True})
    monkeypatch.setattr(api_main, "audit", lambda *_args, **_kwargs: None)

    request = PatchProposalRequest(
        project_id=project_id,
        patch_kind="code",
        base_git_commit=base_commit,
        reason="修复实验入口中的一个确定性错误",
        summary="更新实验入口实现",
        operations=[PatchOperationRequest(
            action="replace",
            path="experiment/main.py",
            content="print('patched')\n",
            expected_sha256="b" * 64,
        )],
    )

    result = api_main.create_patch_proposal(project_id, request)

    proposal = session.added[0]
    assert result["status"] == "pending"
    assert proposal.kind == "code_patch"
    assert proposal.payload["base_git_commit"] == base_commit
    assert proposal.payload["operations"][0]["path"] == "experiment/main.py"
    assert proposal.diff.startswith("--- a/experiment/main.py")


def test_paper_draft_route_rejects_missing_current_idea(monkeypatch):
    project_id = uuid4()
    fake_project = project(project_id)
    session = PaperDraftSession(fake_project)
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "project_git_commit", lambda *_args: "a" * 40)
    monkeypatch.setattr(api_main, "validate_git_workspace", lambda *_args, **_kwargs: {})

    with pytest.raises(HTTPException) as error:
        api_main.generate_paper_draft(project_id)

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "paper_idea_version_missing"


def test_compile_plan_binds_approval_to_clean_paper_source(monkeypatch, tmp_path):
    project_id = uuid4()
    fake_project = project(project_id)
    root = tmp_path / fake_project.slug / "paper"
    root.mkdir(parents=True)
    (root / "main.tex").write_text("\\documentclass{article}\n\\begin{document}x\\end{document}\n", encoding="utf-8")
    session = FakeSession()
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "PROJECTS_ROOT", tmp_path)
    monkeypatch.setattr(api_main, "require_active_project", lambda *_args: fake_project)
    monkeypatch.setattr(api_main, "project_git_commit", lambda *_args: "a" * 40)
    monkeypatch.setattr(api_main, "validate_git_workspace", lambda *_args, **_kwargs: {})

    result = api_main.generate_compile_plan(project_id)

    proposal = session.added[0]
    source = proposal.payload["paper_source"]
    assert result["status"] == "pending"
    assert source["path"] == "paper/main.tex"
    assert source["git_commit"] == "a" * 40
    assert len(source["sha256"]) == 64
    assert source["sha256"] in proposal.diff


def test_compile_submission_rejects_stale_approved_source(monkeypatch, tmp_path):
    project_id = uuid4()
    fake_project = project(project_id)
    monkeypatch.setattr(api_main, "PROJECTS_ROOT", tmp_path)
    actual = {"path": "paper/main.tex", "git_commit": "a" * 40, "sha256": "b" * 64}
    approved = {"path": "paper/main.tex", "git_commit": "a" * 40, "sha256": "c" * 64}
    monkeypatch.setattr(api_main, "_compile_source_contract", lambda *_args: actual)

    with pytest.raises(HTTPException) as error:
        api_main._require_approved_compile_source(fake_project, {"paper_source": approved})

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "compile_approval_source_changed"


def test_paper_draft_route_rejects_metadata_only_evidence(monkeypatch, tmp_path):
    project_id = uuid4()
    fake_project = project(project_id)
    idea = SimpleNamespace(version=1, spec=paper_draft_spec())
    evidence = SimpleNamespace(
        id=uuid4(), paper_id=None, claim="Metadata candidate", quote="Title only",
        locator="metadata/title", source_url="https://example.invalid/paper",
        metadata_json={"verified": False},
    )
    session = PaperDraftSession(fake_project, idea=idea, evidence=[evidence])
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "PROJECTS_ROOT", tmp_path)
    monkeypatch.setattr(api_main, "project_git_commit", lambda *_args: "a" * 40)
    monkeypatch.setattr(api_main, "validate_git_workspace", lambda *_args, **_kwargs: {})

    with pytest.raises(HTTPException) as error:
        api_main.generate_paper_draft(project_id)

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "paper_evidence_required"


def test_paper_draft_route_proposal_contains_claim_provenance(monkeypatch, tmp_path):
    project_id = uuid4()
    fake_project = project(project_id)
    root = tmp_path / fake_project.slug / "paper"
    root.mkdir(parents=True)
    (root / "main.tex").write_text("old manuscript\n", encoding="utf-8")
    idea = SimpleNamespace(version=1, spec=paper_draft_spec())
    paper_id = uuid4()
    evidence = SimpleNamespace(
        id=uuid4(), paper_id=paper_id, claim="Verified evidence improves traceability.",
        quote="Verified evidence improves traceability in review.", locator="page 4",
        source_url="https://example.invalid/paper.pdf",
        metadata_json={"verified": True, "pdf_sha256": "a" * 64, "bibtex": "@article{x}"},
    )
    paper = SimpleNamespace(id=paper_id, title="Verified source", doi="10.1000/example", source_url="https://example.invalid/paper")
    run = SimpleNamespace(id=uuid4(), status="succeeded", metrics={"accuracy": 0.91})
    session = PaperDraftSession(fake_project, idea=idea, evidence=[evidence], papers=[paper], experiments=[run])
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "PROJECTS_ROOT", tmp_path)
    monkeypatch.setattr(api_main, "project_git_commit", lambda *_args: "a" * 40)
    monkeypatch.setattr(api_main, "validate_git_workspace", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(api_main, "validate_patch_against_workspace", lambda *_args: [])
    monkeypatch.setattr(api_main, "build_patch_diff", lambda *_args: "--- a/paper/main.tex\n+++ b/paper/main.tex\n")
    monkeypatch.setattr(api_main, "project_change_impact", lambda *_args: {"changed": True})
    monkeypatch.setattr(api_main, "audit", lambda *_args, **_kwargs: None)

    result = api_main.generate_paper_draft(project_id)

    assert result["status"] == "pending"
    assert result["impact"]["evidence_grounded"] is True
    assert result["impact"]["idea_version"] == 1
    assert result["impact"]["evidence_ids"] == [str(evidence.id)]
    assert result["impact"]["claim_map"]["verified_evidence_ids"] == [str(evidence.id)]


def test_approved_patch_route_executes_and_records_commit(monkeypatch, tmp_path):
    project_id = uuid4()
    proposal_id = uuid4()
    fake_project = project(project_id)
    proposal = Proposal(
        id=proposal_id,
        project_id=project_id,
        kind="code_patch",
        status="pending",
        reason="修复实验入口中的一个确定性错误",
        summary="更新实验入口实现",
        impact={},
        payload={"patch_schema_version": "1.0"},
    )
    session = FakeSession({(Proposal, proposal_id): proposal, (api_main.Project, project_id): fake_project})
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "project_change_impact", lambda *_args: {})
    monkeypatch.setattr(api_main, "apply_impact", lambda *_args: [])
    monkeypatch.setattr(api_main, "execute_patch", lambda *_args, **_kwargs: {
        "status": "committed", "patch_kind": "code", "commit": "c" * 40,
    })
    monkeypatch.setattr(api_main, "audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api_main, "PROJECTS_ROOT", tmp_path)

    result = asyncio.run(api_main.decide(proposal_id, ApprovalDecision(decision="approved")))

    assert result["status"] == "approved"
    assert proposal.impact["patch_execution"]["commit"] == "c" * 40
    assert proposal.decided_by == "local-user"


def test_external_publish_approval_is_rejected(monkeypatch):
    project_id = uuid4()
    proposal_id = uuid4()
    fake_project = project(project_id)
    proposal = Proposal(
        id=proposal_id,
        project_id=project_id,
        kind="external_publish",
        status="pending",
        reason="请求外部发布",
        summary="请求外部发布",
        impact={},
        payload={},
    )
    session = FakeSession({(Proposal, proposal_id): proposal, (api_main.Project, project_id): fake_project})
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))

    with pytest.raises(HTTPException) as error:
        asyncio.run(api_main.decide(proposal_id, ApprovalDecision(decision="approved")))

    assert error.value.status_code == 403
    assert error.value.detail["code"] == "external_publish_disabled"
    assert proposal.status == "pending"


def test_rollback_route_creates_new_pending_proposal(monkeypatch):
    project_id = uuid4()
    proposal_id = uuid4()
    commit = "d" * 40
    fake_project = project(project_id)
    original = Proposal(
        id=proposal_id,
        project_id=project_id,
        kind="code_patch",
        status="approved",
        reason="修复实验入口中的一个确定性错误",
        summary="更新实验入口实现",
        impact={"patch_execution": {"commit": commit, "patch_kind": "code"}},
        payload={},
    )
    session = FakeSession({(Proposal, proposal_id): original})
    monkeypatch.setattr(api_main, "session_scope", lambda: FakeContext(session))
    monkeypatch.setattr(api_main, "require_active_project", lambda *_args: fake_project)
    monkeypatch.setattr(api_main, "project_git_commit", lambda *_args: commit)
    monkeypatch.setattr(api_main, "validate_git_workspace", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(api_main, "project_change_impact", lambda *_args: {"changed": True})
    monkeypatch.setattr(api_main, "audit", lambda *_args, **_kwargs: None)

    result = api_main.propose_patch_rollback(proposal_id, PatchRollbackRequest(reason="撤回刚刚批准的 patch"))

    rollback = session.added[0]
    assert result["status"] == "pending"
    assert rollback.kind == "code_patch"
    assert rollback.payload["rollback"] is True
    assert rollback.payload["rollback_commit"] == commit
