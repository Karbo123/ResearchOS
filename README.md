<!-- DOCS_SYNC_VERSION: 2026-07-31-12 -->

# Research OS

[简体中文](README.zh-CN.md)

Research OS is a local, auditable research-automation MVP. The application is implemented in TypeScript with Mastra Agents and Workflows. Scientific experiment workspaces may use any language; a scientific Python project receives its own `.venv`.

## Status

The native Windows migration is implemented at the code level and its application tests and Node.js 26.5.1 build pass under NVM for Windows. The TypeScript API, embedded PostgreSQL-compatible state store, Mastra integration, persistent workflow queue, React Web UI, approval gates, local experiment supervisor, artifact ledger, Windows Defender upload gate, and Windows installer source are implemented. The original `runtime/research-os.pglite` is preserved as a legacy PostgreSQL cluster; the project `.env` now explicitly selects the verified non-overwriting recovery candidate `runtime/restore-pglite-20260731`, which serves the local API and Mastra Studio on `127.0.0.1:8080` and `127.0.0.1:4111`. Clean-machine installer signing/release and GPU-host validation remain separate open work.

Model failures are final structured errors. The application never substitutes a local reply, another provider, or an unrelated experiment.

## Architecture

- `apps/server`: Hono API, PGlite state, queue, evidence, approvals, reports, repository verification/acquisition, artifact ledger, and native experiment supervisor.
- `apps/mastra`: Mastra Agents, Memory, Skills, bounded Tools, Workflows, schedules, and Studio graph.
- `apps/web`: React 19 + TypeScript component source and esbuild-generated static assets served by the API.
- `projects/<project-id>`: isolated Git workspaces. Scientific Python uses `projects/<project-id>/.venv`.
- `artifacts`: controlled uploads, evidence PDFs, experiment outputs, acceptance results, and backups.
- `runtime`: ignored local application state, model overrides, Mastra memory, logs, and PID data.

PGlite is the durable business state source. Mastra Memory is local and does not replace project, approval, artifact, or audit state.

## Requirements

- Windows 10/11 x64
- NVM for Windows with Node.js `26.5.1` (the repository default; `package.json` accepts Node.js `>=22.13`)
- Git for Windows
- Windows Defender for uploads
- Optional: Python 3.11+ for scientific Python experiments
- Optional: WSL2 as an explicitly selected experiment backend
- Optional: a TeX distribution providing `latexmk.exe`

## Quick Start

```powershell
nvm install 26.5.1
nvm use 26.5.1
npm ci
npm run build
npm start
```

The repository pins the development Node.js version in `.nvmrc`. Verify the active version with `nvm current` and `node --version`; do not use a separate portable Node.js directory. The Windows installer source currently bundles its own Node.js runtime independently of the development shell.

