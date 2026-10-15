# fetch5.ps1 - download run 38694191436 artifact, pack bundle
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$t = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
$h = @{}
$h["Authorization"] = "Be" + "arer " + $t
$h["Accept"] = "application/vnd.github+json"

$arts = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs/38694191436/artifacts" -Headers $h
$art = @($arts.artifacts) | Select-Object -First 1
if (-not $art) { Write-Output "NO ARTIFACT"; exit 1 }
Write-Output "artifact: $($art.id) size=$($art.size_in_bytes)"

$z = "$env:TEMP\sv_v3.zip"
Invoke-RestMethod -Uri $art.archive_download_url -Headers $h -OutFile $z -TimeoutSec 240
Write-Output "zip: $((Get-Item $z).Length) bytes"

$outDir = "$env:TEMP\sv_v3"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
Expand-Archive -Path $z -DestinationPath $outDir -Force
$apk = Get-ChildItem $outDir -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Write-Output "NO APK"; exit 1 }
Write-Output "apk: $($apk.Name) $($apk.Length) bytes"

Copy-Item $apk.FullName "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-v3.apk" -Force
Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-v3-bundle.zip" -Force
Write-Output "BUNDLE_READY: $((Get-Item 'F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-v3-bundle.zip').Length) bytes"
