[CmdletBinding()]
param(
    [string]$IsccPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if (-not (Test-Path -LiteralPath $IsccPath)) {
    throw "Inno Setup 6 compiler was not found at $IsccPath. Install it only on the release build machine, then rerun this script."
}
& $IsccPath (Join-Path $PSScriptRoot "ResearchOS.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }
Write-Host "Installer created under $PSScriptRoot\dist"
