$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $repoRoot "scripts\Start-Heuresis.vbs"
$icon = Join-Path $repoRoot "src-tauri\icons\icon.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")
$wscript = "$env:SystemRoot\System32\wscript.exe"

if (-not (Test-Path $launcher)) { throw "Heuresis launcher script is missing: $launcher" }

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
  $shortcut.TargetPath = $wscript
  $shortcut.Arguments = "`"$launcher`""
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.Description = "Open the local Heuresis app"
  $shortcut.WindowStyle = 7
  if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
  $shortcut.Save()
}

# Replace any old shortcut so stale dev/localhost launchers cannot survive.
$oldDesktopShortcut = Join-Path $desktop "Heuresis Dev.lnk"
$oldStartShortcut = Join-Path $programs "Heuresis Dev.lnk"
Remove-Item $oldDesktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item $oldStartShortcut -Force -ErrorAction SilentlyContinue

$desktopShortcut = Join-Path $desktop "Heuresis.lnk"
$startShortcut = Join-Path $programs "Heuresis.lnk"
New-HeuresisShortcut $desktopShortcut
New-HeuresisShortcut $startShortcut

Write-Host "Heuresis shortcut created:" -ForegroundColor Green
Write-Host "  $desktopShortcut"
Write-Host "  $startShortcut"
Write-Host ""
Write-Host "Unpin any old Heuresis/Heuresis Dev taskbar item, then right-click this new Heuresis shortcut and choose Pin to taskbar." -ForegroundColor Cyan
