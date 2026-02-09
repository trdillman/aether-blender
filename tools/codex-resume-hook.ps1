param(
  [string]$SessionId = "",
  [int]$IntervalSeconds = 120,
  [string]$Prompt = "Check progress. Report completed tasks, changed files, tests run, blockers, and next wave.",
  [string]$RepoRoot = "C:\Users\Tyler\Desktop\Aether-Blender-Swarm",
  [string]$NtfyBaseUrl = "https://ntfy.sh",
  [string]$NtfyTopic = "aether-blender-tyler"
)

$ErrorActionPreference = "SilentlyContinue"

$monitorDir = Join-Path $RepoRoot "monitor"
if (!(Test-Path $monitorDir)) {
  New-Item -ItemType Directory -Path $monitorDir | Out-Null
}

$logFile = Join-Path $monitorDir "codex-resume-hook.log"
$stopFlag = Join-Path $monitorDir "stop-codex-resume.flag"
$pidFile = Join-Path $monitorDir "codex-resume-hook.pid"
$resumeTimeoutSeconds = 90

Set-Content -Path $pidFile -Value $PID -Encoding UTF8
Add-Content -Path $logFile -Value "$(Get-Date -Format o) | start | pid=$PID | session=$SessionId | interval=$IntervalSeconds"

Push-Location $RepoRoot
try {
  while ($true) {
    if (Test-Path $stopFlag) {
      Remove-Item $stopFlag -Force | Out-Null
      Add-Content -Path $logFile -Value "$(Get-Date -Format o) | stop_flag_detected | exiting"
      break
    }

    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $outJsonl = Join-Path $monitorDir "codex-resume-$ts.jsonl"

    $errLog = Join-Path $monitorDir "codex-resume-$ts.err.log"
    $argList = @("exec", "resume")
    if ([string]::IsNullOrWhiteSpace($SessionId)) {
      Add-Content -Path $logFile -Value "$(Get-Date -Format o) | tick | mode=last"
      $argList += "--last"
    } else {
      Add-Content -Path $logFile -Value "$(Get-Date -Format o) | tick | session=$SessionId"
      $argList += $SessionId
    }
    $argList += @($Prompt, "--json", "--skip-git-repo-check")

    $proc = Start-Process -FilePath "codex" -ArgumentList $argList -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $outJsonl -RedirectStandardError $errLog
    $finished = $proc.WaitForExit($resumeTimeoutSeconds * 1000)
    if ($finished) {
      $exitCode = $proc.ExitCode
    } else {
      Stop-Process -Id $proc.Id -Force | Out-Null
      $exitCode = 124
      Add-Content -Path $logFile -Value "$(Get-Date -Format o) | tick_timeout | timeout_s=$resumeTimeoutSeconds | pid=$($proc.Id)"
    }

    Add-Content -Path $logFile -Value "$(Get-Date -Format o) | tick_complete | exit=$exitCode | out=$outJsonl"

    $note = "Codex resume tick complete | exit=$exitCode | file=$(Split-Path $outJsonl -Leaf)"
    try {
      $headers = @{
        "Title" = "Codex Orchestrator Tick"
        "Tags"  = "robot,clock8"
      }
      Invoke-RestMethod -Method Post -Uri "$NtfyBaseUrl/$NtfyTopic" -Headers $headers -Body $note | Out-Null
      Add-Content -Path $logFile -Value "$(Get-Date -Format o) | ntfy_sent | topic=$NtfyTopic"
    } catch {
      Add-Content -Path $logFile -Value "$(Get-Date -Format o) | ntfy_error | $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
  }
}
finally {
  Pop-Location
  if (Test-Path $pidFile) {
    Remove-Item $pidFile -Force | Out-Null
  }
}
