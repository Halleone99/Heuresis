$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$debugExe = Join-Path $repoRoot "src-tauri\target\debug\heuresis.exe"
$stateDir = Join-Path $repoRoot ".dev"
$lockFile = Join-Path $stateDir "launcher-starting.lock"
$logFile = Join-Path $stateDir "last-launch.log"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Test-HeuresisDevServer {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect("127.0.0.1", 1421, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(180)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

# If the Vite/Tauri dev environment is already alive, just open another
# Heuresis window from the existing debug binary.
if ((Test-HeuresisDevServer) -and (Test-Path $debugExe)) {
  Start-Process -FilePath $debugExe -WorkingDirectory $repoRoot
  exit 0
}

# Avoid starting several Vite/Cargo stacks if the pinned icon is clicked twice
# while the first development launch is still compiling.
if (Test-Path $lockFile) {
  $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($lockAge.TotalSeconds -lt 90) { exit 0 }
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

Set-Content -Path $lockFile -Value (Get-Date).ToString("o") -Encoding ascii

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  throw "npm.cmd was not found. Install Node.js before launching Heuresis development mode."
}

# Keep the development terminal out of the way. Output is retained in
# .dev\last-launch.log so a failed launch can still be diagnosed.
$escapedRoot = $repoRoot.Replace('"', '""')
$escapedLog = $logFile.Replace('"', '""')
$command = "cd /d `"$escapedRoot`" && npm.cmd run tauri dev > `"$escapedLog`" 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", $command -WorkingDirectory $repoRoot -WindowStyle Hidden

# Keep the lock while Vite/Tauri is starting, then release it. The Tauri CLI
# opens the first app window itself; future clicks take the fast path above.
for ($i = 0; $i -lt 240; $i += 1) {
  Start-Sleep -Milliseconds 250
  if (Test-HeuresisDevServer) {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    exit 0
  }
}

Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
exit 0
