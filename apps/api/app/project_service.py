from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from uuid import UUID

from .schemas import ProjectSpec


PROJECTS_ROOT = Path(__import__("os").getenv("PROJECTS_ROOT", "projects")).resolve()


def latex_escape(value: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
        "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
        "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(char, char) for char in value)


def safe_slug(title: str, project_id: UUID) -> str:
    ascii_slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48]
    return f"{ascii_slug or 'research-project'}-{str(project_id)[:8]}"


def initialize_project(project_id: UUID, slug: str, spec: ProjectSpec) -> Path:
    root = (PROJECTS_ROOT / slug).resolve()
    if root.parent != PROJECTS_ROOT:
        raise ValueError("invalid project path")
    for relative in [
        "idea", "literature/pdfs", "literature/evidence", "code", "configs",
        "experiments/runs", "paper/figures", "paper/tables", "reports", "artifacts",
    ]:
        (root / relative).mkdir(parents=True, exist_ok=True)
    (root / "idea" / "project-spec.v1.json").write_text(
        spec.model_dump_json(indent=2), encoding="utf-8"
    )
    (root / "README.md").write_text(
        f"# {spec.idea.title}\n\nProject ID: `{project_id}`\n\n"
        "This repository contains versioned research specifications, code, configs, and paper sources. "
        "Large artifacts are referenced by metadata and stored separately.\n",
        encoding="utf-8",
    )
    (root / ".gitignore").write_text(
        "experiments/runs/\nartifacts/\nsource-bundles/\nlogs/\n*.pdf\n*.png\n*.jpg\n*.jpeg\n*.gif\n*.webp\n*.ply\n*.pcd\n*.pth\n*.pt\n*.ckpt\n*.onnx\n*.safetensors\n*.npy\n*.npz\n*.parquet\n*.db\n*.sqlite\n*.bak\n*.log\n.env\n.venv/\n.conda/\n__pycache__/\n",
        encoding="utf-8",
    )
    (root / "paper" / "main.tex").write_text(
        "\\documentclass{article}\n"
        "\\usepackage{booktabs,graphicx}\n"
        "\\title{" + latex_escape(spec.idea.title) + "}\n"
        "\\author{Research OS Project}\n"
        "\\begin{document}\\maketitle\n"
        "\\begin{abstract}Draft generated from the confirmed research specification.\\end{abstract}\n"
        "\\section{Introduction}\n" + latex_escape(spec.idea.research_question) + "\n"
        "\\section{Related Work}\nOnly verified citations with retained evidence may be added here.\n"
        "\\section{Method}\n\\section{Experiments}\n\\section{Conclusion}\n"
        "\\bibliographystyle{plain}\\bibliography{references}\n\\end{document}\n",
        encoding="utf-8",
    )
    (root / "paper" / "references.bib").write_text("% Verified BibTeX records only.\n", encoding="utf-8")
    try:
        subprocess.run(["git", "init", "--initial-branch=main", str(root)], check=True, timeout=20)
        subprocess.run(["git", "-C", str(root), "config", "user.name", "Research OS"], check=True, timeout=10)
        subprocess.run(["git", "-C", str(root), "config", "user.email", "research-os@localhost"], check=True, timeout=10)
        subprocess.run(["git", "-C", str(root), "add", "README.md", ".gitignore", "idea", "configs", "paper"], check=True, timeout=20)
        subprocess.run(["git", "-C", str(root), "commit", "-m", "Initialize research project"], check=True, timeout=20)
    except (subprocess.SubprocessError, FileNotFoundError):
        # The project remains usable if git is unavailable; the API records this in its audit log.
        pass
    return root
