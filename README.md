<!-- DOCS_SYNC_VERSION: 2026-07-31-04 -->

# Research OS

[简体中文](README.zh-CN.md)

Research OS is a local, auditable research-automation MVP. The application is implemented in TypeScript with Mastra Agents and Workflows. Scientific experiment workspaces may use any language; a scientific Python project receives its own `.venv`.

## Status

The native Windows migration is implemented and verified for the local MVP. The TypeScript API, embedded PostgreSQL-compatible state store, Mastra integration, persistent workflow queue, Web UI, approval gates, local experiment supervisor, artifact ledger, Windows Defender upload gate, and Windows installer source are implemented. The verified acceptance covers real model calls, project state transitions, native scientific execution, cancellation, Mastra Studio, and the browser UI. Clean-machine installer signing/release and GPU-host validation remain separate open work.

Model failures are final structured errors. The application never substitutes a local reply, another provider, or an unrelated experiment.

## Architecture

- `apps/server`: Hono API, PGlite state, queue, evidence, approvals, reports, repository verification/acquisition, artifact ledger, and native experiment supervisor.
- `apps/mastra`: Mastra Agents, Memory, Skills, bounded Tools, Workflows, schedules, and Studio graph.
- `apps/web`: TypeScript browser source and generated static assets.
- `projects/<project-id>`: isolated Git workspaces. Scientific Python uses `projects/<project-id>/.venv`.
- `artifacts`: controlled uploads, evidence PDFs, experiment outputs, acceptance results, and backups.
- `runtime`: ignored local application state, model overrides, Mastra memory, logs, and PID data.

PGlite is the durable business state source. Mastra Memory is local and does not replace project, approval, artifact, or audit state.

## Requirements

- Windows 10/11 x64
- Node.js 22.13 or newer, with Node.js 22.22 LTS used by the installer
- Git for Windows
- Windows Defender for uploads
- Optional: Python 3.11+ for scientific Python experiments
- Optional: WSL2 as an explicitly selected experiment backend
- Optional: a TeX distribution providing `latexmk.exe`

## Quick Start

```powershell
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Mastra Studio and workflow graphs are available at [http://127.0.0.1:4111](http://127.0.0.1:4111) and from the lower-left navigation.

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

The current local UI and Mastra graph were checked in a real browser. The model-settings screenshot shows all three tiers, the configured `/v1` endpoint, reasoning effort, and only key status; no key material is displayed.

![Research OS overview](docs/assets/research-os-overview.jpg)

![Independent model settings](docs/assets/research-os-model-settings.jpg)

![Mastra workflow graph](docs/assets/research-os-mastra-workflow.jpg)

## Experiment Isolation

The model never supplies a command, executable, path, URL, environment, or network target. An approved run selects a fixed experiment type and a project-owned entry point. Windows is the default backend and invokes the project interpreter through a fixed `cmd.exe` argument contract. WSL2 is optional and must be selected explicitly.

Each scientific Python project uses its own `.venv`; dependencies are never installed into the application runtime. The supervisor enforces a fixed project root, timeout, process-tree cancellation, bounded logs, finite numeric `metrics.json`, structured `checkpoint.json`, SHA-256 artifacts, and audit events. Native process isolation is weaker than a dedicated virtual machine and is documented as such.

## Repository Verification and Acquisition

The Literature tab accepts GitHub or GitLab HTTPS repository candidates linked to a paper. Verification records the provider metadata and citation files, requires a DOI or exact-title match, checks a known SPDX license, and pins the candidate to a 40-character commit. Download is never automatic: it creates a `dependency_install` Proposal and approval revalidates the snapshot before downloading.

The approved archive is bounded, checked for path traversal and link entries, stored as a SHA-256 Artifact, extracted beneath `projects/<project-id>/code/repositories/`, linked in the Artifact dependency ledger, and committed to the project Git workspace. These records document reproducible source acquisition; they do not by themselves prove that a repository is an official implementation or that its code is scientifically valid.

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run idea-cases:check
npm run docs:check
npm run ops:status
npm run acceptance
```

The final acceptance command uses the configured real model and external academic APIs. It must fail directly when the model endpoint or key is invalid.

## Limitations

This is a local MVP, not a production security boundary or a scientific oracle. Metadata candidates are not full-text evidence. Page quotes still require claim-level review. Experiment outputs establish only what the experiment measured, not the truth of a research hypothesis. Native process controls do not provide virtual-machine isolation. GPU host validation, semantic claim mapping, and clean-machine installer acceptance remain open work. Repository acquisition is limited to the verified, approval-gated archive path described above.
