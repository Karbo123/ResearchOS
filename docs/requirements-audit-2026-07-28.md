# Requirements Audit

Updated: 2026-07-31

Research OS remains a local auditable MVP. The 2026-07-31 architecture uses TypeScript for all repository business code, migration, scripts, acceptance, and tests. Scientific experiment workspaces may use any language; project-specific Python uses a private `.venv`.

| Capability | Status | Evidence and limits |
|---|---|---|
| Native Windows application | Implemented and locally accepted | Node.js 22 workspace, Hono API, TypeScript Web build, Mastra Studio, PGlite state, native installer source. Clean-machine installer acceptance remains open. |
| Adaptive Idea chat | Implemented and real-model accepted | Mastra Agent, strict Zod output, Memory, Skill, bounded draft Tool, no fixed questionnaire. Invalid model requests fail directly. |
| Three model tiers | Implemented | Luna/Terra/Sol model, URL, key, and reasoning effort are independent; keys are not returned. |
| Project state and audit | Implemented | PGlite tables, Idea versions, pause/resume/cancel gates, checkpoints, audit events, project Git. |
| Workflow orchestration | Implemented | Mastra research bootstrap, project chat, daily/weekly reporting Workflows, schedules, and Studio graph. |
| Durable workflow queue | Implemented | Idempotency key, lease, retry limit, stale-work recovery, allowlisted task kind. |
| Academic metadata search | Limited implementation | Crossref and OpenAlex with timeout and partial provider errors. Metadata cannot support factual claims. |
| Full-text evidence | Limited implementation | Fixed open-PDF HTTPS allowlist, 25 MB limit, SHA-256, page quotes, controlled Artifact. Claim-level semantic review remains manual. |
| Repository verification and acquisition | Not yet restored | `P0-REPO-048`; no claim of end-to-end repository download in the current runtime. |
| Experiment planning | Implemented and real-model accepted | Mastra topic-specific plan with strict schema and approval. No generic experiment substitute. |
| Native scientific execution | Implemented and integration accepted | Per-project `.venv`, fixed Windows `cmd.exe` launch, optional WSL2, timeout, process-tree cancellation, bounded logs, required metrics/checkpoint. Native controls are not VM isolation. |
| Artifact and metric lineage | Implemented | Internal Run ID, finite numeric metrics, checkpoint, SHA-256, project/experiment links, download and bounded preview. |
| Evidence paper draft | Limited implementation | Deterministic LaTeX Proposal from page quotes and successful metrics, Git/hash approval gate. Semantic claim mapping remains incomplete. |
| Uploads | Limited implementation | 50 MB gate, executable extension rejection, Windows Defender fail-closed scanning, SHA-256 and untrusted-context status. Rich parsing and large indexes remain incomplete. |
| Reports | Implemented locally | Deterministic daily/weekly/manual project reports. External notification adapters are not implemented. |
| Backup and restore check | Implemented locally | Stopped-process archive, SHA-256 manifest, non-overwriting restore validation. High availability is not implemented. |
| Windows installer and Release | Partial | Inno Setup source installs Node.js 22 LTS and starts native processes. Code signing, clean-VM acceptance, and GitHub Release publication remain open. |

## Honesty Gates

- Metadata candidates are not full-text evidence.
- Page quotes are not automatically valid support for arbitrary claims.
- Successful execution does not prove a research hypothesis.
- Model explanations do not replace deterministic metric calculation.
- Native process supervision does not provide virtual-machine security isolation.
- A declared endpoint or mocked test alone is not end-to-end acceptance.

## Current Acceptance Condition

The local MVP migration is accepted after `npm run typecheck`, `npm test`, `npm run build`, Idea source checking, docs checking, database migration, real `.venv` execution/cancellation, Mastra Studio browser inspection, Web UI inspection, and `npm run acceptance` passed. The real acceptance used the configured model endpoint and failed directly on invalid credentials. Clean-machine installer and GPU-host checks remain outside this local acceptance.
