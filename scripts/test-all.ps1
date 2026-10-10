# Run every automated check: backend tests + lint, vision tests + lint, web typecheck, lint, tests, build.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$failed = @()
function Run($name, $dir, [scriptblock]$cmd) {
  Write-Host "`n==> $name" -ForegroundColor Cyan
  Push-Location (Join-Path $Root $dir)
  & $cmd
  if ($LASTEXITCODE -ne 0) { $script:failed += $name }
  Pop-Location
}
Run "API tests"      "services/api"    { .venv\Scripts\python.exe -m pytest -q -p no:warnings }
Run "API lint"       "services/api"    { .venv\Scripts\python.exe -m ruff check app tests }
if (Test-Path (Join-Path $Root "services/vision/.venv")) {
  Run "Vision tests" "services/vision" { .venv\Scripts\python.exe -m pytest -q }
  Run "Vision lint"  "services/vision" { .venv\Scripts\python.exe -m ruff check kortex_vision tests }
}
Run "Web typecheck"  "apps/web"        { npx tsc -b --noEmit }
Run "Web lint"       "apps/web"        { npx eslint . }
Run "Web tests"      "apps/web"        { npx vitest run }
Run "Web build"      "apps/web"        { npx vite build --logLevel warn }
if ($failed.Count) { Write-Host "`nFAILED: $($failed -join ', ')" -ForegroundColor Red; exit 1 }
Write-Host "`nAll checks passed." -ForegroundColor Green
