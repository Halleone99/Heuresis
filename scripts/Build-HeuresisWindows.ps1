$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host ""
Write-Host "Heuresis - build latest Windows ARM64 app" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host ""

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm.cmd was not found. Install Node.js first."
}

if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
  throw "rustup was not found. Install Rust first."
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
} else {
  Write-Host "Dependencies already installed." -ForegroundColor DarkGray
}

Write-Host "Ensuring Windows ARM64 Rust target is installed..." -ForegroundColor Yellow
& rustup target add aarch64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw "Could not install the Windows ARM64 Rust target." }

Write-Host "Building Heuresis installer locally..." -ForegroundColor Yellow
& npm.cmd run tauri build -- --target aarch64-pc-windows-msvc --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "Heuresis Windows build failed." }

$installerDir = Join-Path $projectRoot "src-tauri\target\aarch64-pc-windows-msvc\release\bundle\nsis"
$installer = Get-ChildItem -Path $installerDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "The build finished but no NSIS installer was found in $installerDir"
}

Write-Host ""
Write-Host "Latest Heuresis installer is ready:" -ForegroundColor Green
Write-Host $installer.FullName -ForegroundColor Green
Write-Host ""
Write-Host "Opening the installer folder..." -ForegroundColor Cyan
Start-Process explorer.exe -ArgumentList "/select,`"$($installer.FullName)`""
