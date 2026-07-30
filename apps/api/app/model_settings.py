"""Local-only model route settings with masked reads and atomic writes."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


TIERS = ("simple", "medium", "complex")
DEFAULTS = {
    "simple": {"model": "gpt-5.6-luna", "reasoning_effort": "low"},
    "medium": {"model": "gpt-5.6-terra", "reasoning_effort": "medium"},
    "complex": {"model": "gpt-5.6-sol", "reasoning_effort": "high"},
}
ALLOWED_REASONING = {"low", "medium", "high"}


def settings_path() -> Path:
    return Path(os.getenv("MODEL_SETTINGS_PATH", "/workspace/runtime/model-settings.json")).resolve()


def _env_settings(tier: str) -> dict[str, str]:
    suffix = tier.upper()
    shared_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    shared_key = os.getenv("OPENAI_API_KEY", "").strip()
    return {
        "model": os.getenv(f"RESEARCH_MODEL_{suffix}", DEFAULTS[tier]["model"]).strip(),
        "url": os.getenv(f"RESEARCH_MODEL_URL_{suffix}", "").strip() or shared_url,
        "key": os.getenv(f"RESEARCH_MODEL_KEY_{suffix}", "").strip() or shared_key,
        "reasoning_effort": os.getenv(
            f"RESEARCH_REASONING_{suffix}", DEFAULTS[tier]["reasoning_effort"]
        ).strip(),
    }


def load_settings() -> dict[str, dict[str, str]]:
    result = {tier: _env_settings(tier) for tier in TIERS}
    path = settings_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return result
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("model settings file is invalid") from exc
    if not isinstance(raw, dict) or set(raw) != set(TIERS):
        raise RuntimeError("model settings file has an invalid shape")
    for tier in TIERS:
        item = raw[tier]
        if not isinstance(item, dict) or set(item) != {"model", "url", "key", "reasoning_effort"}:
            raise RuntimeError("model settings file has an invalid tier")
        # Runtime settings are overrides. Empty values from an older or
        # partially written file must not erase the container's .env defaults.
        for key in ("model", "url", "key", "reasoning_effort"):
            value = str(item[key]).strip()
            if value:
                result[tier][key] = value
    return result


def public_settings() -> dict[str, dict[str, Any]]:
    settings = load_settings()
    runtime_fields: dict[str, set[str]] = {tier: set() for tier in TIERS}
    try:
        raw = json.loads(settings_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        raw = None
    except (OSError, json.JSONDecodeError):
        raw = None
    if isinstance(raw, dict):
        for tier in TIERS:
            item = raw.get(tier)
            if isinstance(item, dict):
                runtime_fields[tier] = {
                    field for field in ("model", "url", "key", "reasoning_effort")
                    if str(item.get(field, "")).strip()
                }
    return {
        tier: {
            "model": item["model"],
            "url": item["url"],
            "reasoning_effort": item["reasoning_effort"],
            "key_configured": bool(item["key"]),
            "sources": {
                field: ("runtime_override" if field in runtime_fields[tier] else "env_default")
                for field in ("model", "url", "key", "reasoning_effort")
            },
        }
        for tier, item in settings.items()
    }


def save_settings(value: dict[str, dict[str, str]]) -> None:
    if set(value) != set(TIERS):
        raise ValueError("all three model tiers are required")
    normalized: dict[str, dict[str, str]] = {}
    for tier in TIERS:
        item = value[tier]
        required = {"model", "url", "key", "reasoning_effort"}
        if set(item) != required:
            raise ValueError("model settings contain unsupported fields")
        model = item["model"].strip()
        url = item["url"].strip()
        key = item["key"].strip()
        effort = item["reasoning_effort"].strip()
        if not model or not url or not key:
            raise ValueError(f"{tier} model, url, and key are required")
        if effort not in ALLOWED_REASONING:
            raise ValueError(f"{tier} reasoning_effort must be low, medium, or high")
        if not url.startswith("https://"):
            raise ValueError(f"{tier} url must use https")
        normalized[tier] = {
            "model": model, "url": url, "key": key, "reasoning_effort": effort,
        }
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(normalized, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_name = handle.name
    os.replace(temp_name, path)


def route_settings(tier: str) -> dict[str, str]:
    if tier not in TIERS:
        raise ValueError("unknown model tier")
    return load_settings()[tier]
