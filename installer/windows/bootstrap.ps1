[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [switch]$InstallDockerIfMissing,
    [switch]$StartOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
    Write-Host "[Research OS] $Message"
}

function New-LocalSecret {
    $bytes = New-Object byte[] 48
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Resolve-DockerCli {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}

function Install-DockerDesktop {
    if (-not $InstallDockerIfMissing) {
        throw "Docker Desktop is required. Re-run the installer and allow the official Docker Desktop installation."
    }
    $downloadUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
    $installerPath = Join-Path ([IO.Path]::GetTempPath()) "ResearchOS-DockerDesktopInstaller.exe"
    Write-Step "Downloading Docker Desktop from the official Docker domain..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Docker") {
        throw "Docker Desktop installer signature validation failed. Nothing was executed."
    }
    Write-Step "Starting the signed Docker Desktop installer. Windows may request administrator approval."
    $process = Start-Process -FilePath $installerPath -ArgumentList "install", "--quiet", "--accept-license" -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Docker Desktop installation failed with exit code $($process.ExitCode)." }
}

function Initialize-Configuration([string]$Root) {
    $envPath = Join-Path $Root ".env"
    if (Test-Path -LiteralPath $envPath) { return }
    $templatePath = Join-Path $Root ".env.example"
    if (-not (Test-Path -LiteralPath $templatePath)) { throw "Missing .env.example in $Root" }
    $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $templatePath
    $replacements = @{
        "change-me-to-a-unique-random-value" = New-LocalSecret
        "change-me-to-a-different-random-value" = New-LocalSecret
        "replace-with-a-long-stable-random-value" = New-LocalSecret
        "replace-with-a-long-local-random-value" = New-LocalSecret
        "replace-with-a-runner-only-random-value" = New-LocalSecret
        "replace-with-the-same-secret-used-by-the-host-bridge" = New-LocalSecret
    }
    foreach ($entry in $replacements.GetEnumerator()) { $content = $content.Replace($entry.Key, $entry.Value) }
    [IO.File]::WriteAllText($envPath, $content, (New-Object Text.UTF8Encoding($false)))
    Write-Step "Generated local-only secrets in .env. The installer does not display or upload them."
}

function Start-CodexBridge([string]$Root) {
    $bridgeExe = Join-Path $Root "bin\ResearchOSCodexBridge.exe"
    if (-not (Test-Path -LiteralPath $bridgeExe)) { return }
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'ResearchOSCodexBridge.exe'" -ErrorAction SilentlyContinue
    if (-not $existing) {
        Start-Process -FilePath $bridgeExe -WorkingDirectory $Root -WindowStyle Hidden
        Write-Step "Started the local Codex Bridge without exposing the Codex auth file to Docker."
    }
}

function Wait-Docker([string]$DockerCli) {
    $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path -LiteralPath $desktop) { Start-Process -FilePath $desktop -WindowStyle Hidden -ErrorAction SilentlyContinue }
    $deadline = (Get-Date).AddMinutes(10)
    do {
        & $DockerCli info --format "{{.ServerVersion}}" *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)
    throw "Docker Engine did not become ready within 10 minutes. Open Docker Desktop once, finish its WSL2 setup, then run Research OS again."
}

$resolvedRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot "docker-compose.yml"))) {
    throw "Research OS installation is incomplete: docker-compose.yml was not found in $resolvedRoot"
}

Initialize-Configuration $resolvedRoot
$dockerCli = Resolve-DockerCli
if (-not $dockerCli) {
    if ($StartOnly) { throw "Docker Desktop is not installed." }
    Install-DockerDesktop
    $dockerCli = Resolve-DockerCli
    if (-not $dockerCli) { throw "Docker CLI was not found after Docker Desktop installation. A Windows sign-out may be required." }
}
Wait-Docker $dockerCli
Start-CodexBridge $resolvedRoot

Write-Step "Starting PostgreSQL, MinIO, MLflow, Runner, API and n8n..."
Push-Location $resolvedRoot
try {
    & $dockerCli compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$healthDeadline = (Get-Date).AddMinutes(5)
do {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/health" -TimeoutSec 5
        if ($health.status -eq "ok") {
            Write-Step "Research OS is ready at http://127.0.0.1:8080/"
            Start-Process "http://127.0.0.1:8080/"
            exit 0
        }
    } catch { }
    Start-Sleep -Seconds 3
} while ((Get-Date) -lt $healthDeadline)

throw "Research OS containers started, but the API health check did not pass within five minutes. Run docker compose ps in $resolvedRoot."
