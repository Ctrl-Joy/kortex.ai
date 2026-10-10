<#
.SYNOPSIS
  One-time local setup for KORTEX AI (Windows PowerShell 5.1+).

  * creates .env from .env.example with freshly generated secrets (if missing)
  * creates Python virtual environments for the API and the vision service
  * installs pinned Python and Node dependencies
  * initialises and seeds the SQLite database (idempotent)

  Python environments are created with `uv` (installed per-user if absent),
  which downloads a standalone CPython 3.12. This avoids DLL conflicts seen
  with some Anaconda installs and PyTorch (WinError 1114).

.PARAMETER SkipVision
  Skip the (large, ~1 GB) computer-vision environment.
#>
param([switch]$SkipVision)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- uv ------
Step "Locating uv"
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
  $py = (Get-Command py -ErrorAction SilentlyContinue).Source
  if (-not $py) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
  if (-not $py) { throw "Neither uv nor Python was found. Install Python 3.11+ or uv (https://docs.astral.sh/uv/)." }
  & $py -m pip install --user --upgrade uv
  $uv = (& $py -c "import sysconfig,os;print(os.path.join(sysconfig.get_path('scripts','nt_user'),'uv.exe'))").Trim()
  if (-not (Test-Path $uv)) { throw "uv installation failed" }
}
Write-Host "uv: $uv"
# --native-tls makes uv trust the Windows certificate store (needed behind
# antivirus HTTPS scanning or corporate proxies).
$uvTls = "--native-tls"

# ---------------------------------------------------------------- .env ----
Step "Environment file"
if (-not (Test-Path ".env")) {
  $content = Get-Content ".env.example" -Raw
  function NewSecret([int]$bytes) {
    $b = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  }
  $content = $content.Replace("KORTEX_SECRET_KEY=change-me-to-a-long-random-string", "KORTEX_SECRET_KEY=$(NewSecret 48)")
  $content = $content.Replace("KORTEX_VISION_API_KEY=change-me-vision-key", "KORTEX_VISION_API_KEY=$(NewSecret 24)")
  $content = $content.Replace("KORTEX_SEED_STAFF_PASSWORD=change-me-staff-password", "KORTEX_SEED_STAFF_PASSWORD=kortex-demo-2026")
  [System.IO.File]::WriteAllText((Join-Path $Root ".env"), $content)
  Write-Host "Created .env (staff demo password: kortex-demo-2026 — change it before seeding if you like)"
} else {
  Write-Host ".env already exists — left untouched"
}

# ---------------------------------------------------------------- API -----
Step "API environment (services/api)"
Push-Location services/api
if (-not (Test-Path ".venv")) { & $uv venv $uvTls --python 3.12 .venv }
& $uv pip install $uvTls --python .venv\Scripts\python.exe -r requirements.txt
Pop-Location

# ---------------------------------------------------------------- vision --
if (-not $SkipVision) {
  Step "Vision environment (services/vision) — this downloads PyTorch CPU (~1 GB)"
  Push-Location services/vision
  if (-not (Test-Path ".venv")) { & $uv venv $uvTls --python 3.12 .venv }
  & $uv pip install $uvTls --python .venv\Scripts\python.exe --index-strategy unsafe-best-match -r requirements.txt
  if (-not (Test-Path "models\yolo11n.pt")) {
    New-Item -ItemType Directory -Force models | Out-Null
    Write-Host "Downloading YOLO11n weights (5.4 MB, AGPL-3.0, Ultralytics)"
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt" -OutFile "models\yolo11n.pt"
  }
  Pop-Location
}

# ---------------------------------------------------------------- web -----
Step "Web app (apps/web)"
Push-Location apps/web
npm install --no-audit --no-fund
Pop-Location

# ---------------------------------------------------------------- data ----
Step "Database (idempotent seed)"
Push-Location services/api
& .venv\Scripts\python.exe -m app.db.seed
Pop-Location

Write-Host "`nSetup complete. Start everything with:  scripts\start-all.ps1" -ForegroundColor Green
