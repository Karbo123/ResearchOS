# Windows installer

This directory builds an online bootstrap installer. The resulting single EXE contains Research OS and the n8n workflow definitions. All API and model requests run inside Docker Compose; the installer never starts a Windows API service or model Bridge. It does not redistribute Docker Desktop. When Docker is missing and the user opts in, the bootstrap downloads the official installer and verifies its Authenticode signature before requesting elevation.

`.github/workflows/installer-release.yml` builds the EXE on a Windows GitHub runner for `v*` tags, writes `SHA256SUMS.txt`, and creates a draft Release. A normal tag push can only create a draft. To publish, manually run the workflow from the same tag with `publish=true`; the job then requires `INSTALLER_SIGNING_CERT_PFX_B64` and `INSTALLER_SIGNING_CERT_PASSWORD`, signs with Authenticode, verifies the signature, refreshes the checksum, and publishes the Release. No `.env`, credential, Docker binary, or Codex auth file is packaged.

Build on a Windows release machine with Python and Inno Setup 6:

```powershell
.\installer\windows\build-installer.ps1
```

The build output is intentionally ignored by Git. A clean-VM acceptance run is required before publishing or marking `P2-INSTALLER-029` complete. The workflow does not bypass missing signing secrets, and it does not claim that Docker Desktop is redistributed.
