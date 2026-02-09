param(
  [string]$SessionId = "",
  [int]$IntervalSeconds = 120,
  [string]$Prompt = "Check progress. Report completed tasks, changed files, tests run, blockers, and next wave.",
  [string]$RepoRoot = "C:\Users\Tyler\Desktop\Aether-Blender-Swarm",
  [string]$NtfyBaseUrl = "https://ntfy.sh",
  [string]$NtfyTopic = "aether-blender-tyler"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $RepoRoot "tools\codex-resume-hook.ps1"
$monitorDir = Join-Path $RepoRoot "monitor"
$pidFile = Join-Path $monitorDir "codex-resume-hook.pid"

if (!(Test-Path $monitorDir)) {
  New-Item -ItemType Directory -Path $monitorDir | Out-Null
}

if (Test-Path $pidFile) {
  $existingPid = Get-Content -Raw $pidFile
  if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
    Write-Output "Hook already running (PID $existingPid)"
    exit 0
  } else {
    Remove-Item $pidFile -Force
  }
}

$args = @(
  "-NoProfile"
  "-ExecutionPolicy Bypass"
  "-File `"$scriptPath`""
  "-IntervalSeconds $IntervalSeconds"
  "-Prompt `"$Prompt`""
  "-RepoRoot `"$RepoRoot`""
  "-NtfyBaseUrl `"$NtfyBaseUrl`""
  "-NtfyTopic `"$NtfyTopic`""
)

if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
  $args += "-SessionId `"$SessionId`""
}

$argLine = $args -join " "
$p = Start-Process -FilePath "powershell" -ArgumentList $argLine -WindowStyle Hidden -PassThru
Write-Output "Started codex resume hook PID=$($p.Id)"
