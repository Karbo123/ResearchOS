[CmdletBinding()]
param(
    [string]$IsccPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$buildRoot = Join-Path $PSScriptRoot "build"
$venvRoot = Join-Path $repoRoot ".venv-installer"
$python = Get-Command python.exe -ErrorAction Stop

if (-not (Test-Path -LiteralPath $IsccPath)) {
    throw "Inno Setup 6 compiler was not found at $IsccPath. Install it only on the release build machine, then rerun this script."
}
if (-not (Test-Path -LiteralPath $venvRoot)) {
    & $python.Source -m venv $venvRoot
}
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check "pyinstaller==6.16.0"
if ($LASTEXITCODE -ne 0) { throw "Failed to install the pinned PyInstaller build dependency." }

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
& $venvPython -m PyInstaller --noconfirm --clean --onefile --name ResearchOSCodexBridge --distpath $buildRoot --workpath (Join-Path $buildRoot "pyinstaller") --specpath $buildRoot (Join-Path $repoRoot "scripts\codex_llm_bridge.py")
if ($LASTEXITCODE -ne 0) { throw "Codex Bridge packaging failed." }

& $IsccPath (Join-Path $PSScriptRoot "ResearchOS.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }
Write-Host "Installer created under $PSScriptRoot\dist"
