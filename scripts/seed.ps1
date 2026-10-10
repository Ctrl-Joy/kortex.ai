# Idempotently create the schema and seed the store, staff, catalogue and labelled demo history.
# Pass -NoHistory to skip the 18 historical demo sessions.
param([switch]$NoHistory)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "services/api")
if ($NoHistory) { & .venv\Scripts\python.exe -m app.db.seed --no-history } else { & .venv\Scripts\python.exe -m app.db.seed }
