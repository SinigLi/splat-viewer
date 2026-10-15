# watch-fetch.ps1 - poll build for 1515aff, download artifact, pack bundle
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$t = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
$h = @{}
$h["Authorization"] = "Be" + "arer " + $t
$h["Accept"] = "application/vnd.github+json"

$runId = $null
foreach ($i in 1..12) {
    try {
        $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs?per_page=3" -Headers $h
        $r = @($runs.workflow_runs) | Where-Object { $_.head_sha -like "1515aff*" } | Select-Object -First 1
        if ($r) { $runId = $r.id; Write-Output "run: $($r.id) status=$($r.status)"; break }
    } catch { }
    Start-Sleep -Seconds 10
}
if (-not $runId) { Write-Output "NO RUN"; exit 1 }

foreach ($i in 1..40) {
    Start-Sleep -Seconds 15
    try { $run = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs/$runId" -Headers $h } catch { continue }
    if ($run.status -eq "completed") { Write-Output "BUILD: $($run.conclusion)"; if ($run.conclusion -ne "success") { exit 1 }; break }
}

$arts = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs/$runId/artifacts" -Headers $h
$art = @($arts.artifacts) | Select-Object -First 1
if (-not $art) { Write-Output "NO ARTIFACT"; exit 1 }
Write-Output "artifact: $($art.id) size=$($art.size_in_bytes)"

$z = "$env:TEMP\sv_v32.zip"
Invoke-RestMethod -Uri $art.archive_download_url -Headers $h -OutFile $z -TimeoutSec 240
Write-Output "zip: $((Get-Item $z).Length) bytes"

$outDir = "$env:TEMP\sv_v32"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
Expand-Archive -Path $z -DestinationPath $outDir -Force
$apk = Get-ChildItem $outDir -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Write-Output "NO APK"; exit 1 }
Write-Output "apk: $($apk.Name) $($apk.Length) bytes"

Copy-Item $apk.FullName "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-v32.apk" -Force
Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-v32-bundle.zip" -Force
Write-Output "BUNDLE_READY: $((Get-Item 'F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-v32-bundle.zip').Length) bytes"
