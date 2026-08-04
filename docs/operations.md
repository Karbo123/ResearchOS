# Operations

## Start and Stop

```bash
nvm install 26.5.1
nvm use 26.5.1
npm ci
npm run build
npm start
```

Run every command in this document inside the WSL2 shell (Ubuntu 22.04), which is the default development shell; do not use Windows cmd/PowerShell for development. The repository root is the single copy at `/mnt/d/ResearchOS` (the same filesystem as Windows `D:\ResearchOS`, so no sync step exists). Windows Chrome is the debugging browser and reaches WSL2 services at `http://127.0.0.1:<port>` through mirrored networking/port forwarding.

Use nvm inside WSL2 for the workspace runtime. The repository default is recorded in `.nvmrc` as Node.js 26.5.1; `package.json` keeps a compatibility lower bound of Node.js 22.13. Verify `nvm current` and `node --version` before a build. The workspace start commands load the project `.env` with Node's `--env-file` option. Do not rely on a manually inherited shell environment for model or runtime settings. Because `/mnt/d` (drvfs) has no inotify support, `tsx watch` will not notice file changes even when editing through WSL2; after changing `apps/*`, `scripts/`, or root config files, restart the affected service manually (kill the `npm run dev` tree and relaunch, see below). The old ext4 copy `~/ResearchOS` is kept only as a backup.

Native Windows hosting is not supported. The stack runs only inside WSL2; Windows is a browser client at `http://127.0.0.1:<port>`.

## Health and Capacity

```bash
npx tsx scripts/ops-guard.ts status
npx tsx scripts/ops-guard.ts capacity
```

The expected endpoints are `http://127.0.0.1:8080/api/health` and `http://127.0.0.1:4111/health`. Do not expose either listener beyond the local host.

For bounded unattended monitoring:

```bash
npm run ops:monitor -- once
npm run ops:monitor -- watch 3600
```

The monitor checks only the configured local API and Mastra health endpoints, records JSONL events under `runtime/ops/health-events.jsonl`, rotates the log at 5 MB, and exits non-zero when a health check or configured alert delivery fails. `RESEARCH_ALERT_WEBHOOK_URL` is optional; HTTP receivers must be loopback/private and HTTPS receivers must be explicitly configured. The monitor never substitutes a healthy result when a check fails.

Run a read-only recovery drill against the newest backup or an explicit compact timestamp backup ID:

```bash
npm run ops:recovery-drill
npm run ops:recovery-drill -- 20260730T200648Z
```

The drill validates the manifest hash, rejects traversal and link entries, extracts only into a temporary directory, checks `runtime/`, `projects/`, and `artifacts/`, then removes the temporary directory. It never overwrites live state and is not a virtual-machine isolation guarantee.

If startup raises `PGlite RuntimeError: Aborted()`, stop and preserve `runtime/research-os.pglite` and all backups. Do not delete the database or initialize an empty replacement as an automatic recovery. Validate a separate copy of a backup first; the retained PostgreSQL `pg_dump` requires an explicit, separately verified migration into PGlite and is not a drop-in restore.

## Backup and Restore Check

Stop Research OS before creating a backup so the embedded database snapshot is consistent.

```bash
npx tsx scripts/ops-guard.ts backup
npx tsx scripts/ops-guard.ts restore-check <14-digit-backup-id>
```

Backups are written to `artifacts/backups/<id>/` with a compressed archive and SHA-256 manifest. `restore-check` validates the archive without overwriting live data. Restoration is an explicit operator action: stop the app, preserve current directories, extract a verified archive into a separate location, inspect it, and then replace only the intended data directories.

For the retained PostgreSQL SQL dump, generate a separate PGlite candidate with `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731`. The command refuses an existing target, maps the legacy `mlflow_run_id` column to `run_id`, validates key row counts, and never changes `runtime/research-os.pglite`. After reviewing the candidate, set `RESEARCH_RUNTIME_DIR=runtime/restore-pglite-20260731` in `.env`; this explicit setting is the only supported runtime switch.

