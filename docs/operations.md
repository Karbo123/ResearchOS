# Operations

## Start and Stop

```powershell
nvm install 26.5.1
nvm use 26.5.1
npm ci
npm run build
npm start
```

Use NVM for Windows for the workspace runtime. The repository default is recorded in `.nvmrc` as Node.js 26.5.1; `package.json` keeps a compatibility lower bound of Node.js 22.13. Verify `nvm current` and `node --version` before a build. The workspace start commands load the project `.env` with Node's `--env-file` option. Do not rely on a manually inherited shell environment for model or runtime settings.

The Windows installer uses `installer/windows/bootstrap.ps1`, stores the parent PID in `runtime/research-os.pid`, and writes stdout/stderr logs under `runtime/`. Its `-Stop` mode terminates only that recorded process tree.

## Health and Capacity

```powershell
npx tsx scripts/ops-guard.ts status
npx tsx scripts/ops-guard.ts capacity
```

The expected endpoints are `http://127.0.0.1:8080/api/health` and `http://127.0.0.1:4111/health`. Do not expose either listener beyond the local host.

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

The checked configuration template uses `http://10.31.107.77:3000/v1` for all three default model URLs. Keep the `/v1` suffix; each tier can be overridden independently.

Private HTTP endpoints are accepted; public remote endpoints require HTTPS. A failed request is not retried through another model or provider.

## Supermemory Operations

Supermemory is optional project-scoped semantic memory. Configure `SUPERMEMORY_ENABLED=true` together with `SUPERMEMORY_API_KEY` before using the memory endpoints. The API never returns the key to the browser. Each project maps to a deterministic container tag; do not use a global container or copy one project's memory into another project.

The available endpoints are `/api/projects/<project-id>/memory/status`, `/memory/ingest`, `/memory/search`, `/memory/graph`, and `/memory/links`. Ingestion accepts bounded text or a project-owned PDF/image Artifact or scanned upload. Links are idempotent by project, source, and content SHA-256. Forget/delete requests create a `memory_revoke` Proposal and perform the remote mutation only after approval.

If the key is absent, the remote request fails, the response is invalid, or the remote operation times out, the API returns a structured error. It does not use local semantic fallback or silently continue. Keep the local `memory_links` ledger for replay, source tracing, failure inspection, and deletion audit. Real provider validation is still required before calling the integration production-ready.

## Scientific Environments

The first approved Python run creates `projects/<id>/.venv` with `RESEARCH_PYTHON_EXECUTABLE`. Dependency installation is a separate, approval-gated operator action; the model cannot provide package commands. WSL2 runs must be explicitly selected and should not reuse a Windows-created environment.

Install a TeX distribution separately when `compile_latex` is needed. Missing `latexmk.exe` produces a structured experiment failure.

## Repository Verification and Acquisition

From a project Literature tab, add a GitHub or GitLab HTTPS repository candidate to a paper. Verify it before requesting download. Verification records the provider metadata, repository citation files, DOI or exact-title match, SPDX license status, default branch, and fixed 40-character commit.

Downloading is always a `dependency_install` Proposal. Approval revalidates the provider snapshot and commit, downloads the fixed archive, enforces archive size/entry/uncompressed-size limits, rejects traversal and link entries, stores the archive as a SHA-256 Artifact, extracts it below `projects/<id>/code/repositories/`, records the Artifact dependency, and commits only that repository path with fixed local Git identity. Failed operations return structured errors and remove temporary files.

## Dependency Lineage and Checkpoint Recovery

After a successful experiment, the server records dependency edges for the Idea version, Git commit, configuration fingerprint, referenced evidence and repositories, generated Artifacts, and Checkpoint. Project detail and recovery reconcile upstream fingerprints. Approved Idea/code changes or missing or changed upstream records recursively invalidate downstream runs, Artifacts, and Checkpoints.

To request recovery, use the project Checkpoint rerun endpoint. It verifies the source run, current Idea/Git baseline, valid Artifact records, bounded paths, non-symlink files, and current SHA-256 values before creating an `experiment_rerun` Proposal. Approval queues the recovered run; operators must not submit that Proposal through the ordinary experiment endpoint. Invalid or changed dependencies produce a structured conflict and no run is queued.

## Upgrade

Stop the current process, back up data, install the new source, run `npm ci`, `npm run build`, and `npm run db:migrate`, then restart. Never delete `projects/`, `artifacts/`, `.env`, or `runtime/` during an in-place upgrade.
