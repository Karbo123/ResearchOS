from __future__ import annotations

import json
import re
import subprocess
import unicodedata
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
        return "\\item " + latex_escape(empty)
    return "\n".join(f"\\item {latex_escape(item)}" for item in items[:20])


def _latex_scalar(value: Any, empty: str = "Not specified.") -> str:
    if value is None or value == "":
        return latex_escape(empty)
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return latex_escape(str(value))


def _metric_rows(metrics: Any) -> list[tuple[str, str]]:
    if not isinstance(metrics, dict):
        return []
    rows: list[tuple[str, str]] = []
    for key in sorted(metrics, key=lambda item: str(item))[:40]:
        value = metrics[key]
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        rows.append((str(key), str(value)))
    return rows


def _paper_table(rows: Iterable[tuple[str, str]], empty: str) -> str:
    materialized = list(rows)
    if not materialized:
        return latex_escape(empty)
    def breakable(value: Any) -> str:
        return _latex_scalar(value).replace(r"\_", r"\_\allowbreak{}")

    body = ["\\begin{tabular}{p{0.25\\linewidth}p{0.55\\linewidth}}", "\\toprule", "Field & Recorded value \\\\", "\\midrule"]
    body.extend(f"{breakable(key)} & {breakable(value)} \\\\" for key, value in materialized)
    body.extend(["\\bottomrule", "\\end{tabular}"])
    return "\n".join(body)


def _verified_evidence(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        row for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("metadata"), dict)
        and row["metadata"].get("verified") is True
        and str(row.get("locator") or "").strip()
        and not str(row.get("locator") or "").lower().startswith("metadata/")
        and str(row.get("quote") or "").strip()
        and str(row.get("claim") or "").strip()
        and re.fullmatch(r"[0-9a-fA-F]{64}", str(row["metadata"].get("pdf_sha256") or ""))
        and str(row["metadata"].get("bibtex") or "").strip()
        and str(row.get("source_url") or "").strip()
    ]


def _normalized_claim_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).lower().split())


def _claim_tokens(value: str) -> set[str]:
    """Create bounded, language-aware lexical tokens for review candidates.

    This intentionally remains lexical. CJK bigrams make Chinese claims
    inspectable without pretending that token overlap proves semantic support.
    """
    text = _normalized_claim_text(value)
    words = re.findall(r"[a-z0-9][a-z0-9_+-]{1,}", text)
    tokens = {word for word in words if word not in {"the", "and", "for", "with", "from", "that", "this"}}
    for run in re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]+", text):
        tokens.update(f"cjk:{run[index:index + 2]}" for index in range(max(0, len(run) - 1)))
        if len(run) == 1:
            tokens.add(f"cjk:{run}")
    return tokens


def _claim_match(target: str, row: dict[str, Any]) -> dict[str, Any] | None:
    target_text = _normalized_claim_text(target)
    evidence_text = _normalized_claim_text(f"{row.get('claim', '')} {row.get('quote', '')}")
    target_terms = _claim_tokens(target_text)
    evidence_terms = _claim_tokens(evidence_text)
    overlap = sorted(target_terms & evidence_terms)
    if not target_terms or not evidence_terms or not overlap:
        return None
    target_coverage = len(overlap) / len(target_terms)
    evidence_coverage = len(overlap) / len(evidence_terms)
    phrase_match = target_text in evidence_text or evidence_text in target_text
    minimum = 1 if len(target_terms) <= 2 else 2
    if not phrase_match and (len(overlap) < minimum or target_coverage < 0.4):
        return None
    return {
        "evidence_id": str(row.get("id")),
        "overlap_terms": overlap[:12],
        "target_coverage": round(target_coverage, 3),
        "evidence_coverage": round(evidence_coverage, 3),
        "phrase_match": phrase_match,
        "match_basis": "normalized_lexical_overlap",
        "requires_human_review": True,
    }