## Model Configuration

Use the lower-left settings button or edit project `.env`. The panel has three top-level tabs: `General` (appearance only), `Models` (project-scoped), and `System` (global proxy). Luna, Terra, and Sol are independent. A blank key in the Web form preserves the existing key. The settings API never returns key material. Project-scoped overrides (code tiers, document text, image recognition, image generation, Embedding, voice recognition) are stored in `runtime/project-settings.json` (mode 0600, atomic write, removed with the project); without an override the project falls back to `.env` defaults. The global proxy remains in `runtime/model-settings.json`.

The checked configuration template uses `http://127.0.0.1:3000/v1` as the Responses API base for all three model tiers (the model gateway runs on the Windows host and is reached from WSL2 through the mirrored loopback). Keep the `/v1` suffix and omit operation paths; Research OS appends `/responses` and rejects `/responses`, `/chat/completions`, and `/completions` values. Each tier can be overridden independently. The native Mastra process calls this endpoint directly through Responses. The Supermemory Local child is different: its current closed binary can emit Chat Completions requests for its memory agent, so Research OS starts a loopback-only bridge on `SUPERMEMORY_MODEL_BRIDGE_PORT` (default `3010`). Supermemory is pointed at the bridge's `/v1` base; the bridge validates the old request, inserts the required JSON instruction for structured output, converts it to Responses `input` plus `text.format.type=json_schema`, and converts only a valid Responses result back. The fixed gateway is never modified and receives no Chat Completions request. Disable the bridge only after independently verifying a Supermemory build that natively uses Responses.

Private HTTP endpoints are accepted; public remote endpoints require HTTPS. All Mastra model and guardrail calls use Responses with strict JSON Schema output where structured output is requested. A failed request is returned as a structured error and is not retried through another model or provider.

Model traffic also honors the **global proxy** setting in the `System` tab (persisted in `runtime/model-settings.json`). When enabled, Mastra model calls, the Supermemory model bridge, and Groq transcription all go through the configured HTTP(S) proxy; when disabled they connect directly, ignoring startup proxy environment variables. Loopback and RFC1918 model targets always stay direct so the local gateway and bridge are never proxied. The default is derived from `HTTPS_PROXY`/`HTTP_PROXY` (or their lowercase forms) at startup for compatibility.

## Voice Recognition

The chat voice input can use either the browser's Web Speech API or a Groq Whisper transcription endpoint (`RESEARCH_VOICE_PROVIDER=browser|groq`). `GROQ_API_KEY` from the project `.env` is the default key; the web UI can also override the Groq model, API URL, and key per project. Runtime-provided keys are stored in `runtime/project-settings.json` (mode 0600) and never returned by the settings API, which only reports `key_configured`. Leaving the key blank in the UI keeps the existing key. When the browser engine is selected the UI does not ask for a Groq model, API URL, or key; those fields appear only for the Groq engine. Groq transcription follows the global proxy setting described above, which is required on networks where `api.groq.com` is not directly reachable.

## Related Work Operations

The Literature page and API keep related-work metadata inside the active project. `POST /api/projects/<project-id>/related-work/seeds` accepts one strict seed variant: DOI, title, HTTPS URL, BibTeX, a project-owned valid PDF Artifact, or an existing project Paper. Provider search attempts are recorded even when a provider times out, is rate-limited, returns invalid data, or produces no candidates. A metadata candidate is not inserted into the confirmed `papers` table and is not full-text evidence.

Create a recursive citation Proposal with `POST /api/projects/<project-id>/related-work/recursive-plan` and explicit `seed_ids`, `depth`, `width`, `max_total`, `providers`, and `reason`. Approval creates a queued `related_work_recursive` run. Inspect it with `GET /api/projects/<project-id>/related-work/runs/<run-id>`, explicitly execute a queued approved run with `POST .../execute`, or cancel it with `POST .../cancel`. Runs persist provider attempts, progress events, ranking reasons, first-discovery depth, and only non-dangling project-scoped citation edges. A partial provider result is shown as `partial`; it is never treated as a complete provider success.

