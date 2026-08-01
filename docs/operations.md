# Operations

## Start and Stop

```powershell
nvm install 26.5.1
nvm use 26.5.1
npm ci
npm run build
npm start
```

Use nvm inside WSL2 (Ubuntu 22.04) for the workspace runtime. The repository default is recorded in `.nvmrc` as Node.js 26.5.1; `package.json` keeps a compatibility lower bound of Node.js 22.13. Verify `nvm current` and `node --version` before a build. The workspace start commands load the project `.env` with Node's `--env-file` option. Do not rely on a manually inherited shell environment for model or runtime settings. There is exactly **one** repository copy: `D:\ResearchOS` on Windows is the same filesystem as `/mnt/d/ResearchOS` inside WSL2, and all services run from that copy — no sync step exists. Because `/mnt/d` (drvfs) has no inotify support, `tsx watch` will not notice edits made on the Windows side; after changing `apps/*`, `scripts/`, or root config files, restart the affected service manually (kill the `npm run dev` tree and relaunch, see below). The old ext4 copy `~/ResearchOS` is kept only as a backup.

The Windows installer uses `installer/windows/bootstrap.ps1`, stores the parent PID in `runtime/research-os.pid`, and writes stdout/stderr logs under `runtime/`. Its `-Stop` mode terminates only that recorded process tree.

## Health and Capacity

```powershell
npx tsx scripts/ops-guard.ts status
npx tsx scripts/ops-guard.ts capacity
```

The expected endpoints are `http://127.0.0.1:8080/api/health` and `http://127.0.0.1:4111/health`. Do not expose either listener beyond the local host.

For bounded unattended monitoring:

```powershell
npm run ops:monitor -- once
npm run ops:monitor -- watch 3600
```

The monitor checks only the configured local API and Mastra health endpoints, records JSONL events under `runtime/ops/health-events.jsonl`, rotates the log at 5 MB, and exits non-zero when a health check or configured alert delivery fails. `RESEARCH_ALERT_WEBHOOK_URL` is optional; HTTP receivers must be loopback/private and HTTPS receivers must be explicitly configured. The monitor never substitutes a healthy result when a check fails.

Run a read-only recovery drill against the newest backup or an explicit compact timestamp backup ID:

```powershell
npm run ops:recovery-drill
npm run ops:recovery-drill -- 20260730T200648Z
```

The drill validates the manifest hash, rejects traversal and link entries, extracts only into a temporary directory, checks `runtime/`, `projects/`, and `artifacts/`, then removes the temporary directory. It never overwrites live state and is not a virtual-machine isolation guarantee.

If startup raises `PGlite RuntimeError: Aborted()`, stop and preserve `runtime/research-os.pglite` and all backups. Do not delete the database or initialize an empty replacement as an automatic recovery. Validate a separate copy of a backup first; the retained PostgreSQL `pg_dump` requires an explicit, separately verified migration into PGlite and is not a drop-in restore.

## Backup and Restore Check

Stop Research OS before creating a backup so the embedded database snapshot is consistent.

```powershell
npx tsx scripts/ops-guard.ts backup
npx tsx scripts/ops-guard.ts restore-check <14-digit-backup-id>
```

Backups are written to `artifacts/backups/<id>/` with a compressed archive and SHA-256 manifest. `restore-check` validates the archive without overwriting live data. Restoration is an explicit operator action: stop the app, preserve current directories, extract a verified archive into a separate location, inspect it, and then replace only the intended data directories.

For the retained PostgreSQL SQL dump, generate a separate PGlite candidate with `npm run db:restore-dump -- artifacts/backups/20260730T200648Z/postgres.sql runtime/restore-pglite-20260731`. The command refuses an existing target, maps the legacy `mlflow_run_id` column to `run_id`, validates key row counts, and never changes `runtime/research-os.pglite`. After reviewing the candidate, set `RESEARCH_RUNTIME_DIR=runtime/restore-pglite-20260731` in `.env`; this explicit setting is the only supported runtime switch.

