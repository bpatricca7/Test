<#
.SYNOPSIS
  Set up and run Amentum AI on a Windows PC (no Docker required).

.DESCRIPTION
  First run: creates backend\.env from a profile template, a Python virtual environment,
  installs dependencies and builds the web UI. Then starts the app on http://localhost:8000.

.EXAMPLE
  .\scripts\dev.ps1                   # demo mode - no API key needed
.EXAMPLE
  .\scripts\dev.ps1 -Mode openai      # test with your OpenAI API key (prompts for it)
.EXAMPLE
  .\scripts\dev.ps1 -Dev              # also run the Vite dev server with hot reload on :5173
#>
param(
  [ValidateSet("demo", "openai", "azure", "gcc-high")]
  [string]$Mode = "",
  [switch]$Dev,
  [switch]$Rebuild,
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Venv = Join-Path $Root ".venv"
$EnvFile = Join-Path $Backend ".env"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---- 1. Configuration -------------------------------------------------------------------
$templates = @{ "demo" = "demo"; "openai" = "dev-openai"; "azure" = "azure-commercial"; "gcc-high" = "gcc-high" }
if (-not (Test-Path $EnvFile)) {
  if (-not $Mode) { $Mode = "demo" }
  $src = Join-Path $Root ("env\" + $templates[$Mode] + ".env.example")
  Copy-Item $src $EnvFile
  Step "Created backend\.env from env\$($templates[$Mode]).env.example"
} elseif ($Mode) {
  Write-Host "backend\.env already exists - keeping it. Delete it to switch to the '$Mode' mode." -ForegroundColor Yellow
}

$envText = Get-Content $EnvFile -Raw
if ($envText -match "OPENAI_API_KEY=sk-\.\.\.your-key\.\.\.") {
  $secure = Read-Host "Paste your OpenAI API key (input hidden)" -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $envText = $envText -replace "OPENAI_API_KEY=sk-\.\.\.your-key\.\.\.", "OPENAI_API_KEY=$key"
  Set-Content -Path $EnvFile -Value $envText -NoNewline
  Write-Host "Saved key to backend\.env (this file is git-ignored)." -ForegroundColor Green
}

# ---- 2. Python environment -------------------------------------------------------------
$VenvPy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  $py = $null
  foreach ($candidate in @(@("py", "-3.12"), @("py", "-3.13"), @("py", "-3.11"), @("python"))) {
    $exe = $candidate[0]
    $pre = @($candidate | Select-Object -Skip 1)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
      $ok = & $exe @pre -c "import sys; print(sys.version_info >= (3, 11))" 2>$null
      if ($ok -eq "True") { $py = @{ Exe = $exe; Pre = $pre }; break }
    } catch { }
  }
  if (-not $py) { throw "Python 3.11+ is required. Install it from https://www.python.org/downloads/ (tick 'Add to PATH')." }
  Step "Creating Python virtual environment (.venv)"
  $pre = $py.Pre
  & $py.Exe @pre -m venv $Venv
  if ($LASTEXITCODE -ne 0) { throw "Could not create the virtual environment" }
}
$req = Join-Path $Backend "requirements.txt"
$stamp = Join-Path $Venv ".requirements.sha"
$hash = (Get-FileHash $req -Algorithm SHA256).Hash
if (-not (Test-Path $stamp) -or (Get-Content $stamp) -ne $hash) {
  Step "Installing Python dependencies (first run takes a few minutes)"
  & $VenvPy -m pip install --upgrade pip | Out-Null
  & $VenvPy -m pip install -r $req
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
  Set-Content $stamp $hash
}

# ---- 3. Web UI ----------------------------------------------------------------------------
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 LTS is required for the web UI. Install it from https://nodejs.org/."
}
Push-Location $Frontend
try {
  if (-not (Test-Path "node_modules")) { Step "Installing web UI dependencies"; npm ci --no-audit --no-fund }
  if ($Rebuild -or -not (Test-Path "dist\index.html")) { Step "Building web UI"; npm run build }
  if ($Dev) {
    Step "Starting Vite dev server on http://localhost:5173"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "npm run dev" -WorkingDirectory $Frontend
  }
} finally { Pop-Location }

# ---- 4. Optional helpers ----------------------------------------------------------------------
if (-not (Get-Command soffice -ErrorAction SilentlyContinue) -and -not (Test-Path "C:\Program Files\LibreOffice\program\soffice.exe")) {
  Write-Host "Tip: install LibreOffice (https://www.libreoffice.org) to enable Office preview + print-to-PDF." -ForegroundColor DarkYellow
}

# ---- 5. Run -----------------------------------------------------------------------------------
Step "Starting Amentum AI on http://localhost:$Port  (Ctrl+C to stop)"
if (-not $Dev) { Start-Process "http://localhost:$Port" }
Push-Location $Backend
try {
  $uvArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$Port")
  if ($Dev) { $uvArgs += "--reload" }
  & $VenvPy @uvArgs
} finally { Pop-Location }
