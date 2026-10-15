# download-artifact.ps1 - read token from file, download APK, pack bundle
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$token = (Get-Content "$env:TEMP\gh_token.txt" -Raw).Trim()
if (-not $token) { Write-Output "ERROR: no token"; exit 1 }
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$runId = "38682314859"

$arts = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs/$runId/artifacts" -Headers $headers
$art = @($arts.artifacts) | Select-Object -First 1
if (-not $art) { Write-Output "NO ARTIFACT"; exit 1 }
Write-Output "artifact: $($art.name) id=$($art.id) size=$($art.size_in_bytes)"

$tmp = "$env:TEMP\sv_apk2"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Invoke-WebRequest -Uri $art.archive_download_url -Headers $headers -OutFile "$tmp\artifact.zip"
Write-Output "zip: $((Get-Item "$tmp\artifact.zip").Length) bytes"

Expand-Archive -Path "$tmp\artifact.zip" -DestinationPath $tmp -Force
$apk = Get-ChildItem $tmp -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Write-Output "NO APK IN ARTIFACT"; exit 1 }
Write-Output "apk: $($apk.Name) $($apk.Length) bytes"

Copy-Item $apk.FullName "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-debug-v2.apk" -Force
Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-bundle-v2.zip" -Force
$b = Get-Item "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-bundle-v2.zip"
Write-Output "BUNDLE_READY: $($b.Name) $($b.Length) bytes"
