$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $repoRoot "scripts\Start-HeuresisDev.ps1"
$icon = Join-Path $repoRoot "src-tauri\icons\icon.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path $launcher)) { throw "Heuresis launcher script is missing: $launcher" }

# Generate the current Heuresis icon if the local icon set has not yet been
# created. This keeps the shortcut visually consistent with the app itself.
if (-not (Test-Path $icon)) {
  Push-Location $repoRoot
  try {
    & npm.cmd run pretauri
  } finally {
    Pop-Location
  }
}

function New-HeuresisShortcut([string]$path) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $powerShell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.Description = "Open the local Heuresis development app"
  $shortcut.WindowStyle = 7
  if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
  $shortcut.Save()
}

$desktopShortcut = Join-Path $desktop "Heuresis Dev.lnk"
$startShortcut = Join-Path $programs "Heuresis Dev.lnk"
New-HeuresisShortcut $desktopShortcut
New-HeuresisShortcut $startShortcut

Write-Host "Heuresis Dev shortcut created:" -ForegroundColor Green
Write-Host "  $desktopShortcut"
Write-Host "  $startShortcut"
Write-Host ""
Write-Host "Right-click 'Heuresis Dev' and choose 'Pin to taskbar'. You can then remove the old installed Heuresis pin if you no longer want it." -ForegroundColor Cyan