## Model Configuration

Use the lower-left settings button or edit project `.env`. Luna, Terra, and Sol are independent. A blank key in the Web form preserves the existing key. The settings API never returns key material.

The checked configuration template uses `http://127.0.0.1:3000/v1` for all three default model URLs (the model gateway runs on the Windows host and is reached from WSL2 through the mirrored loopback). Keep the `/v1` suffix; each tier can be overridden independently.

Private HTTP endpoints are accepted; public remote endpoints require HTTPS. A failed request is not retried through another model or provider.

## Supermemory Operations

Supermemory Local is the default project-scoped semantic memory service. Point `SUPERMEMORY_SERVER_BIN` at the official self-hosted executable and start it with:

```powershell
npm run supermemory:start
npm run supermemory:stop
```

`start` launches the binary hidden, feeds it the configured model endpoint and key from `.env` (LLM extraction needs `RESEARCH_MODEL_URL_MEDIUM`, `RESEARCH_MODEL_MEDIUM`, and `RESEARCH_MODEL_KEY_MEDIUM`), writes logs under `runtime/supermemory.out.log` and `runtime/supermemory.err.log`, records the pid in `runtime/supermemory.pid`, and waits for the `http://127.0.0.1:6767` health endpoint. `stop` terminates the recorded process. The service can also be managed externally; the environment template leaves `SUPERMEMORY_SERVER_BIN` empty in that case. Supermemory Local can automatically authenticate unauthenticated loopback requests. An explicit `SUPERMEMORY_API_KEY` is still supported and is required for non-loopback addresses. The API never returns the key to the browser. Each project maps to a deterministic container tag; do not use a global container or copy one project's memory into another project.

Embedding configuration follows the official `SUPERMEMORY_EMBEDDING_PROVIDER` / `SUPERMEMORY_EMBEDDING_MODEL` / `SUPERMEMORY_EMBEDDING_DIMENSIONS` / `SUPERMEMORY_EMBEDDING_BASE_URL` variables plus a project-reserved `SUPERMEMORY_EMBEDDING_API_KEY` slot. The project default is the multilingual local ONNX model `Xenova/bge-m3` at 1024 dimensions (bundled in the server-v0.0.5 binary used by the WSL2 runtime copy); the older `0.0.7-rc.2` build only ships `Xenova/bge-base-en-v1.5` (768 dimensions, English-only) and does not read remote provider settings. Verified on 2026-08-01 with an isolated instance and a fresh data directory: even when the embedding variables are passed as process environment (`provider=openai`, `model=Qwen3-Embedding-8B`, `dimensions=1024`, base URL pointed at a local stub), the rc.2 binary still boots its local ONNX worker and never calls the remote endpoint. The OpenAI-compatible embedding API itself is reachable and returns 1024-dimension vectors with the configured key; the only missing piece for remote embedding is a server build that reads the variables (server-v0.0.5 does). If `SUPERMEMORY_EMBEDDING_PROVIDER` is set to `openai` or `gemini` while the installed build lacks support, memory requests return a structured `supermemory_embedding_unsupported` error instead of silently downgrading to local embeddings. Changing model or dimensions requires a fresh data directory or full re-ingestion; mixing 768-dim and 1024-dim vectors is not supported.

### Embedding configuration pools

