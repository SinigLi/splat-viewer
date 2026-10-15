param([string]$DeviceCode, [string]$ClientId = "178c6fc778ccc68e1d6a")
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$log = "$PSScriptRoot\watcher.log"
function Log($m) { try { ("{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $m) | Add-Content -Path $log } catch {} }
Log "watcher started"

$deadline = (Get-Date).AddMinutes(14)
$token = $null
while ((Get-Date) -lt $deadline -and -not $token) {
    Start-Sleep -Seconds 6
    try {
        $r = Invoke-RestMethod -Method Post -Uri "https://github.com/login/oauth/access_token" `
            -Headers @{ Accept = "application/json" } -ContentType "application/json" `
            -Body (@{ client_id = $ClientId; device_code = $DeviceCode; grant_type = "urn:ietf:params:oauth:grant-type:device_code" } | ConvertTo-Json)
    } catch { Log "poll net error: $($_.Exception.Message)"; continue }
    if ($r.access_token) { $token = $r.access_token; Log "TOKEN_RECEIVED" }
    elseif ($r.error -eq "authorization_pending") { Log "waiting for authorization" }
    elseif ($r.error -eq "slow_down") { Start-Sleep -Seconds 5 }
    elseif ($r.error) { Log "FLOW_ERROR: $($r.error)"; break }
}
if (-not $token) { Log "NO_TOKEN_TIMEOUT_OR_ERROR"; exit 1 }

$env:GH_TOKEN = $token
& powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\upload-via-api.ps1" -Message "Splat viewer: mobile-first Gaussian Splat viewer (three.js + Capacitor, CI build)" 2>&1 | ForEach-Object { "$_" } | ForEach-Object { Log "upload: $_" }
if ($LASTEXITCODE -ne 0) { Log "UPLOAD_FAILED exit=$LASTEXITCODE"; exit 1 }
Log "UPLOAD_OK"

$hdr = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$deadline2 = (Get-Date).AddMinutes(25)
$runId = $null
$runState = ""
while ((Get-Date) -lt $deadline2) {
    Start-Sleep -Seconds 20
    try { $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs?per_page=1" -Headers $hdr } catch { Log "runs poll error"; continue }
    $rr = @($runs.workflow_runs)
    if ($rr.Count -gt 0) {
        $run = $rr[0]
        $runId = $run.id
        if ($run.status -ne $runState) { $runState = $run.status; Log "run $($run.id): status=$($run.status) conclusion=$($run.conclusion)" }
        if ($run.status -eq "completed") { break }
    } else { Log "no runs yet" }
}
if (-not $runId) { Log "NO_RUN"; exit 1 }

try { $arts = Invoke-RestMethod -Uri "https://api.github.com/repos/SinigLi/splat-viewer/actions/runs/$runId/artifacts" -Headers $hdr } catch { Log "artifact list error: $($_.Exception.Message)"; exit 1 }
$art = @($arts.artifacts) | Select-Object -First 1
if (-not $art) { Log "NO_ARTIFACT - build probably failed, check run $runId"; exit 1 }
Log "artifact: $($art.name) size=$($art.size_in_bytes)"

$out = "F:\openclawhome\openclaw\fullstack_workspace\media\splat-apk-artifact.zip"
Invoke-WebRequest -Uri $art.archive_download_url -Headers $hdr -OutFile $out
Log "artifact downloaded: $((Get-Item $out).Length) bytes"

$dest = "F:\openclawhome\openclaw\fullstack_workspace\media\splat-apk"
Expand-Archive -Path $out -DestinationPath $dest -Force
$apk = Get-ChildItem $dest -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Log "NO_APK_IN_ARTIFACT"; exit 1 }
Log "apk extracted: $($apk.Name) $($apk.Length) bytes"

Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-bundle.zip" -Force
Log "BUNDLE_READY"