The currently selected and verified recovery candidate is available at [http://127.0.0.1:8080](http://127.0.0.1:8080). Mastra Studio and workflow graphs run at [http://127.0.0.1:4111](http://127.0.0.1:4111) and are linked from the lower-left navigation. Startup commands load `.env` automatically; `RESEARCH_RUNTIME_DIR` is an explicit, auditable runtime selection and the legacy database directory remains untouched.

The legacy primary directory is preserved. A non-overwriting recovery candidate can be generated and checked with `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731`. After inspection, select it explicitly in `.env` with `RESEARCH_RUNTIME_DIR=runtime/restore-pglite-20260731`; `npm start` loads that setting automatically.

Development:

```powershell
npm run dev
npm run typecheck
npm test
```

## Model Settings

Luna, Terra, and Sol are fully independent. Each tier has its own model, URL, key, and reasoning effort. The settings API returns only `key_configured`; it never returns a key. Runtime code reads project `.env` and `runtime/model-settings.json`, never Codex configuration or authentication files.

The project `.env` currently defaults all three tiers to the local OpenAI-compatible endpoint `http://10.31.107.77:3000/v1`. Runtime settings may override each tier independently.

- Luna (`gpt-5.6-luna`): `RESEARCH_MODEL_SIMPLE`, `RESEARCH_MODEL_URL_SIMPLE`, `RESEARCH_MODEL_KEY_SIMPLE`, `RESEARCH_REASONING_SIMPLE`
- Terra (`gpt-5.6-terra`): `RESEARCH_MODEL_MEDIUM`, `RESEARCH_MODEL_URL_MEDIUM`, `RESEARCH_MODEL_KEY_MEDIUM`, `RESEARCH_REASONING_MEDIUM`
- Sol (`gpt-5.6-sol`): `RESEARCH_MODEL_COMPLEX`, `RESEARCH_MODEL_URL_COMPLEX`, `RESEARCH_MODEL_KEY_COMPLEX`, `RESEARCH_REASONING_COMPLEX`
- Shared request limit: `MODEL_REQUEST_TIMEOUT_SECONDS`

HTTPS endpoints are accepted. Plain HTTP is accepted only for loopback and RFC1918 private addresses, including local OpenAI-compatible services.

## Verification Evidence

The current local UI is a React + TypeScript component application with no native DOM/HTML implementation and was checked in a real browser. Desktop and mobile flows across the new-Idea composer, project overview, literature/material search, artifact gallery, model settings, project chat, and Mastra link were exercised; there is no horizontal overflow and no console error. The model-settings screenshot shows all three tiers, the configured `/v1` endpoint, reasoning effort, and only key status; no key material is displayed.

![Research OS overview](docs/assets/research-os-overview.jpg)

![Independent model settings](docs/assets/research-os-model-settings.jpg)

![Mastra workflow graph](docs/assets/research-os-mastra-workflow.jpg)

## Project Semantic Memory

Supermemory integration is partially implemented and remains disabled unless `SUPERMEMORY_ENABLED=true` or `SUPERMEMORY_API_KEY` is configured. Every operation is scoped by an immutable project container tag. The API provides status, ingestion, project-scoped hybrid search, Graph Memory context, link inspection, and approval-gated forget/delete operations. PDF and image ingestion is limited to validated project Artifacts or Defender-scanned uploads; the local Artifact keeps the original bytes and SHA-256.

Semantic results are candidates only and retain source, Artifact, locator, hash, and evidence-status metadata. A missing key, timeout, authentication failure, invalid response, or remote write failure returns a structured error and never falls back to local semantic search, another provider, or an unrelated experiment. Real Supermemory API validation, cross-project leakage testing with two configured projects, and end-to-end revoke/delete testing remain open in `TODO.md`.

## Experiment Isolation

The model never supplies a command, executable, path, URL, environment, or network target. An approved run selects a fixed experiment type and a project-owned entry point. Windows is the default backend and invokes the project interpreter through a fixed `cmd.exe` argument contract. WSL2 is optional and must be selected explicitly.

Each scientific Python project uses its own `.venv`; dependencies are never installed into the application runtime. The supervisor enforces a fixed project root, timeout, process-tree cancellation, bounded logs, finite numeric `metrics.json`, structured `checkpoint.json`, SHA-256 artifacts, and audit events. Native process isolation is weaker than a dedicated virtual machine and is documented as such.

## Repository Verification and Acquisition

The Literature tab accepts GitHub or GitLab HTTPS repository candidates linked to a paper. Verification records the provider metadata and citation files, requires a DOI or exact-title match, checks a known SPDX license, and pins the candidate to a 40-character commit. Download is never automatic: it creates a `dependency_install` Proposal and approval revalidates the snapshot before downloading.

The approved archive is bounded, checked for path traversal and link entries, stored as a SHA-256 Artifact, extracted beneath `projects/<project-id>/code/repositories/`, linked in the Artifact dependency ledger, and committed to the project Git workspace. These records document reproducible source acquisition; they do not by themselves prove that a repository is an official implementation or that its code is scientifically valid.

## Dependency Lineage and Checkpoint Recovery

Successful experiments register their Idea version, project Git commit, configuration fingerprint, referenced papers/evidence/repositories/uploads, generated Artifacts, and Checkpoint in a semantic dependency ledger. Project inspection reconciles upstream fingerprints; an approved Idea or code revision, a changed upstream record, a missing source, or an invalid Artifact recursively invalidates dependent experiments, Artifacts, and Checkpoints.

Checkpoint recovery is never a direct rerun. The API verifies the Checkpoint, source run status, current Idea version, Git baseline, Artifact paths, symlink status, file existence, and SHA-256 values, then creates an `experiment_rerun` Proposal. Only approval queues the exact recovered request; a failed or invalidated dependency returns a structured error and cannot be displayed as a successful run.

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npm run ops:status
npm run mastra:hitl:check
npm run acceptance
```

The code-level checks and real-model acceptance use the configured model and external academic APIs; model endpoint or key failures remain direct structured failures. Runtime checks pass against the verified recovery candidate; the original primary database still requires an explicit operator decision.

## Limitations

This is a local MVP, not a production security boundary or a scientific oracle. Metadata candidates are not full-text evidence. Page quotes still require claim-level review. Experiment outputs establish only what the experiment measured, not the truth of a research hypothesis. Native process controls do not provide virtual-machine isolation. GPU host validation, semantic claim mapping, and clean-machine installer acceptance remain open work. Repository acquisition is limited to the verified, approval-gated archive path described above.
