# Operations

## Start and Stop

```powershell
npm ci
npm run build
npm start
```

The Windows installer uses `installer/windows/bootstrap.ps1`, stores the parent PID in `runtime/research-os.pid`, and writes stdout/stderr logs under `runtime/`. Its `-Stop` mode terminates only that recorded process tree.

## Health and Capacity

```powershell
npx tsx scripts/ops-guard.ts status
npx tsx scripts/ops-guard.ts capacity
```

The expected endpoints are `http://127.0.0.1:8080/api/health` and `http://127.0.0.1:4111/health`. Do not expose either listener beyond the local host.

## Backup and Restore Check

Stop Research OS before creating a backup so the embedded database snapshot is consistent.

```powershell
npx tsx scripts/ops-guard.ts backup
npx tsx scripts/ops-guard.ts restore-check <14-digit-backup-id>
```

Backups are written to `artifacts/backups/<id>/` with a compressed archive and SHA-256 manifest. `restore-check` validates the archive without overwriting live data. Restoration is an explicit operator action: stop the app, preserve current directories, extract a verified archive into a separate location, inspect it, and then replace only the intended data directories.

## Model Configuration

Use the lower-left settings button or edit project `.env`. Luna, Terra, and Sol are independent. A blank key in the Web form preserves the existing key. The settings API never returns key material.

The checked configuration template uses `http://10.31.107.77:3000/v1` for all three default model URLs. Keep the `/v1` suffix; each tier can be overridden independently.

Private HTTP endpoints are accepted; public remote endpoints require HTTPS. A failed request is not retried through another model or provider.

## Scientific Environments

The first approved Python run creates `projects/<id>/.venv` with `RESEARCH_PYTHON_EXECUTABLE`. Dependency installation is a separate, approval-gated operator action; the model cannot provide package commands. WSL2 runs must be explicitly selected and should not reuse a Windows-created environment.

Install a TeX distribution separately when `compile_latex` is needed. Missing `latexmk.exe` produces a structured experiment failure.

## Upgrade

Stop the current process, back up data, install the new source, run `npm ci`, `npm run build`, and `npm run db:migrate`, then restart. Never delete `projects/`, `artifacts/`, `.env`, or `runtime/` during an in-place upgrade.
