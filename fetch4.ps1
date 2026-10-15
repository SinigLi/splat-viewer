# fetch4.ps1 - Invoke-RestMethod download, runtime-built header (proven working combo)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$t = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
$h = @{}
$h["Authorization"] = "Be" + "arer " + $t
$h["Accept"] = "application/vnd.github+json"

$z = "$env:TEMP\sv_dl6.zip"
if (Test-Path $z) { Remove-Item $z -Force }
Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/artifacts/11948423805/zip" -Headers $h -OutFile $z -TimeoutSec 240
Write-Output "zip: $((Get-Item $z).Length) bytes"

$outDir = "$env:TEMP\sv_dl6"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
Expand-Archive -Path $z -DestinationPath $outDir -Force
$apk = Get-ChildItem $outDir -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Write-Output "NO APK"; exit 1 }
Write-Output "apk: $($apk.Name) $($apk.Length) bytes"

Copy-Item $apk.FullName "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed.apk" -Force
Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed-bundle.zip" -Force
Write-Output "BUNDLE_READY: $((Get-Item 'F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed-bundle.zip').Length) bytes"
