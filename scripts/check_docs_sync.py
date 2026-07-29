from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
READMES = (ROOT / "README.md", ROOT / "README.zh-CN.md")
ENV_EXAMPLE = ROOT / ".env.example"

SYNC_RE = re.compile(r"<!-- DOCS_SYNC_VERSION: ([0-9-]+) -->")
PROJECT_RE = re.compile(r"<!-- ACCEPTANCE_PROJECT: ([0-9a-f-]+) -->")
LOCAL_LINK_RE = re.compile(r"!?(?:\[[^\]]*\])\(([^)]+)\)")

REQUIRED_FACTS = (
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "reasoning_effort=high",
    "n8n 1.121.0",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:5678",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:9001",
    "acceptance-20260730-015132.json",
    "6d91ff49-12a5-406c-b7aa-cb96aa3f22e4",
    "docs/assets/research-os-overview.jpg",
    "docs/assets/research-os-literature.jpg",
    "docs/assets/research-os-artifacts.jpg",
    "docs/assets/research-os-policies.jpg",
    "docs/assets/research-os-adaptive-chat.png",
    "python scripts/check_docs_sync.py",
)

REQUIRED_ENV = (
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "N8N_ENCRYPTION_KEY",
    "N8N_LOCAL_OWNER_EMAIL",
    "N8N_LOCAL_OWNER_PASSWORD",
    "RUNNER_SHARED_SECRET",
    "RUNNER_MAX_SECONDS",
    "RUNNER_IMAGE_DIGEST",
    "RESEARCH_OS_COMMIT",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "RESEARCH_LLM_PROVIDER",
    "CODEX_BRIDGE_URL",
    "CODEX_BRIDGE_SECRET",
    "CODEX_BRIDGE_TIMEOUT_SECONDS",
    "CODEX_MODEL_PROVIDER",
    "CODEX_MODEL_DEFAULT",
    "CODEX_REASONING_DEFAULT",
    "CODEX_CUSTOM_PROVIDER_NAME",
    "CODEX_CUSTOM_BASE_URL",
    "CODEX_CUSTOM_WIRE_API",
    "RESEARCH_MODEL_SIMPLE",
    "RESEARCH_REASONING_SIMPLE",
    "RESEARCH_MODEL_MEDIUM",
    "RESEARCH_REASONING_MEDIUM",
    "RESEARCH_MODEL_COMPLEX",
    "RESEARCH_REASONING_COMPLEX",
    "RESEARCH_ROUTER_SIMPLE_MAX",
    "RESEARCH_ROUTER_MEDIUM_MAX",
    "GITHUB_TOKEN",
    "SEMANTIC_SCHOLAR_API_KEY",
    "REPORT_TIMEZONE",
)


def marker(pattern: re.Pattern[str], text: str, label: str, path: Path) -> str:
    match = pattern.search(text)
    if not match:
        raise AssertionError(f"{path.name}: missing {label} marker")
    return match.group(1)


def check_local_links(path: Path, text: str) -> list[str]:
    errors: list[str] = []
    for raw_target in LOCAL_LINK_RE.findall(text):
        target = raw_target.strip().split("#", 1)[0]
        if not target or target.startswith(("http://", "https://", "mailto:")):
            continue
        target = target.replace("%20", " ")
        if not (ROOT / target).exists():
            errors.append(f"{path.name}: missing local link target {target}")
    return errors


def main() -> int:
    errors: list[str] = []
    texts = {path: path.read_text(encoding="utf-8") for path in READMES}

    sync_values: set[str] = set()
    project_values: set[str] = set()
    h2_counts: set[int] = set()
    h3_counts: set[int] = set()

    for path, text in texts.items():
        try:
            sync_values.add(marker(SYNC_RE, text, "DOCS_SYNC_VERSION", path))
            project_values.add(marker(PROJECT_RE, text, "ACCEPTANCE_PROJECT", path))
        except AssertionError as exc:
            errors.append(str(exc))

        h2_counts.add(len(re.findall(r"^## ", text, flags=re.MULTILINE)))
        h3_counts.add(len(re.findall(r"^### ", text, flags=re.MULTILINE)))
        for fact in REQUIRED_FACTS:
            if fact not in text:
                errors.append(f"{path.name}: missing synchronized fact {fact!r}")
        errors.extend(check_local_links(path, text))

    if len(sync_values) != 1:
        errors.append(f"README sync markers differ: {sorted(sync_values)}")
    if len(project_values) != 1:
        errors.append(f"README acceptance projects differ: {sorted(project_values)}")
    if len(h2_counts) != 1 or len(h3_counts) != 1:
        errors.append(
            "README section counts differ: "
            f"h2={sorted(h2_counts)}, h3={sorted(h3_counts)}"
        )

    env_text = ENV_EXAMPLE.read_text(encoding="utf-8")
    for name in REQUIRED_ENV:
        if not re.search(rf"^{re.escape(name)}=", env_text, flags=re.MULTILINE):
            errors.append(f".env.example: missing {name}")
        for path, text in texts.items():
            if f"`{name}`" not in text:
                errors.append(f"{path.name}: configuration reference missing {name}")

    for image_name in (
        "research-os-overview.jpg",
        "research-os-literature.jpg",
        "research-os-artifacts.jpg",
        "research-os-policies.jpg",
    ):
        image_path = ROOT / "docs" / "assets" / image_name
        if not image_path.exists():
            errors.append(f"missing screenshot: {image_path.relative_to(ROOT)}")
            continue
        data = image_path.read_bytes()
        if len(data) < 10_000 or not data.startswith(b"\xff\xd8\xff"):
            errors.append(f"invalid or unexpectedly small JPEG: {image_path.relative_to(ROOT)}")

    adaptive_image = ROOT / "docs" / "assets" / "research-os-adaptive-chat.png"
    if not adaptive_image.exists():
        errors.append(f"missing screenshot: {adaptive_image.relative_to(ROOT)}")
    else:
        data = adaptive_image.read_bytes()
        if len(data) < 10_000 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
            errors.append(f"invalid or unexpectedly small PNG: {adaptive_image.relative_to(ROOT)}")

    if errors:
        print("Documentation synchronization check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    sync_version = next(iter(sync_values))
    project_id = next(iter(project_values))
    print(
        "Documentation synchronization check passed: "
        f"version={sync_version}, acceptance_project={project_id}, "
        f"README_h2={next(iter(h2_counts))}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
