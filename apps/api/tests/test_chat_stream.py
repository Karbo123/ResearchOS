from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import app.main as main
from app.clarification import initial_draft
from app.llm import ClarificationOutcome, LLMRequestError, select_model_route
from app.models import ConversationSession
from app.schemas import AdaptiveClarificationResult, ChatRequest, ProjectCreateRequest, ResearchIdeaDraft
from scripts.idea_case_loader import load_idea_case


class _ScalarRows:
    def all(self):
        return []


class _ConversationSessionStore:
    def __init__(self, initial_message: str) -> None:
        self.conversation = ConversationSession(
            id=uuid4(),
            project_id=None,
            phase="clarifying",
            draft=initial_draft(initial_message),
            pending_field=None,
        )
        self.messages: list[object] = []

    def get(self, _model, _identifier):
        return self.conversation

    def add(self, item):
        self.messages.append(item)

    def flush(self):
        return None

    def scalars(self, _statement):
        return _ScalarRows()


def _fake_session_scope(store: _ConversationSessionStore):
    @contextmanager
    def scope():
        yield store

    return scope


def _collect_stream(request: ChatRequest) -> str:
    async def collect() -> str:
        response = await main.chat_stream(request)
        chunks: list[str] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    return asyncio.run(collect())


def test_chat_stream_reports_observable_progress_without_model_thinking(monkeypatch):
    case = load_idea_case("mnist-cnn")
    store = _ConversationSessionStore(case.initial_message)
    route = select_model_route(case.initial_message, store.conversation.draft)
    outcome = ClarificationOutcome(
        result=AdaptiveClarificationResult(
            draft=ResearchIdeaDraft(
                title="Computer vision study",
                research_question="How can a vision model be evaluated fairly?",
                domain="computer vision",
                hypotheses=["A stronger baseline improves robustness."],
            ),
            assistant_reply="Please clarify the available dataset.",
            ready_for_confirmation=False,
            unresolved_items=["available_data"],
            assumptions=["The task uses labeled images."],
            risk_flags=[],
        ),
        route=route,
    )
    monkeypatch.setattr(main, "session_scope", _fake_session_scope(store))
    monkeypatch.setattr(main, "clarify_idea_with_llm", lambda *args, **kwargs: outcome)

    body = _collect_stream(ChatRequest(
        session_id=store.conversation.id,
        message=case.initial_message,
    ))

    assert "event: model_route" in body
    assert "event: progress" in body
    assert "event: result" in body
    assert '"preparing_request"' in body
    assert '"calling_model"' in body
    assert '"saving_result"' in body
    assert 'event: thinking' not in body
    assert "思维" not in body
    assert len(store.messages) == 2


def test_chat_stream_blocks_model_when_material_context_cannot_be_loaded(monkeypatch):
    case = load_idea_case("mnist-cnn")
    store = _ConversationSessionStore(case.initial_message)
    model_calls = 0

    def forbidden_model_call(*_args, **_kwargs):
        nonlocal model_calls
        model_calls += 1
        raise AssertionError("model must not run when material context loading fails")

    monkeypatch.setattr(main, "session_scope", _fake_session_scope(store))
    monkeypatch.setattr(
        main,
        "uploaded_material_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LLMRequestError("material_context_unavailable", "材料上下文读取失败。", 422)
        ),
    )
    monkeypatch.setattr(main, "clarify_idea_with_llm", forbidden_model_call)

    body = _collect_stream(ChatRequest(
        session_id=store.conversation.id,
        message=case.initial_message,
    ))

    assert 'event: error' in body
    assert 'material_context_unavailable' in body
    assert 'event: model_route' not in body
    assert model_calls == 0
    assert len(store.messages) == 1


def test_sync_chat_blocks_model_when_material_context_cannot_be_loaded(monkeypatch):
    case = load_idea_case("mnist-cnn")
    store = _ConversationSessionStore(case.initial_message)
    model_calls = 0

    def forbidden_model_call(*_args, **_kwargs):
        nonlocal model_calls
        model_calls += 1
        raise AssertionError("model must not run when material context loading fails")

    monkeypatch.setattr(main, "session_scope", _fake_session_scope(store))
    monkeypatch.setattr(
        main,
        "uploaded_material_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LLMRequestError("material_context_unavailable", "材料上下文读取失败。", 422)
        ),
    )
    monkeypatch.setattr(main, "clarify_idea_with_llm", forbidden_model_call)

    with pytest.raises(HTTPException) as error:
        main.chat(ChatRequest(session_id=store.conversation.id, message=case.initial_message))

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "material_context_unavailable"
    assert model_calls == 0
    assert len(store.messages) == 1


def test_project_creation_requires_ready_for_confirmation(monkeypatch):
    case = load_idea_case("mnist-cnn")
    store = _ConversationSessionStore(case.initial_message)
    monkeypatch.setattr(main, "session_scope", _fake_session_scope(store))

    with pytest.raises(HTTPException) as error:
        main.create_project(
            ProjectCreateRequest(session_id=store.conversation.id, confirmed=True),
        )

    assert error.value.status_code == 409
    assert error.value.detail == "idea is not ready for confirmation"
