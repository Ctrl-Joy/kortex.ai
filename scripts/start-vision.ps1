<#
  Start the KORTEX vision service (webcam + YOLO) on http://127.0.0.1:8100.
  -Camera <index>  choose a different webcam (default from VISION_CAMERA_INDEX).
#>
param([int]$Camera = -1)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "services/vision")
if ($Camera -ge 0) { $env:VISION_CAMERA_INDEX = "$Camera" }
& .venv\Scripts\python.exe -m kortex_vision
