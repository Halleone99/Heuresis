$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$debugExe = Join-Path $repoRoot "src-tauri\target\debug\heuresis.exe"
$stateDir = Join-Path $repoRoot ".dev"
$stampFile = Join-Path $stateDir "built-commit.txt"
$lockFile = Join-Path $stateDir "local-build.lock"
$logFile = Join-Path $stateDir "last-build.log"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Show-HeuresisMessage([string]$message, [string]$title = "Heuresis") {
  try {
    Add-Type -AssemblyName PresentationFramework -ErrorAction Stop
    [System.Windows.MessageBox]::Show($message, $title) | Out-Null
  } catch {
    # If WPF is unavailable, fail quietly; diagnostics remain in the log file.
  }
}

function Get-CurrentCommit {
  try {
    $commit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $commit) { return $commit }
  } catch {}
  return "unknown"
}

$currentCommit = Get-CurrentCommit
$builtCommit = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { "" }
$needsBuild = (-not (Test-Path $debugExe)) -or ($builtCommit -ne $currentCommit)

# The pinned app must be a bundled local build, not a `tauri dev` binary.
# That removes the localhost/Vite dependency which caused ERR_CONNECTION_REFUSED.
if ($needsBuild) {
  if (Test-Path $lockFile) {
    $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($lockAge.TotalMinutes -lt 10) {
      Show-HeuresisMessage "Heuresis is already updating. It will open when the local build is ready."
      exit 0
    }
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  }

  $running = Get-Process -Name "heuresis" -ErrorAction SilentlyContinue
  if ($running) {
    Show-HeuresisMessage "A newer Heuresis version is ready to build. Close the open Heuresis window, then click the pinned icon again."
    exit 0
  }

  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    Show-HeuresisMessage "npm.cmd was not found. Node.js is required to update the local Heuresis app."
    exit 1
  }

  Set-Content -Path $lockFile -Value (Get-Date).ToString("o") -Encoding ascii
  try {
    Push-Location $repoRoot
    try {
      "[$(Get-Date -Format o)] Building Heuresis from commit $currentCommit" | Set-Content $logFile -Encoding utf8
      & npm.cmd run tauri -- build --debug --no-bundle *>> $logFile
      $buildExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }

    if ($buildExit -ne 0 -or -not (Test-Path $debugExe)) {
      Show-HeuresisMessage "Heuresis could not update. The build log is here:`n$logFile"
      exit 1
    }

    Set-Content -Path $stampFile -Value $currentCommit -Encoding ascii
  } finally {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  }
}

# This executable contains the built frontend, so it does not need localhost,
# Vite, a terminal window, or a persistent development server.
Start-Process -FilePath $debugExe -WorkingDirectory $repoRoot