Embedding configuration is per-project. A project without an override uses the global default instance (`SUPERMEMORY_BASE_URL`, normally `127.0.0.1:6767`) with the global `.env` embedding variables. A project with an explicit override (`GET/PUT /api/projects/<project-id>/embedding-settings`) is served by a **configuration pool**: projects whose provider/model/dimensions/base URL/key are exactly identical share one Supermemory instance (port allocated from 6770–6869) and one encrypted data directory under `runtime/supermemory/pools/<pool-key>/data`, so one configuration is never multiplied into one instance per project. Isolation between projects in the same pool is enforced by immutable Supermemory container tags (`research-os-project-<projectId>`), verified end to end on 2026-08-01: a memory ingested under one project is not returned by another project sharing the same pool. Different configurations get different pools, so projects can still use different providers/models/dimensions without vector-space contamination. Overrides are stored in `runtime/project-embedding-settings.json` (mode 0600, atomic write, same pattern as `model-settings.json`); the pool registry is `runtime/embedding-pools.json`; the API never returns the key, only `key_configured`. A pool instance is started lazily on first memory request and health-checked before use; the binary must be `server-v0.0.5` when a remote provider is configured, otherwise startup fails closed. Switching provider/model/dimensions requires a fresh data directory: the API refuses with `embedding_requires_reset` (409) unless the caller confirms `reset_data: true`, in which case the old data directory is renamed to `<data>.bak-<timestamp>` (recoverable) and the project's semantic memory must be re-ingested. Pool child processes never inherit stale `HTTP_PROXY`/`HTTPS_PROXY` variables from the host shell (a dead WSL NAT proxy IP breaks remote embedding and HuggingFace model downloads); set `SUPERMEMORY_PROXY_URL` explicitly when a proxy is required. Benchmark on 2026-08-01 (same query, same corpus, isolated instances): local `Xenova/bge-m3` 1024d embeds a short text in 30–72ms with a full search at 58–159ms; remote `Qwen3-Embedding-8B` (gitee) embeds in ~120–210ms with a full search at 286–653ms; the global default remains local bge-m3. End-to-end verification through the public API on the same day: two projects with identical local configuration share pool port 6770 (`shared_projects: 2`) while a remote-configuration project uses its own pool port 6771; ingest → search round-trips succeed on both pools.

The available endpoints are `/api/projects/<project-id>/memory/status`, `/memory/ingest`, `/memory/search`, `/memory/graph`, and `/memory/links`. Ingestion accepts bounded text or a project-owned PDF/image Artifact or scanned upload. Links are idempotent by project, source, and content SHA-256. Forget/delete requests create a `memory_revoke` Proposal and perform the remote mutation only after approval.

Scanned uploaded materials are dispatched through the durable `material_index` task. PDFs are bounded to the implementation limits and extracted into overlapping text chunks; text files use the same bounded chunk contract; images and non-extractable PDFs use the controlled document upload path. Query `/api/projects/<project-id>/materials/search` for project-scoped Supermemory hybrid results. It returns 503 when Supermemory is not configured or the remote request fails, and never falls back to local metadata keyword search.

If the local server is unavailable, authentication fails, the response is invalid, or the operation times out, the API returns a structured error. It does not use SQL keyword search, another provider, or silently continue. Keep the local `memory_links` ledger for replay, source tracing, failure inspection, and deletion audit.

Run `npm run supermemory:acceptance` (with the Supermemory Local server running) for real-provider verification. The script isolates a temporary database under `runtime/acceptance-supermemory`, pre-cleans any previous acceptance containers, then verifies text ingestion and searchability, two-project isolation, Graph Memory nodes, Super RAG document results, LLM-backed `forget` revocation (remote memory entities disappear), and delete revocation confirmed by remote absence; evidence is written to `artifacts/acceptance/supermemory-local-*.json`. The run honestly reports `partial` (exit 1) while two external blockers remain: PDF terminal processing requires a Gemini/Vertex key (PDF extraction falls back from Mistral OCR to Gemini and stays at `extracting` without one), and image ingestion requires the same Gemini/Vertex key that the bundled `0.0.7-rc.2` Windows build cannot process without crashing. An isolated retest on 2026-08-01 confirmed that configuring `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` with a working OpenAI-compatible endpoint does not change PDF extraction: the extractor still hardcodes Mistral OCR → Gemini 2.5 Flash and crashes on the Gemini 403, so a valid Gemini/Vertex key (or a future stable build) is the unblock condition. The same applies to images even with a multimodal OpenAI-compatible backend: verified on the user's running `0.0.7-rc.2` instance (wizard-configured `gpt-5.6-luna`), where a PNG upload crashed with `Failed to generate image description` / `provider: "gemini"` / `ModelUpstreamError`. The `gpt-5.6` endpoint itself accepts image input (returned 200 with a correct description), but the binary's image-description step is hardcoded to the Gemini provider. No local fallback or fake pass is used for any blocked step.

