<#
  Start the web app on port 5173.
  -Https  serve over HTTPS with a self-signed certificate so a phone on the
          same Wi-Fi can use its camera (https://<laptop-ip>:5173/shop).
#>
param([switch]$Https)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "apps/web")
if ($Https) { $env:KORTEX_HTTPS = "1" } else { Remove-Item Env:KORTEX_HTTPS -ErrorAction SilentlyContinue }
npx vite