Provider search and reference responses are cached in `related_work_request_cache` with `RESEARCH_RELATED_WORK_CACHE_TTL_SECONDS` (default `86400`). The cache is keyed by project, provider, operation, canonical request parameters, and schema version. It stores the real request URL, parameters, response, status, expiry, and hit count. A cache hit is valid only for the same project and an unexpired compatible row. Inspect `audit_events` for `related_work.cache_miss`, `related_work.cache_hit`, `related_work.cache_write`, `related_work.cache_invalid`, or `related_work.cache_write_skipped`; a skipped failure means an existing successful cache row was retained. On process restart, an interrupted related-work run in `running` state is returned to `queued` with `native_process_restarted`; startup resumes queued runs, while `partial` runs remain partial for review. No cache entry or restart path changes a provider failure into success.

The Research Status page consumes only confirmed Papers, located Evidence, and accepted ClaimReviews for its ready matrix. Its citation graph is an interactive layered SVG projection of stored relations: select a node to inspect source, stable ID, locator, evidence state, and project permission; do not infer a scientific relationship from visual proximity. Desktop inspection has passed. On 2026-08-02, the real browser check also verified the empty graph, project scope, keyboard node selection, narrow-screen horizontal graph scrolling without body overflow, and clearing the selected node when switching projects. The browser screenshot endpoint produced a device-scale tiling artifact, so it is not counted as visual screenshot evidence; loading/error/partial fixtures and a graph containing multiple real relation types remain open acceptance work.

After a reproduction run, do not copy its numbers into the method or paper. A future comparison operation must bind the paper Evidence, fixed repository commit, data/configuration/seed, raw metrics, logs, and output Artifact hashes, then let TypeScript calculate the difference. Mastra may produce a reviewable candidate and next-experiment Proposal from that comparison; user approval is required before it is used by method design or writing.

## Report Lineage Operations

New daily, weekly, and manual reports save a `source_snapshot` with the active project ID and the source IDs used for the deterministic summary. On every project read, the API checks that each Paper, Evidence, Experiment, Proposal, and valid Artifact still exists under that project. An empty snapshot from a pre-lineage row is reported as `legacy_unverified`; a scope mismatch, cross-project ID, deleted source, or invalid Artifact is reported as `blocked`, and the UI does not render that report's Markdown. Regenerate the report after restoring or replacing its upstream sources. This check does not promote metadata to evidence or experiment output to a scientific conclusion.

## Supermemory Operations

Supermemory Local is the default project-scoped semantic memory service. Point `SUPERMEMORY_SERVER_BIN` at the official self-hosted executable and start it with:

```bash
npm run supermemory:start
npm run supermemory:stop
```

`start` launches the loopback-only model bridge first, then launches the binary hidden with the bridge's operation-free `/v1` base and the configured model key (LLM extraction needs `RESEARCH_MODEL_URL_MEDIUM`, `RESEARCH_MODEL_MEDIUM`, and `RESEARCH_MODEL_KEY_MEDIUM`), writes logs under `runtime/supermemory.out.log`, `runtime/supermemory.err.log`, and `runtime/supermemory-model-bridge.*.log`, records pids, and waits for the `http://127.0.0.1:6767` health endpoint. The launcher rejects old operation URLs before spawning either process. The bridge has no fallback answer: invalid Chat input, an upstream failure, a timeout, or an invalid Responses result is returned as a structured error. `stop` terminates the recorded Supermemory and bridge processes. The service can also be managed externally; when an externally managed child is used, it must be configured to send its model requests to the same bridge or be independently verified to use Responses. The environment template leaves `SUPERMEMORY_SERVER_BIN` empty in that case. Supermemory Local can automatically authenticate unauthenticated loopback requests. An explicit `SUPERMEMORY_API_KEY` is still supported and is required for non-loopback addresses. The API never returns the key to the browser. Each project maps to a deterministic container tag; do not use a global container or copy one project's memory into another project.