## Scientific Environments

The first approved Python run creates `projects/<id>/.venv` with `RESEARCH_PYTHON_EXECUTABLE` (default `python3` on Linux). Dependency installation is a separate, approval-gated operator action; the model cannot provide package commands. A Linux-created environment must not be reused by a Windows-created run and vice versa.

WSL2 hosting (2026-08-01, fully implemented and verified): with `networkingMode=mirrored` in `.wslconfig`, Windows browsers reach WSL2 services through `http://127.0.0.1:<port>` even when the service binds only loopback inside WSL2, and WSL2 reaches Windows-host services through `127.0.0.1` (use `http://127.0.0.1:3000/v1`, not the shared LAN IP, for the model gateway). The runtime pins the official Supermemory `server-v0.0.5` linux-x64 binary (patched; downloaded into the WSL2 home as `~/bin/supermemory-server-linux-x64`); the global instance runs with a local bge-m3 data directory (`SUPERMEMORY_DATA_DIR=/home/karbo/bin/.supermemory.bge-m3-1024`, remote-vector directory from before the switch is preserved as `.supermemory.remote-qwen3-1024.bak-20260801`). The upload malware gate reaches Windows Defender through the interop mount, the experiment supervisor has a native Linux execution path (`python3 -m venv`, `.venv/bin/python`, `latexmk`, SIGKILL process-tree cancellation) as the default backend, and the repository is the single shared copy at `/mnt/d/ResearchOS` (= `D:\ResearchOS`). The full application stack — API `8080`, Mastra `4111`, Supermemory `6767` (plus embedding configuration-pool instances on 6770–6869) — runs inside WSL2 and is reachable from the Windows browser at `http://127.0.0.1:<port>`.

Install a TeX distribution separately when `compile_latex` is needed. Missing `latexmk.exe` produces a structured experiment failure.

## Repository Verification and Acquisition

From a project Literature tab, add a GitHub or GitLab HTTPS repository candidate to a paper. Verify it before requesting download. Verification records the provider metadata, repository citation files, DOI or exact-title match, SPDX license status, default branch, and fixed 40-character commit.

Downloading is always a `dependency_install` Proposal. Approval revalidates the provider snapshot and commit, downloads the fixed archive, enforces archive size/entry/uncompressed-size limits, rejects traversal and link entries, stores the archive as a SHA-256 Artifact, extracts it below `projects/<id>/code/repositories/`, records the Artifact dependency, and commits only that repository path with fixed local Git identity. Failed operations return structured errors and remove temporary files.

## Dependency Lineage and Checkpoint Recovery

After a successful experiment, the server records dependency edges for the Idea version, Git commit, configuration fingerprint, referenced evidence and repositories, generated Artifacts, and Checkpoint. Project detail and recovery reconcile upstream fingerprints. Approved Idea/code changes or missing or changed upstream records recursively invalidate downstream runs, Artifacts, and Checkpoints.

To request recovery, use the project Checkpoint rerun endpoint. It verifies the source run, current Idea/Git baseline, valid Artifact records, bounded paths, non-symlink files, and current SHA-256 values before creating an `experiment_rerun` Proposal. Approval queues the recovered run; operators must not submit that Proposal through the ordinary experiment endpoint. Invalid or changed dependencies produce a structured conflict and no run is queued.

## Upgrade

Stop the current process, back up data, install the new source, run `npm ci`, `npm run build`, and `npm run db:migrate`, then restart. Never delete `projects/`, `artifacts/`, `.env`, or `runtime/` during an in-place upgrade.
