<#
  Open the API, web app and (optionally) vision service in separate windows.
  -NoVision  don't start the webcam service (simulation mode still works)
  -Https     serve the web app over HTTPS for phone camera access
#>
param([switch]$NoVision, [switch]$Https)
$here = $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$here\start-api.ps1"
Start-Sleep -Seconds 3
$webArgs = @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$here\start-web.ps1")
if ($Https) { $webArgs += "-Https" }
Start-Process powershell -ArgumentList $webArgs
if (-not $NoVision) {
  Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "$here\start-vision.ps1"
}
$proto = if ($Https) { "https" } else { "http" }
Write-Host "Dashboard:     ${proto}://localhost:5173/overview"
Write-Host "Customer app:  ${proto}://localhost:5173/shop"
Write-Host "API docs:      http://localhost:8000/docs"
