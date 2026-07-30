from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Iterable
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


def _latex_lines(values: Iterable[Any], empty: str = "Not specified.") -> str:
    items = [str(value).strip() for value in values if str(value).strip()]
    if not items:
        return latex_escape(empty)
    return "\n".join(f"\\item {latex_escape(item)}" for item in items[:20])


def _verified_evidence(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        row for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("metadata"), dict)
        and row["metadata"].get("verified") is True
        and str(row.get("locator") or "").strip()
        and not str(row.get("locator") or "").lower().startswith("metadata/")
        and str(row.get("quote") or "").strip()
    ]


def build_evidence_grounded_paper(
    spec: ProjectSpec,
    evidence: Iterable[dict[str, Any]],
    papers: Iterable[dict[str, Any]],
    experiments: Iterable[dict[str, Any]],
) -> str:
    """Build a reviewable paper draft from verified evidence and recorded runs only."""
    verified = _verified_evidence(evidence)
    if not verified:
        raise ValueError("paper_evidence_required")
    paper_by_id = {str(row.get("id")): row for row in papers if isinstance(row, dict)}
    evidence_blocks = []
    reference_blocks = []
    referenced_papers: set[str] = set()
    for row in verified[:30]:
        evidence_id = str(row.get("id"))
        paper_id = str(row.get("paper_id") or "")
        paper = paper_by_id.get(paper_id, {})
        title = str(paper.get("title") or "Verified source")
        locator = str(row.get("locator"))
        quote = str(row.get("quote"))[:1200]
        evidence_blocks.append(
            "\\item \\textbf{Evidence " + latex_escape(evidence_id) + "}: "
            + latex_escape(title) + " (" + latex_escape(locator) + "). "
            + "\\emph{" + latex_escape(quote) + "}"
        )
        if paper_id and paper_id not in referenced_papers:
            referenced_papers.add(paper_id)
            source_url = str(paper.get("source_url") or "")
            doi = str(paper.get("doi") or "")
            reference_blocks.append(
                "\\bibitem{" + latex_escape(paper_id) + "} "
                + latex_escape(title) + ". "
                + ("DOI: " + latex_escape(doi) + ". " if doi else "")
                + ("Stable source: \\url{" + source_url + "}." if source_url else "")
            )

    recorded_results = []
    for experiment in experiments:
        if not isinstance(experiment, dict) or experiment.get("status") != "succeeded":
            continue
        metrics = experiment.get("metrics")
        if isinstance(metrics, dict) and metrics:
            metric_text = "; ".join(f"{key}={value}" for key, value in list(metrics.items())[:30])
            recorded_results.append(f"Run {experiment.get('id')}: {metric_text}")
    idea = spec.idea
    results_section = (
        "Recorded successful runs only:\\begin{itemize}\\n"
        + _latex_lines(recorded_results) + "\\n\\end{itemize}"
        if recorded_results else
        "No successful experiment output is recorded for this draft; no scientific result is claimed."
    )
    return "\n".join([
        "\\documentclass{article}", "\\usepackage{booktabs,graphicx,hyperref}",
        "\\title{" + latex_escape(idea.title) + "}", "\\author{Research OS Project}",
        "\\begin{document}", "\\maketitle",
        "\\begin{abstract}This is an evidence-linked draft. It reports only verified page-level evidence and recorded experiment outputs; unexecuted work remains explicitly unexecuted.\\end{abstract}",
        "\\section{Introduction}", latex_escape(idea.research_question),
        "\\subsection{Hypotheses}", "\\begin{itemize}", _latex_lines(idea.hypotheses), "\\end{itemize}",
        "\\subsection{Contributions}", "\\begin{itemize}", _latex_lines(idea.expected_contributions), "\\end{itemize}",
        "\\section{Related Work}", "The following claims are linked to retained page-level evidence; metadata-only records are excluded.",
        "\\begin{itemize}", "\n".join(evidence_blocks), "\\end{itemize}",
        "\\section{Method}", "\\textbf{Domain:} " + latex_escape(idea.domain) + "\\par\\smallskip",
        "\\textbf{Available data:} " + latex_escape(idea.available_data or "Not confirmed."),
        "\\subsection{Success criteria}", "\\begin{itemize}", _latex_lines(idea.success_criteria), "\\end{itemize}",
        "\\section{Experiments}", "The experiment plan remains subject to the project's approval gates and must be specific to the confirmed research question.",
        "\\section{Results}", results_section,
        "\\section{Limitations}", "\\begin{itemize}", _latex_lines(idea.risks, "Risks and unresolved limitations require review."), "\\end{itemize}",
        "\\section{References}", "\\begin{thebibliography}{99}", "\n".join(reference_blocks), "\\end{thebibliography}",
        "\\end{document}",
    ]) + "\n"


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
