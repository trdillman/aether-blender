[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$releaseDir = Join-Path $repoRoot "release"
$logsDir = Join-Path $releaseDir "logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Resolve-Python {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @{ Exe = "py"; Args = @("-3") }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @{ Exe = "python"; Args = @() }
    }
    throw "Python 3 not found in PATH."
}

Write-Host "==> PKG build starting from $repoRoot"

Push-Location (Join-Path $repoRoot "server")
try {
    if (-not (Test-Path "package-lock.json")) {
        Write-Host "==> Creating server/package-lock.json"
        npm install --package-lock-only --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "Failed to create server package-lock.json" }
    }
    Write-Host "==> Running server npm ci + release test suite"
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "server npm ci failed" }
    npm run test:release 2>&1 | Tee-Object -FilePath (Join-Path $logsDir "server-test.log")
    if ($LASTEXITCODE -ne 0) { throw "server release test suite failed" }
}
finally {
    Pop-Location
}

Push-Location (Join-Path $repoRoot "web_interface")
try {
    Write-Host "==> Running web_interface npm ci + build"
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "web_interface npm ci failed" }
    npm run build | Tee-Object -FilePath (Join-Path $logsDir "web-build.log")
    if ($LASTEXITCODE -ne 0) { throw "web_interface npm run build failed" }
}
finally {
    Pop-Location
}

if (Get-Command blender -ErrorAction SilentlyContinue) {
    Write-Host "==> Running Blender headless harness"
    blender -b -P test_harness.py -- scaffold | Tee-Object -FilePath (Join-Path $logsDir "blender-harness.log")
    if ($LASTEXITCODE -ne 0) { throw "Blender harness command failed" }
    $blenderLog = Get-Content -Path (Join-Path $logsDir "blender-harness.log") -Raw
    if ($blenderLog -notmatch "SUCCESS: Syntax valid and import successful.") {
        throw "Blender harness did not report scaffold success."
    }
}
else {
    "SKIPPED: blender executable not found in PATH." | Set-Content -Path (Join-Path $logsDir "blender-harness.log")
    Write-Warning "Blender not found in PATH. Skipping headless harness."
}

Write-Host "==> Packaging deterministic release archive"
$py = Resolve-Python
& $py.Exe @($py.Args + @("scripts/package_release.py"))
if ($LASTEXITCODE -ne 0) { throw "release packaging failed" }

Write-Host "==> Generating release provenance/signing artifacts"
& $py.Exe @($py.Args + @("scripts/sign_release.py"))
if ($LASTEXITCODE -ne 0) { throw "release signing/provenance failed" }

Write-Host "==> Build complete. Artifacts in $releaseDir"

