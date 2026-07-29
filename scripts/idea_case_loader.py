from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal


ClarificationMode = Literal["automatic", "detailed"]
ROOT = Path(__file__).resolve().parents[1]
IDEA_CASES_ROOT = (ROOT / "tests" / "idea-cases").resolve()
CASE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CASE_FIELDS = {
    "schema_version", "id", "description", "enabled", "clarification_mode",
    "initial_message", "confirmed_facts", "project_messages", "expect",
}
EXPECT_FIELDS = {
    "phase", "missing_fields_contains", "model_tier", "model",
    "reply_contains_any", "reply_excludes",
    "final_feasibility",
}


@dataclass(frozen=True)
class IdeaCase:
    schema_version: str
    id: str
    description: str
    enabled: bool
    clarification_mode: ClarificationMode
    initial_message: str
    confirmed_facts: dict[str, str]
    project_messages: dict[str, str]
    expect: dict[str, Any]
    source_path: Path


def _string_list(value: Any, field: str) -> None:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ValueError(f"{field} must be a list of non-empty strings")


def _validate(raw: Any, source_path: Path) -> IdeaCase:
    if not isinstance(raw, dict) or set(raw) != CASE_FIELDS:
        unknown = sorted(set(raw or {}) - CASE_FIELDS) if isinstance(raw, dict) else []
        missing = sorted(CASE_FIELDS - set(raw or {})) if isinstance(raw, dict) else sorted(CASE_FIELDS)
        raise ValueError(f"{source_path.name}: invalid fields; missing={missing}, unknown={unknown}")
    case_id = raw["id"]
    if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id):
        raise ValueError(f"{source_path.name}: id must be lowercase kebab-case")
    if source_path.stem != case_id:
        raise ValueError(f"{source_path.name}: filename must match case id {case_id!r}")
    if raw["schema_version"] != "1.0":
        raise ValueError(f"{source_path.name}: unsupported schema_version")
    if not isinstance(raw["description"], str) or not raw["description"].strip():
        raise ValueError(f"{source_path.name}: description must be a non-empty string")
    if not isinstance(raw["enabled"], bool):
        raise ValueError(f"{source_path.name}: enabled must be boolean")
    if raw["clarification_mode"] not in {"automatic", "detailed"}:
        raise ValueError(f"{source_path.name}: clarification_mode must be automatic or detailed")
    if not isinstance(raw["initial_message"], str) or not raw["initial_message"].strip():
        raise ValueError(f"{source_path.name}: initial_message must be a non-empty string")
    facts = raw["confirmed_facts"]
    if not isinstance(facts, dict) or not all(
        isinstance(key, str) and key.strip() and isinstance(value, str) and value.strip()
        for key, value in facts.items()
    ):
        raise ValueError(f"{source_path.name}: confirmed_facts must map strings to non-empty strings")
    project_messages = raw["project_messages"]
    if not isinstance(project_messages, dict) or not all(
        isinstance(key, str) and key.strip() and isinstance(value, str) and value.strip()
        for key, value in project_messages.items()
    ):
        raise ValueError(f"{source_path.name}: project_messages must map strings to non-empty strings")
    expect = raw["expect"]
    if not isinstance(expect, dict) or not expect or set(expect) - EXPECT_FIELDS:
        raise ValueError(f"{source_path.name}: expect contains unsupported or empty fields")
    for field in ("missing_fields_contains", "reply_contains_any", "reply_excludes"):
        if field in expect:
            _string_list(expect[field], f"{source_path.name}: expect.{field}")
    for field in ("phase", "model_tier", "model", "final_feasibility"):
        if field in expect and (not isinstance(expect[field], str) or not expect[field].strip()):
            raise ValueError(f"{source_path.name}: expect.{field} must be a non-empty string")
    return IdeaCase(
        schema_version=raw["schema_version"], id=case_id, description=raw["description"],
        enabled=raw["enabled"], clarification_mode=raw["clarification_mode"],
        initial_message=raw["initial_message"], confirmed_facts=facts, project_messages=project_messages,
        expect=expect, source_path=source_path,
    )


def idea_case_ids() -> list[str]:
    if not IDEA_CASES_ROOT.is_dir():
        raise FileNotFoundError(f"Idea case directory is missing: {IDEA_CASES_ROOT}")
    return sorted(path.stem for path in IDEA_CASES_ROOT.glob("*.json"))


def load_idea_case(case_id: str) -> IdeaCase:
    if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id):
        raise ValueError("case_id must be lowercase kebab-case")
    source_path = (IDEA_CASES_ROOT / f"{case_id}.json").resolve()
    if source_path.parent != IDEA_CASES_ROOT:
        raise ValueError("Idea case path escaped the fixed case directory")
    try:
        raw = json.loads(source_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise KeyError(f"unknown Idea case: {case_id}") from exc
    return _validate(raw, source_path)


def load_enabled_idea_cases() -> list[IdeaCase]:
    cases = [load_idea_case(case_id) for case_id in idea_case_ids()]
    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate Idea case ids")
    return [case for case in cases if case.enabled]
