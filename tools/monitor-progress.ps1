$ErrorActionPreference = "SilentlyContinue"

$repo = "C:\Users\Tyler\Desktop\Aether-Blender-Swarm"
$outDir = Join-Path $repo "monitor"
$logFile = Join-Path $outDir "progress-log.ndjson"
$jsonFile = Join-Path $outDir "latest-progress.json"

if (!(Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

while ($true) {
  $now = Get-Date
  $active = Get-Process | Where-Object { $_.ProcessName -match "codex|node|python|blender" } |
    Select-Object -First 30 Id, ProcessName, StartTime, CPU

  $recentFiles = Get-ChildItem -Recurse -File $repo |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 20 FullName, LastWriteTime, Length

  $payload = [ordered]@{
    timestamp = $now.ToString("o")
    active_process_count = ($active | Measure-Object).Count
    active_processes = $active
    recent_files = $recentFiles
  }

  $payload | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $jsonFile
  ($payload | ConvertTo-Json -Depth 6 -Compress) | Add-Content -Encoding UTF8 $logFile

  Start-Sleep -Seconds 300
}
