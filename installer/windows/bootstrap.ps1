[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$InstallRoot,
    [switch]$InstallNodeIfMissing,
    [switch]$StartOnly,
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RequiredNode = [Version]"22.13.0"
$NodeRelease = "22.22.0"
function Write-Step([string]$Message) { Write-Host "[Research OS] $Message" }

function Resolve-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    try { $version = [Version]((& $command.Source --version).Trim().TrimStart('v')) } catch { return $null }
    if ($version -lt $RequiredNode) { return $null }
    return $command.Source
}

function Install-NodeLts {
    if (-not $InstallNodeIfMissing) { throw "Node.js 22.13 or newer is required." }
    $url = "https://nodejs.org/dist/v$NodeRelease/node-v$NodeRelease-x64.msi"
    $target = Join-Path ([IO.Path]::GetTempPath()) "ResearchOS-node-v$NodeRelease-x64.msi"
    Write-Step "Downloading the signed Node.js $NodeRelease installer..."
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "OpenJS|Node.js") { throw "Node.js installer signature validation failed." }
    $process = Start-Process msiexec.exe -ArgumentList "/i", "`"$target`"", "/qn", "/norestart" -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Node.js installation failed with exit code $($process.ExitCode)." }
    $env:Path = "$env:ProgramFiles\nodejs;$env:Path"
}

function Initialize-Configuration([string]$Root) {
    $envPath = Join-Path $Root ".env"
    if (Test-Path -LiteralPath $envPath) { return }
    Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination $envPath
    Write-Step "Created .env with placeholder model keys. Configure them in the Web settings before model use."
}

function Stop-ResearchOS([string]$Root) {
    $pidPath = Join-Path $Root "runtime\research-os.pid"
    if (-not (Test-Path -LiteralPath $pidPath)) { return }
    $processId = [int](Get-Content -Raw -LiteralPath $pidPath)
    if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { & taskkill.exe /PID $processId /T /F *> $null }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

$resolvedRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($Stop) { Stop-ResearchOS $resolvedRoot; exit 0 }
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot "package.json"))) { throw "Research OS installation is incomplete: package.json is missing." }
$node = Resolve-Node
if (-not $node) {
    if ($StartOnly) { throw "Node.js 22.13 or newer is not installed." }
    Install-NodeLts
    $node = Resolve-Node
    if (-not $node) { throw "Node.js is not available yet. Sign out of Windows once, then start Research OS again." }
}

Initialize-Configuration $resolvedRoot
$npm = Join-Path (Split-Path -Parent $node) "npm.cmd"
Push-Location $resolvedRoot
try {
    if (-not $StartOnly -or -not (Test-Path -LiteralPath (Join-Path $resolvedRoot "node_modules"))) {
        Write-Step "Installing locked TypeScript dependencies..."
        & $npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
        Write-Step "Building the native API, Web UI and Mastra Studio..."
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
    }
    Stop-ResearchOS $resolvedRoot
    $runtime = Join-Path $resolvedRoot "runtime"
    New-Item -ItemType Directory -Force $runtime | Out-Null
    $process = Start-Process -FilePath $npm -ArgumentList "start" -WorkingDirectory $resolvedRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime "native.stdout.log") -RedirectStandardError (Join-Path $runtime "native.stderr.log") -PassThru
    [IO.File]::WriteAllText((Join-Path $runtime "research-os.pid"), [string]$process.Id)
} finally { Pop-Location }

$deadline = (Get-Date).AddMinutes(3)
do {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/health" -TimeoutSec 5
        if ($health.status -eq "ok" -and $health.runtime -eq "native-typescript") {
            Write-Step "Research OS is ready at http://127.0.0.1:8080/"
            Start-Process "http://127.0.0.1:8080/"
            exit 0
        }
    } catch { }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
throw "The native process started, but its health check failed. Inspect runtime\native.stderr.log."
