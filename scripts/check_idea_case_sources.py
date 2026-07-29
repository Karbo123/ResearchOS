from __future__ import annotations

import ast
from pathlib import Path

from idea_case_loader import IDEA_CASES_ROOT, load_enabled_idea_cases


ROOT = Path(__file__).resolve().parents[1]
TEST_SOURCES = [
    ROOT / "scripts" / "acceptance_test.py",
    ROOT / "scripts" / "test_mnist_idea.py",
    *sorted((ROOT / "apps" / "api" / "tests").glob("test_*.py")),
]
IDEA_FUNCTIONS = {"clarify", "initial_draft", "select_model_route"}


def call_name(node: ast.Call) -> str | None:
    return node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else None


def main() -> None:
    cases = load_enabled_idea_cases()
    if not cases:
        raise SystemExit("No enabled Idea cases were found")
    violations: list[str] = []
    for source in TEST_SOURCES:
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = call_name(node)
            if name in IDEA_FUNCTIONS and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                violations.append(f"{source.relative_to(ROOT)}:{node.lineno} hard-codes an Idea argument")
            if name == "request" and len(node.args) >= 3:
                path = node.args[1]
                body = node.args[2]
                if isinstance(path, ast.Constant) and path.value == "/api/chat" and isinstance(body, ast.Dict):
                    for key, value in zip(body.keys, body.values):
                        if isinstance(key, ast.Constant) and key.value == "message" and isinstance(value, ast.Constant):
                            violations.append(f"{source.relative_to(ROOT)}:{node.lineno} hard-codes an /api/chat Idea")
    if violations:
        raise SystemExit("\n".join(violations))
    print(f"IDEA_CASES_OK={len(cases)} ROOT={IDEA_CASES_ROOT}")


if __name__ == "__main__":
    main()
