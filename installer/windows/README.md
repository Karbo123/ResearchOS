# Windows Installer

The Inno Setup installer copies the source and native build configuration into `%LOCALAPPDATA%\ResearchOS`. Its bootstrapper verifies Node.js 22.13+, optionally downloads the signed Node.js 22.22 LTS MSI from `nodejs.org`, runs `npm ci`, builds the TypeScript packages, and starts the API and Mastra as a hidden local process tree.

The app writes the parent PID and logs under `runtime/`. Uninstall invokes `bootstrap.ps1 -Stop`, which terminates only the recorded Research OS process tree. User data directories are not treated as disposable during upgrades.

Build locally:

```powershell
.\installer\windows\build-installer.ps1 -Version 0.3.0
```

Publishing remains gated by Authenticode signing, SHA-256 output, a clean Windows VM installation test, model-error verification, upgrade/uninstall checks, and an explicit GitHub Release action.