Embedding configuration follows the official `SUPERMEMORY_EMBEDDING_PROVIDER` / `SUPERMEMORY_EMBEDDING_MODEL` / `SUPERMEMORY_EMBEDDING_DIMENSIONS` / `SUPERMEMORY_EMBEDDING_BASE_URL` variables plus a project-reserved `SUPERMEMORY_EMBEDDING_API_KEY` slot. The project default is the multilingual local ONNX model `Xenova/bge-m3` at 1024 dimensions (bundled in the server-v0.0.5 binary used by the WSL2 runtime copy); the older `0.0.7-rc.2` build only ships `Xenova/bge-base-en-v1.5` (768 dimensions, English-only) and does not read remote provider settings. Verified on 2026-08-01 with an isolated instance and a fresh data directory: even when the embedding variables are passed as process environment (`provider=openai`, `model=Qwen3-Embedding-8B`, `dimensions=1024`, base URL pointed at a local stub), the rc.2 binary still boots its local ONNX worker and never calls the remote endpoint. The OpenAI-compatible embedding API itself is reachable and returns 1024-dimension vectors with the configured key; the only missing piece for remote embedding is a server build that reads the variables (server-v0.0.5 does). If `SUPERMEMORY_EMBEDDING_PROVIDER` is set to `openai` or `gemini` while the installed build lacks support, memory requests return a structured `supermemory_embedding_unsupported` error instead of silently downgrading to local embeddings. Changing model or dimensions requires a fresh data directory or full re-ingestion; mixing 768-dim and 1024-dim vectors is not supported.

### Embedding configuration pools

Embedding configuration is per-project. A project without an override uses the global default instance (`SUPERMEMORY_BASE_URL`, normally `127.0.0.1:6767`) with the global `.env` embedding variables. A project with an explicit override (`GET/PUT /api/projects/<project-id>/embedding-settings`) is served by a **configuration pool**: projects whose provider/model/dimensions/base URL/key are exactly identical share one Supermemory instance (port allocated from 6770–6869) and one encrypted data directory under `runtime/supermemory/pools/<pool-key>/data`, so one configuration is never multiplied into one instance per project. Isolation between projects in the same pool is enforced by immutable Supermemory container tags (`research-os-project-<projectId>`), verified end to end on 2026-08-01: a memory ingested under one project is not returned by another project sharing the same pool. Different configurations get different pools, so projects can still use different providers/models/dimensions without vector-space contamination. Overrides are stored in `runtime/project-embedding-settings.json` (mode 0600, atomic write, same pattern as `model-settings.json`); the pool registry is `runtime/embedding-pools.json`; the API never returns the key, only `key_configured`. A pool instance is started lazily on first memory request and health-checked before use; the binary must be `server-v0.0.5` when a remote provider is configured, otherwise startup fails closed. Switching provider/model/dimensions requires a fresh data directory: the API refuses with `embedding_requires_reset` (409) unless the caller confirms `reset_data: true`, in which case the old data directory is renamed to `<data>.bak-<timestamp>` (recoverable) and the project's semantic memory must be re-ingested. Pool child processes never inherit stale `HTTP_PROXY`/`HTTPS_PROXY` variables from the host shell (a dead WSL NAT proxy IP breaks remote embedding and HuggingFace model downloads); set `SUPERMEMORY_PROXY_URL` explicitly when a proxy is required. Benchmark on 2026-08-01 (same query, same corpus, isolated instances): local `Xenova/bge-m3` 1024d embeds a short text in 30–72ms with a full search at 58–159ms; remote `Qwen3-Embedding-8B` (gitee) embeds in ~120–210ms with a full search at 286–653ms; the global default remains local bge-m3. End-to-end verification through the public API on the same day: two projects with identical local configuration share pool port 6770 (`shared_projects: 2`) while a remote-configuration project uses its own pool port 6771; ingest → search round-trips succeed on both pools.

