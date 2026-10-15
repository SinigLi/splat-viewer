# fetch-apk-with-file-token.ps1 - read token from githubapi.txt, download fixed APK, pack bundle
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$token = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
if (-not $token) { Write-Output "ERROR: empty token file"; exit 1 }
$headers = @{ Authorization = "***"; Accept = "application/vnd.github+json" }

try {
    $u = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
    Write-Output "TOKEN OK: $($u.login)"
} catch {
    Write-Output "TOKEN DEAD: HTTP $([int]$_.Exception.Response.StatusCode)"
    exit 1
}

$outDir = "$env:TEMP\sv_dl3"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$z = "$outDir\artifact.zip"

Invoke-WebRequest -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/artifacts/11948423805/zip" -Headers $headers -OutFile $z
Write-Output "zip: $((Get-Item $z).Length) bytes"

Expand-Archive -Path $z -DestinationPath $outDir -Force
$apk = Get-ChildItem $outDir -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Write-Output "NO APK"; exit 1 }
Write-Output "apk: $($apk.Name) $($apk.Length) bytes"

Copy-Item $apk.FullName "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed.apk" -Force
Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed-bundle.zip" -Force
Write-Output "BUNDLE_READY: $((Get-Item 'F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed-bundle.zip').Length) bytes"
