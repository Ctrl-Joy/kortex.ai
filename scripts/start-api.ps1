# Start the KORTEX API on http://localhost:8000 (Swagger UI at /docs).
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "services/api")
& .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