The available endpoints are `/api/projects/<project-id>/memory/status`, `/memory/ingest`, `/memory/search`, `/memory/graph`, and `/memory/links`. Ingestion accepts bounded text or a project-owned PDF/image Artifact or scanned upload. Links are idempotent by project, source, and content SHA-256. Forget/delete requests create a `memory_revoke` Proposal and perform the remote mutation only after approval.

Scanned uploaded materials are dispatched through the durable `material_index` task. PDFs are bounded to the implementation limits and extracted into overlapping text chunks; text files use the same bounded chunk contract; images and non-extractable PDFs use the controlled document upload path. Query `/api/projects/<project-id>/materials/search` for project-scoped Supermemory hybrid results. It returns 503 when Supermemory is not configured or the remote request fails, and never falls back to local metadata keyword search.

If the local server is unavailable, authentication fails, the response is invalid, or the operation times out, the API returns a structured error. It does not use SQL keyword search, another provider, or silently continue. Keep the local `memory_links` ledger for replay, source tracing, failure inspection, and deletion audit.

Run `npm run supermemory:acceptance` (with the Supermemory Local server running) for real-provider verification. The script isolates a temporary database under `runtime/acceptance-supermemory`, pre-cleans any previous acceptance containers, then verifies text ingestion and searchability, two-project isolation, Graph Memory nodes, Super RAG document results, LLM-backed `forget` revocation (remote memory entities disappear), and delete revocation confirmed by remote absence; evidence is written to `artifacts/acceptance/supermemory-local-*.json`. The run honestly reports `partial` (exit 1) while two external blockers remain: PDF terminal processing requires a Gemini/Vertex key (PDF extraction falls back from Mistral OCR to Gemini and stays at `extracting` without one), and image ingestion requires the same Gemini/Vertex key that the bundled `0.0.7-rc.2` Windows build cannot process without crashing. An isolated retest on 2026-08-01 confirmed that configuring `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` with a working OpenAI-compatible endpoint does not change PDF extraction: the extractor still hardcodes Mistral OCR → Gemini 2.5 Flash and crashes on the Gemini 403, so a valid Gemini/Vertex key (or a future stable build) is the unblock condition. The same applies to images even with a multimodal OpenAI-compatible backend: verified on the user's running `0.0.7-rc.2` instance (wizard-configured `gpt-5.6-luna`), where a PNG upload crashed with `Failed to generate image description` / `provider: "gemini"` / `ModelUpstreamError`. The `gpt-5.6` endpoint itself accepts image input (returned 200 with a correct description), but the binary's image-description step is hardcoded to the Gemini provider. No local fallback or fake pass is used for any blocked step.

## Scientific Environments

The first approved Python run creates `projects/<id>/.venv` with `RESEARCH_PYTHON_EXECUTABLE` (default `python3`). Dependency installation is a separate, approval-gated operator action; the model cannot provide package commands. A project `.venv` is created and used only by the Linux runtime.

WSL2 hosting (2026-08-01, fully implemented and verified): development runs entirely inside the WSL2 shell at `/mnt/d/ResearchOS`. With `networkingMode=mirrored` in `.wslconfig`, Windows Chrome reaches WSL2 services through port forwarding at `http://127.0.0.1:<port>` even when the service binds only loopback inside WSL2, and WSL2 reaches Windows-host services through `127.0.0.1` (use `http://127.0.0.1:3000/v1`, not the shared LAN IP, for the model gateway). The runtime pins the official Supermemory `server-v0.0.5` linux-x64 binary (patched; downloaded into the WSL2 home as `~/bin/supermemory-server-linux-x64`); the global instance runs with a local bge-m3 data directory (`SUPERMEMORY_DATA_DIR=/home/karbo/bin/.supermemory.bge-m3-1024`, remote-vector directory from before the switch is preserved as `.supermemory.remote-qwen3-1024.bak-20260801`). The upload malware gate reaches Windows Defender through the interop mount, the experiment supervisor has a native Linux execution path (`python3 -m venv`, `.venv/bin/python`, `latexmk`, SIGKILL process-tree cancellation) as the default backend, and the repository is the single shared copy at `/mnt/d/ResearchOS` (= `D:\ResearchOS`). The full application stack — API `8080`, Mastra `4111`, Supermemory `6767` (plus embedding configuration-pool instances on 6770–6869) — runs inside WSL2 and is reachable from Windows Chrome at `http://127.0.0.1:<port>`.

