param(
  [int]$IntervalSeconds = 180,
  [string]$Topic = "aether-blender-tyler",
  [string]$BaseUrl = "https://ntfy.sh",
  [string]$RepoRoot = "C:\Users\Tyler\Desktop\Aether-Blender-Swarm"
)

$ErrorActionPreference = "SilentlyContinue"

$monitorDir = Join-Path $RepoRoot "monitor"
if (!(Test-Path $monitorDir)) {
  New-Item -ItemType Directory -Path $monitorDir | Out-Null
}

$logFile = Join-Path $monitorDir "ntfy-heartbeat.log"
$pidFile = Join-Path $monitorDir "ntfy-heartbeat.pid"
$stopFlag = Join-Path $monitorDir "stop-ntfy-heartbeat.flag"
$stateFile = Join-Path $monitorDir "ntfy-progress-state.json"

function Get-RunProgressText {
  param(
    [string]$Root,
    [datetime]$Since
  )

  $runsPath = Join-Path $Root "data\runs.json"
  if (!(Test-Path $runsPath)) {
    return "No run state file found at data/runs.json."
  }

  $raw = Get-Content -Raw $runsPath
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return "Run state file is empty."
  }

  $runs = $raw | ConvertFrom-Json
  if (-not $runs -or $runs.Count -eq 0) {
    return "No runs recorded yet."
  }

  $latest = $runs | Sort-Object { [datetime]$_.updatedAt } -Descending | Select-Object -First 1
  $latestUpdated = [datetime]$latest.updatedAt

  $recentCompleted = $runs | Where-Object {
    $_.status -eq "completed" -and $_.completedAt -and ([datetime]$_.completedAt) -gt $Since
  } | Sort-Object { [datetime]$_.completedAt } -Descending

  $eventLines = @()
  if ($latest.events) {
    $eventLines = $latest.events |
      Sort-Object { [datetime]$_.timestamp } -Descending |
      Select-Object -First 3 |
      ForEach-Object {
        $msg = if ($_.stepName) { $_.stepName } elseif ($_.message) { $_.message } elseif ($_.line) { $_.line } else { "" }
        "$($_.type) $msg".Trim()
      }
  }

  $stepBits = @()
  if ($latest.steps) {
    foreach ($key in @("generation", "validation")) {
      if ($latest.steps.$key) {
        $stepBits += "$key=$($latest.steps.$key.status)"
      }
    }
  }

  $recentCompletedText = if ($recentCompleted.Count -gt 0) {
    ($recentCompleted | Select-Object -First 3 | ForEach-Object { "$($_.id)" }) -join ", "
  } else {
    "none"
  }

  return @(
    "Latest run: $($latest.id)"
    "Status: $($latest.status) | Updated: $($latestUpdated.ToString("HH:mm:ss")) | DurationMs: $($latest.durationMs)"
    "Steps: $([string]::Join(', ', $stepBits))"
    "Recent completed since last tick: $($recentCompleted.Count) ($recentCompletedText)"
    "Latest events: $([string]::Join(' | ', $eventLines))"
  ) -join "`n"
}

Set-Content -Path $pidFile -Value $PID -Encoding UTF8
Add-Content -Path $logFile -Value "$(Get-Date -Format o) | start | pid=$PID | interval=$IntervalSeconds"
$lastTick = (Get-Date).AddSeconds(-$IntervalSeconds)
if (Test-Path $stateFile) {
  try {
    $state = Get-Content -Raw $stateFile | ConvertFrom-Json
    if ($state.last_tick) {
      $lastTick = [datetime]$state.last_tick
    }
  } catch {}
}

while ($true) {
  if (Test-Path $stopFlag) {
    Remove-Item $stopFlag -Force | Out-Null
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) | stop_flag_detected | exiting"
    break
  }

  $now = Get-Date
  $statusText = Get-RunProgressText -Root $RepoRoot -Since $lastTick
  $body = @(
    "Orchestrator progress @ $($now.ToString("yyyy-MM-dd HH:mm:ss"))"
    ""
    $statusText
  ) -join "`n"
  try {
    $headers = @{ "Title" = "Codex Progress Tick"; "Tags" = "robot,bar_chart,alarm_clock" }
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/$Topic" -Headers $headers -Body $body | Out-Null
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) | sent | topic=$Topic"
  } catch {
    Add-Content -Path $logFile -Value "$(Get-Date -Format o) | send_error | $($_.Exception.Message)"
  }
  @{ last_tick = $now.ToString("o") } | ConvertTo-Json | Set-Content -Encoding UTF8 $stateFile
  $lastTick = $now
  Start-Sleep -Seconds $IntervalSeconds
}

if (Test-Path $pidFile) {
  Remove-Item $pidFile -Force | Out-Null
}