def build_paper_claim_map(
    spec: ProjectSpec,
    evidence: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Return deterministic provenance for paper claims without asserting novelty."""
    verified = _verified_evidence(evidence)
    if not verified:
        raise ValueError("paper_evidence_required")
    factual_claims = [{
        "evidence_id": str(row.get("id")),
        "paper_id": str(row.get("paper_id") or "") or None,
        "claim": str(row.get("claim") or "").strip(),
        "locator": str(row.get("locator") or "").strip(),
    } for row in verified if str(row.get("claim") or "").strip()]
    targets = [
        ("hypothesis", item) for item in spec.idea.hypotheses if str(item).strip()
    ] + [
        ("expected_contribution", item)
        for item in spec.idea.expected_contributions if str(item).strip()
    ]
    target_map = []
    for kind, target in targets:
        matches = [match for row in verified if (match := _claim_match(target, row))]
        matches.sort(key=lambda item: (
            not item["phrase_match"], -item["target_coverage"], -item["evidence_coverage"], item["evidence_id"]
        ))
        target_map.append({
            "kind": kind,
            "target": target,
            "status": "supported_candidate" if matches else "no_matching_evidence",
            "evidence_ids": [item["evidence_id"] for item in matches[:12]],
            "matches": matches[:12],
            "match_basis": "normalized_lexical_overlap",
            "requires_human_review": True,
        })
    return {
        "schema_version": "1.0",
        "verified_evidence_ids": [str(row.get("id")) for row in verified],
        "factual_claims": factual_claims,
        "claim_to_evidence": {
            str(row.get("id")): {
                "claim": str(row.get("claim") or "").strip(),
                "locator": str(row.get("locator") or "").strip(),
                "source_url": str(row.get("source_url") or "").strip(),
            }
            for row in verified
        },
        "idea_target_support": target_map,
        "claim_gate": "Factual Related Work sentences must cite an evidence ID; Idea hypotheses and contributions remain proposed unless independently supported.",
        "semantic_status": "not_proven_lexical_candidates_only",
    }


def build_evidence_grounded_paper(
    spec: ProjectSpec,
    evidence: Iterable[dict[str, Any]],
    papers: Iterable[dict[str, Any]],
    experiments: Iterable[dict[str, Any]],
) -> str:
    """Build a reviewable paper draft from verified evidence and recorded runs only."""
    evidence_rows = list(evidence)
    claim_map = build_paper_claim_map(spec, evidence_rows)
    verified = _verified_evidence(evidence_rows)
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
            "\\item \\textbf{Evidence ID \\texttt{" + latex_escape(evidence_id) + "}} "
            + "(" + latex_escape(locator) + "): "
            + "The retained source claim is: \\emph{" + latex_escape(str(row.get("claim") or "Unspecified claim")) + "}. "
            + "The page-level supporting quote is: \\emph{" + latex_escape(quote) + "}."
        )
        reference_key = paper_id or f"evidence-{evidence_id}"
        if reference_key not in referenced_papers:
            referenced_papers.add(reference_key)
            source_url = str(paper.get("source_url") or "")
            source_url = source_url or str(row.get("source_url") or "")
            doi = str(paper.get("doi") or "")
            reference_blocks.append(
                "\\bibitem{" + latex_escape(reference_key) + "} "
                + latex_escape(title) + ". "
                + ("DOI: " + latex_escape(doi) + ". " if doi else "")
                + ("Stable source: \\url{" + latex_escape(source_url) + "}. " if source_url else "")
                + "Evidence ID: \\texttt{" + latex_escape(evidence_id) + "}."
            )

    experiment_rows = [item for item in experiments if isinstance(item, dict)]
    recorded_results = []
    result_table_rows: list[tuple[str, str]] = []
    for experiment in experiment_rows:
        if experiment.get("status") != "succeeded":
            continue
        run_id = str(experiment.get("id") or "unknown-run")
        metric_rows = _metric_rows(experiment.get("metrics"))
        if metric_rows:
            recorded_results.append(f"Run {run_id} ({len(metric_rows)} recorded metrics)")
            for key, value in metric_rows:
                result_table_rows.append((f"{run_id} / {key}", value))
    idea = spec.idea
    constraints = [
        ("Compute", idea.constraints.compute),
        ("Budget (USD)", idea.constraints.budget_usd),
        ("Deadline", idea.constraints.deadline),
        ("Data access", idea.constraints.data_access),
        ("Ethics and compliance", idea.ethics_and_compliance),
    ]
    successful_count = sum(1 for item in experiment_rows if item.get("status") == "succeeded")
    results_section = (
        "Recorded successful runs only. Each numeric entry below is bound to the stored run ID; this table is not a causal or scientific conclusion.\\par\\smallskip\n"
        + _paper_table(result_table_rows, "Successful runs have no recorded numeric metrics; no scientific result is claimed.")
        if result_table_rows else
        "No successful experiment output with recorded metrics is available for this draft; the result status is explicitly unexecuted."
    )
    experiment_status_rows = [
        (str(item.get("id") or "unknown-run"), str(item.get("status") or "unknown"))
        for item in experiment_rows[:40]
    ]
    claim_map_rows = [
        (item["kind"] + ": " + str(item["target"]), ", ".join(item["evidence_ids"]) or "none; human review required")
        for item in claim_map["idea_target_support"]
    ]
    return "\n".join([
        "\\documentclass{article}", "\\usepackage{booktabs,graphicx,hyperref}", "\\setlength{\\emergencystretch}{3em}",
        "\\title{" + latex_escape(idea.title) + "}", "\\author{Research OS Project}",
        "\\begin{document}", "\\maketitle",
        "\\begin{abstract}This is an evidence-linked draft. It reports only verified page-level evidence and recorded experiment outputs; unexecuted work remains explicitly unexecuted.\\end{abstract}",
        "\\section{Introduction}", "This manuscript frames a proposed study in " + latex_escape(idea.domain) + ". The research question is stated by the current Idea and is not presented as an established fact: \\emph{" + latex_escape(idea.research_question) + "}.",
        "\\subsection{Scope and keywords}", _paper_table([("Keywords", ", ".join(idea.keywords)), ("Target venues", ", ".join(idea.target_venues))], "No keywords or target venue were confirmed."),
        "\\subsection{Hypotheses}", "The following are proposed hypotheses, not established results.", "\\begin{itemize}", _latex_lines(idea.hypotheses), "\\end{itemize}",
        "\\subsection{Contributions}", "The following are proposed contributions pending validation.", "\\begin{itemize}", _latex_lines(idea.expected_contributions), "\\end{itemize}",
        "\\section{Related Work}", "Each factual statement below is tied to a retained page-level evidence ID and locator. The entries summarize the retained claim and quote; they do not establish novelty or correctness beyond the cited source.",
        "\\begin{itemize}", "\n".join(evidence_blocks), "\\end{itemize}",
        "\\section{Method}", "The method below is the current approved-project specification, not an independently verified scientific method. It must be reviewed before execution.",
        _paper_table([("Domain", idea.domain), ("Available data", idea.available_data), *constraints], "No method constraints were confirmed."),
        "\\subsection{Success criteria}", "\\begin{itemize}", _latex_lines(idea.success_criteria), "\\end{itemize}",
        "\\subsection{Data and compliance}", _latex_scalar(idea.ethics_and_compliance, "No separate ethics/compliance statement was confirmed; review is required."),
        "\\section{Experiments}", "The experiment plan remains subject to approval and must be specific to the confirmed research question. The following is an inventory of persisted execution records, not a replacement for an approved plan.",
        _paper_table(experiment_status_rows, "No experiment execution records are persisted."),
        "\\subsection{Recorded successful runs}", "\\begin{itemize}", _latex_lines(recorded_results, "No successful run with numeric metrics is recorded."), "\\end{itemize}",
        "\\section{Results}", results_section,
        "\\section{Limitations}", "\\begin{itemize}", _latex_lines(idea.risks, "Risks and unresolved limitations require review."), "\\item The evidence set contains " + str(len(verified)) + " verified page-level record(s); metadata-only records are excluded.", "\\item " + str(successful_count) + " successful run(s) are recorded, and missing execution results remain unexecuted.", "\\end{itemize}",
        "\\section{Conclusion}", "This draft records a proposed research direction and its current evidence boundary. It does not claim that the hypotheses, contributions, or reported metrics establish a scientific conclusion.",
        "\\section*{Claim-to-evidence map}", "The deterministic map below is a review aid. Lexical overlap is only a candidate support signal and does not upgrade a proposed Idea statement to a factual claim.", _paper_table(claim_map_rows, "No Idea hypothesis or contribution was supplied."),
        "\\subsection*{Provenance audit}", "\\textbf{Verified evidence IDs:} " + latex_escape(", ".join(claim_map["verified_evidence_ids"])) + ".\\par "
        + "Factual Related Work claims are individually linked to evidence IDs; run results are individually linked to run IDs.",
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