Install a TeX distribution separately when `compile_latex` is needed. Missing `latexmk` produces a structured experiment failure. The default paper draft uses the self-contained CVPR-style template stored as `projects/<id>/paper/cvpr.sty`; approving a paper `code_patch` automatically queues the compile, and the paper workspace polls queued/running runs until the PDF or error is available.

## Repository Verification and Acquisition

From the Related Work Implementation page (under Experiment Implementation), use “find code links in the paper” first when possible. `GET /api/projects/<project-id>/papers/<paper-id>/repositories/discover` only extracts explicit GitHub/GitLab URLs already present in the Paper metadata or source URL; it never guesses a repository from a title. A user may also add a GitHub or GitLab HTTPS candidate explicitly. Verify it before requesting download. Verification records provider metadata, repository citation files, DOI or exact-title match, SPDX license status, default branch, fixed 40-character commit, and independent readiness checks for entrypoint, dependency manifest/install instructions, data acquisition, system/GPU requirements, and the project-contained write directory. Unknown readiness remains a candidate and fails the download gate.

Downloading is always a `repository_download` Proposal. Approval revalidates the provider snapshot and fixed commit, downloads the archive, enforces archive size/entry/uncompressed-size limits, rejects traversal and link entries, stores the archive as a SHA-256 source Artifact, and extracts it below `projects/<id>/experiment/reproductions/<reproduction-id>/source`; it does not modify the method Git workspace. The dependency endpoint creates a separate `repository_dependency_install` Proposal, validates a project-local `requirements*.txt`, and installs it into `projects/<id>/experiment/reproductions/<reproduction-id>/.venv` with `python3 -m venv` and fixed pip arguments. The run endpoint creates `repository_reproduction_run`; its worker validates the unchanged source fingerprint, copies source to a bounded run workspace, runs only the fixed `.venv/bin/python` entrypoint with `RESEARCH_OS_*` seed/plan/output variables, and requires per-seed `metrics.json` and `checkpoint.json`. Success creates a `repository_artifact_write` Proposal; approval rechecks every output hash before copying it into `projects/<project-id>/artifacts/reproduction-runs/<run-id>/`. Failed operations return structured errors and do not create result Artifacts.

## Dependency Lineage and Checkpoint Recovery

After a successful experiment, the server records dependency edges for the Idea version, Git commit, configuration fingerprint, referenced evidence and repositories, generated Artifacts, and Checkpoint. Project detail and recovery reconcile upstream fingerprints. Approved Idea/code changes or missing or changed upstream records recursively invalidate downstream runs, Artifacts, and Checkpoints.

To request recovery, use the project Checkpoint rerun endpoint. It verifies the source run, current Idea/Git baseline, valid Artifact records, bounded paths, non-symlink files, and current SHA-256 values before creating an `experiment_rerun` Proposal. Approval queues the recovered run; operators must not submit that Proposal through the ordinary experiment endpoint. Invalid or changed dependencies produce a structured conflict and no run is queued.

## Upgrade

Stop the current process, back up data, install the new source, run `npm ci`, `npm run build`, and `npm run db:migrate`, then restart. Never delete `projects/`, `artifacts/`, `.env`, or `runtime/` during an in-place upgrade.
