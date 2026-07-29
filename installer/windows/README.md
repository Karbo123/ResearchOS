# Windows installer

This directory builds an online bootstrap installer. The resulting single EXE contains Research OS and the n8n workflow definitions. All API and model requests run inside Docker Compose; the installer never starts a Windows API service or model Bridge. It does not redistribute Docker Desktop. When Docker is missing and the user opts in, the bootstrap downloads the official installer and verifies its Authenticode signature before requesting elevation.

Build on a Windows release machine with Python and Inno Setup 6:

```powershell
.\installer\windows\build-installer.ps1
```

The build output is intentionally ignored by Git. Release the EXE together with a SHA-256 checksum and code-signing signature. A clean-VM acceptance run is required before `P2-INSTALLER-029` can be marked complete.
