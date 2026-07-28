from __future__ import annotations

import os

import httpx
from openai import OpenAI
from pydantic import BaseModel, Field

from .clarification import initial_draft


class InitialIdeaExtraction(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    research_question: str | None = None
    domain: str | None = None
    keywords: list[str] = Field(default_factory=list, max_length=20)


def initial_draft_with_llm(message: str) -> dict:
    """Extract only explicit facts; deterministic clarification remains the fallback and guardrail."""
    draft = initial_draft(message)
    bridge_url = os.getenv("CODEX_BRIDGE_URL", "").rstrip("/")
    if bridge_url:
        try:
            response = httpx.post(
                f"{bridge_url}/v1/extract-idea",
                json={"message": message},
                headers={"X-Codex-Bridge-Secret": os.getenv("CODEX_BRIDGE_SECRET", "")},
                timeout=float(os.getenv("CODEX_BRIDGE_TIMEOUT_SECONDS", "240")),
            )
            response.raise_for_status()
            parsed = InitialIdeaExtraction.model_validate(response.json()["result"])
            draft.update(parsed.model_dump(exclude_none=True))
            return draft
        except (httpx.HTTPError, KeyError, ValueError):
            pass
    if not os.getenv("OPENAI_API_KEY"):
        return draft
    try:
        client = OpenAI(
            api_key=os.environ["OPENAI_API_KEY"],
            base_url=os.getenv("OPENAI_BASE_URL") or None,
            timeout=60,
            max_retries=1,
        )
        response = client.responses.parse(
            model=os.getenv("OPENAI_MODEL", "gpt-5.6-sol"),
            reasoning={"effort": os.getenv("OPENAI_REASONING_EFFORT", "high")},
            input=[
                {"role": "system", "content": "Extract only information explicitly stated in the research idea. Do not invent a domain or constraints. Return strict structured output."},
                {"role": "user", "content": message},
            ],
            text_format=InitialIdeaExtraction,
        )
        parsed = response.output_parsed
        if parsed:
            draft.update(parsed.model_dump(exclude_none=True))
    except Exception:
        # An unavailable provider must not prevent local clarification or weaken validation.
        pass
    return draft
