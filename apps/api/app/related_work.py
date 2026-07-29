"""Conservative, evidence-linked Related Work analysis.

This module deliberately reports coverage and candidates. It does not infer
novelty, scientific truth, or duplicate research from metadata alone.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


STOPWORDS = {
    "about", "after", "also", "and", "are", "been", "being", "but", "can",
    "for", "from", "have", "into", "more", "not", "that", "than", "the",
    "their", "there", "these", "this", "those", "through", "with", "without",
}


def _tokens(value: str) -> set[str]:
    words = re.findall(r"[a-z0-9][a-z0-9_+-]{2,}", (value or "").lower())
    return {word for word in words if word not in STOPWORDS}


def _is_verified_fulltext(item: dict[str, Any]) -> bool:
    metadata = item.get("metadata") or {}
    locator = str(item.get("locator") or "").strip().lower()
    return bool(
        metadata.get("verified") is True
        and item.get("quote")
        and locator
        and not locator.startswith("metadata/")
        and metadata.get("pdf_sha256")
        and metadata.get("bibtex")
        and item.get("source_url")
    )


def _paper_id(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def build_related_work_analysis(
    idea: dict[str, Any],
    papers: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a deterministic evidence coverage report for one ProjectSpec."""

    paper_by_id = {_paper_id(item.get("id")): item for item in papers}
    evidence_by_paper: dict[str, list[dict[str, Any]]] = defaultdict(list)
    verified_evidence: list[dict[str, Any]] = []
    metadata_evidence: list[dict[str, Any]] = []
    for item in evidence:
        paper_id = _paper_id(item.get("paper_id"))
        if _is_verified_fulltext(item):
            verified_evidence.append(item)
            if paper_id:
                evidence_by_paper[paper_id].append(item)
        else:
            metadata_evidence.append(item)

    related_work = []
    for paper in papers:
        paper_id = _paper_id(paper.get("id"))
        linked = evidence_by_paper.get(paper_id or "", [])
        related_work.append({
            "paper_id": paper_id,
            "title": paper.get("title"),
            "doi": paper.get("doi"),
            "source_url": paper.get("source_url"),
            "status": "fulltext_evidence" if linked else "metadata_candidate",
            "evidence_ids": [str(item["id"]) for item in linked if item.get("id")],
            "claims": [item.get("claim") for item in linked if item.get("claim")],
            "note": (
                "Claims are linked to stored page-level evidence; semantic synthesis still requires review."
                if linked else
                "Metadata/title candidate only; it cannot support a factual paper claim."
            ),
        })

    evidence_rows = [{
        "evidence_id": str(item["id"]),
        "paper_id": _paper_id(item.get("paper_id")),
        "title": (paper_by_id.get(_paper_id(item.get("paper_id"))) or {}).get("title"),
        "claim": item.get("claim"),
        "quote": item.get("quote"),
        "locator": item.get("locator"),
        "source_url": item.get("source_url"),
        "pdf_sha256": (item.get("metadata") or {}).get("pdf_sha256"),
        "pdf_artifact_id": (item.get("metadata") or {}).get("pdf_artifact_id"),
        "support_status": "evidence_linked_candidate",
    } for item in verified_evidence]

    idea_payload = idea.get("idea") if isinstance(idea.get("idea"), dict) else idea
    targets = [
        ("hypothesis", value) for value in idea_payload.get("hypotheses", [])
        if isinstance(value, str) and value.strip()
    ] + [
        ("expected_contribution", value) for value in idea_payload.get("expected_contributions", [])
        if isinstance(value, str) and value.strip()
    ]
    gap_candidates = []
    coverage = []
    for kind, target in targets:
        target_terms = _tokens(target)
        supporting = []
        for item in verified_evidence:
            evidence_terms = _tokens(f"{item.get('claim', '')} {item.get('quote', '')}")
            overlap = sorted(target_terms & evidence_terms)
            minimum = 1 if len(target_terms) <= 2 else 2
            if len(overlap) >= minimum:
                supporting.append({"evidence_id": str(item["id"]), "overlap_terms": overlap[:8]})
        coverage.append({
            "kind": kind,
            "target": target,
            "supporting_evidence": supporting,
            "status": "covered_candidate" if supporting else "no_matching_fulltext_evidence",
        })
        if not supporting:
            gap_candidates.append({
                "kind": "evidence_coverage_gap",
                "target": target,
                "statement": "No stored page-level evidence currently covers this hypothesis or expected contribution.",
                "basis_evidence_ids": [],
                "confidence": "low",
                "status": "candidate_only",
                "requires_human_review": True,
            })

    idea_terms = _tokens(" ".join([
        str(idea_payload.get("research_question") or ""),
        *[str(value) for _, value in targets],
    ]))
    duplicate_candidates = []
    for paper in papers:
        paper_id = _paper_id(paper.get("id"))
        linked = evidence_by_paper.get(paper_id or "", [])
        paper_terms = _tokens(" ".join([
            str(paper.get("title") or ""),
            *[str(item.get("claim") or "") for item in linked],
            *[str(item.get("quote") or "") for item in linked],
        ]))
        overlap = sorted(idea_terms & paper_terms)
        if overlap:
            duplicate_candidates.append({
                "paper_id": paper_id,
                "title": paper.get("title"),
                "overlap_terms": overlap[:8],
                "overlap_score": round(len(overlap) / max(len(idea_terms), 1), 3),
                "basis": "lexical overlap with the Idea and available title/evidence text",
                "status": "candidate_only",
                "requires_human_review": True,
                "fulltext_evidence_ids": [str(item["id"]) for item in linked if item.get("id")],
            })
    duplicate_candidates.sort(key=lambda item: item["overlap_score"], reverse=True)

    verified_paper_count = sum(1 for paper in papers if paper.get("verified") and paper.get("doi"))
    if not papers:
        assessment = "no_literature_records"
    elif not verified_evidence:
        assessment = "metadata_only_insufficient_evidence"
    elif gap_candidates:
        assessment = "evidence_coverage_gaps_require_review"
    else:
        assessment = "evidence_linked_candidates_require_review"

    blocking_questions = []
    if not papers:
        blocking_questions.append("No literature records are available for comparison.")
    if not verified_evidence:
        blocking_questions.append("Ingest verified page-level full-text evidence before making factual Related Work claims.")
    if gap_candidates:
        blocking_questions.append("Manually verify whether each evidence-coverage gap is a research gap or only a retrieval gap.")

    return {
        "assessment": assessment,
        "verified_paper_count": verified_paper_count,
        "fulltext_evidence_count": len(verified_evidence),
        "metadata_candidate_count": len(metadata_evidence),
        "summary": "This report organizes evidence and flags candidates; it does not establish novelty, duplication, or scientific conclusions.",
        "related_work": related_work,
        "evidence": evidence_rows,
        "coverage": coverage,
        "research_gap_candidates": gap_candidates,
        "duplicate_candidates": duplicate_candidates[:10],
        "blocking_questions": blocking_questions,
        "claim_gate": "Only verified page-level evidence with locator, PDF SHA-256, source URL and BibTeX may support factual claims; metadata candidates remain non-evidentiary.",
    }
