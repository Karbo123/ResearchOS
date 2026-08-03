# Requirements Audit

Updated: 2026-08-02

Research OS remains a local auditable MVP. The 2026-08-01 architecture uses TypeScript for all repository business code, migration, scripts, acceptance, and tests. Scientific experiment workspaces may use any language; project-specific Python uses a private `.venv`. Native Windows hosting was dropped on 2026-08-01: the stack runs only inside WSL2/Linux and Windows acts as a browser client.

| Capability | Status | Evidence and limits |
|---|---|---|
| Runtime platform (WSL2/Linux only) | Implemented; native Windows hosting dropped | NVM-managed Node.js 26.5.1 workspace inside WSL2 (Ubuntu 22.04), Hono API, TypeScript Web build, Mastra Studio, PGlite state, passing application tests, and startup commands that load `.env`. `.env` selects `RESEARCH_RUNTIME_DIR=runtime` (production `runtime/research-os.pglite`, 16 projects). The Windows installer and `cmd.exe` launchers were removed on 2026-08-01. |
| Adaptive Idea chat | Implemented and real-model accepted | Mastra Agent, strict Zod output, Memory, Skill, bounded draft Tool, no fixed questionnaire. Invalid model requests fail directly. |
| Three model tiers | Implemented | Luna/Terra/Sol model, URL, key, and reasoning effort are independent; keys are not returned. |
| Project state and audit | Implemented | PGlite tables, versioned Ideas, pause/resume/cancel gates, semantic dependency invalidation, checkpoint recovery Proposal gates, audit events, and project Git. |
| Workflow orchestration | Implemented | Mastra research bootstrap, project chat, daily/weekly reporting Workflows, schedules, and Studio graph. |
| Durable workflow queue | Implemented | Idempotency key, lease, retry limit, stale-work recovery, allowlisted task kind. |
| Academic metadata search | Partial implementation (C6/C7 in progress) | TypeScript adapters with strict candidate/attempt/failure contracts and offline fixtures cover Crossref, OpenAlex, Semantic Scholar, DBLP, and arXiv search. Project-scoped DOI/title/URL/BibTeX/PDF/known-Paper seeds, DOI/stable-id/title-year deduplication, provider-source retention, approval-gated depth/width/max-total recursion, progress/cancel events, non-dangling citation edges, candidate review, field provenance, the evidence-gated research-status matrix, project-scoped graph projection, and auditable gap candidates are implemented and tested. Browser visual acceptance, pending/rejected ClaimReview fixtures, code-reproduction flow, fixed-commit reproduction comparison/innovation candidates, and full five-provider acceptance remain open. Metadata cannot support factual claims. |
| Research-status and citation-graph UI | Partial implementation (C6/C7 in progress) | React renders an interactive, deterministic layered SVG with candidate/Paper/Evidence/ClaimReview nodes, stored relation arrows, node status, evidence status, source/locator details, keyboard selection, project permission and horizontal narrow-screen scrolling. Desktop inspection and the 2026-08-02 browser checks for empty state, narrow graph scrolling, project scope, keyboard selection, and project-switch cleanup have passed. Loading/error/partial fixtures, complete matrix narrow-screen verification, and a real multi-relation graph remain open; the graph is not evidence by itself. |
| Full-text evidence | Limited implementation | Fixed open-PDF HTTPS allowlist, 25 MB limit, SHA-256, page quotes, controlled Artifact. Claim-level semantic review remains manual. |
| Repository verification and acquisition | Partial implementation; C8 in progress | User-submitted GitHub/GitLab HTTPS candidates are matched to a paper by DOI or exact title in repository citation files, checked against an SPDX allowlist, and pinned to a 40-character commit. The new `repository_download` path safely extracts a source Artifact into the project experiment reproduction area without modifying method Git; separate dependency, run, and result-Artifact Proposal paths are implemented and covered by focused WSL2 tests. Real Linux dependency installation, an actual external repository run, browser visual acceptance, and full C8 lineage/recovery acceptance remain open. This is source acquisition evidence, not proof that the repository is official beyond the recorded matching evidence. |
| Experiment planning | Implemented and real-model accepted | Mastra topic-specific plan with strict schema and approval. No generic experiment substitute. |
| Native scientific execution | Implemented and integration accepted | Per-project `.venv`, fixed Linux launch (`python3 -m venv` + `.venv/bin/python`), timeout, SIGKILL process-tree cancellation, bounded logs, required metrics/checkpoint. Native controls are not VM isolation. |
| Artifact and metric lineage | Implemented and tested | Internal Run ID, Idea/Git/config/source dependency edges, recursive invalidation and upstream fingerprint reconciliation, finite numeric metrics, SHA-256 Artifacts, checkpoint file-integrity checks, approval-gated recovery, project/experiment links, download, and bounded preview. |
| Evidence paper draft | Limited implementation | Deterministic LaTeX Proposal from page quotes and successful metrics, Git/hash approval gate. Semantic claim mapping remains incomplete. |
| Uploads | Limited implementation | 50 MB gate, executable extension rejection, Windows Defender fail-closed scanning, SHA-256 and untrusted-context status. Rich parsing and large indexes remain incomplete. |
| Project semantic memory | Partial implementation | Official Supermemory SDK and Mastra integration, deterministic project container tags, strict ingestion/file bounds, local `memory_links` ledger, project-scoped search/Graph APIs, source metadata, idempotency, and approval-gated revoke/delete are implemented. Real provider validation, configured two-project isolation testing, and full business-event ingestion remain open; failures are direct structured errors without semantic fallback. |
| Reports | Implemented locally with lineage guard | Deterministic daily/weekly/manual project reports persist a project-scoped `source_snapshot`; reads revalidate Paper, Evidence, Experiment, Proposal, and valid Artifact IDs. Pre-lineage rows are `legacy_unverified`; scope mismatch, cross-project source, missing source, and invalid Artifact are `blocked` and are not rendered. External notification adapters, immutable report versions, and full event-based report generation are not implemented. |
| Backup and restore check | Implemented locally | Stopped-process archive, SHA-256 manifest, non-overwriting restore validation. High availability is not implemented. |
| Windows installer and Release | Removed | Inno Setup installer and its Release workflow were deleted on 2026-08-01 with native Windows hosting; Windows is no longer a supported runtime. |

## Honesty Gates

- Metadata candidates are not full-text evidence.
- Page quotes are not automatically valid support for arbitrary claims.
- Successful execution does not prove a research hypothesis.
- Model explanations do not replace deterministic metric calculation.
- Native process supervision does not provide virtual-machine security isolation.
- A declared endpoint or mocked test alone is not end-to-end acceptance.

## Current Acceptance Condition

The code-level MVP migration checks pass after `npm run typecheck`, `npm test`, `npm run build`, Idea source checking, docs checking, real `.venv` execution/cancellation, Mastra Studio browser inspection, Web UI inspection, and `npm run acceptance` under NVM-managed Node.js 26.5.1 inside WSL2. GPU-host and real configured Supermemory API checks remain outside this local acceptance; clean-machine installer acceptance no longer applies because native Windows hosting was dropped.
