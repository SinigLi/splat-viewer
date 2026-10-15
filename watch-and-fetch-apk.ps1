$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$log = "F:\openclawhome\openclaw\fullstack_workspace\projects\splat-viewer\watcher2.log"
function Log($m) { try { ("{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $m) | Add-Content -Path $log } catch {} }
Log "watcher2 started, waiting for authorization"

# 1) poll for token (device flow)
$deviceCode = "4bbd7e013ea3751253447d795f80df8f8a58d666"
$clientId = "178c6fc778ccc68e1d6a"
$deadline = (Get-Date).AddMinutes(14)
$token = $null
while ((Get-Date) -lt $deadline -and -not $token) {
    Start-Sleep -Seconds 6
    $body = @{ client_id = $clientId; device_code = $deviceCode; grant_type = "urn:ietf:params:oauth:grant-type:device_code" } | ConvertTo-Json
    [IO.File]::WriteAllText("$env:TEMP\devpoll_body.json", $body, (New-Object System.Text.UTF8Encoding($false)))
    curl.exe -s --max-time 30 -X POST -H "Accept: application/json" -H "Content-Type: application/json" --data-binary "@$env:TEMP\devpoll_body.json" https://github.com/login/oauth/access_token -o "$env:TEMP\devpoll4.json"
    try { $j = Get-Content "$env:TEMP\devpoll4.json" -Raw | ConvertFrom-Json } catch { Log "poll parse error"; continue }
    if ($j.access_token) { $token = $j.access_token; Log "TOKEN_RECEIVED scope=$($j.scope)" }
    elseif ($j.error -eq "authorization_pending") { }
    elseif ($j.error -eq "slow_down") { Start-Sleep -Seconds 5 }
    elseif ($j.error) { Log "FLOW_ERROR: $($j.error)"; break }
}
if (-not $token) { Log "NO_TOKEN (timeout or error)"; exit 1 }
[IO.File]::WriteAllText("$env:TEMP\gh_token.txt", $token, (New-Object System.Text.UTF8Encoding($false)))
Log "token saved to file"

# 2) download artifact 11948423805 (fixed APK, run 38682314859)
$outZip = "$env:TEMP\sv_fixed_artifact.zip"
curl.exe -sL --max-time 180 --retry 3 -H "Authorization: Bearer $token" "https://api.github.com/repos/SinigLi/splat-viewer/actions/artifacts/11948423805/zip" -o $outZip
$sz = (Get-Item $outZip).Length
Log "artifact downloaded: $sz bytes"
if ($sz -lt 100000) { Log "DOWNLOAD TOO SMALL - auth likely failed"; exit 1 }

# 3) extract + find apk
$tmp = "$env:TEMP\sv_fixed_apk"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $outZip -DestinationPath $tmp -Force
$apk = Get-ChildItem $tmp -Filter *.apk -Recurse | Select-Object -First 1
if (-not $apk) { Log "NO_APK_IN_ARTIFACT"; exit 1 }
Log "apk: $($apk.Name) $($apk.Length) bytes"

# 4) wrap in plain zip for Feishu
Copy-Item $apk.FullName "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed.apk" -Force
Compress-Archive -Path $apk.FullName -DestinationPath "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed-bundle.zip" -Force
$fin = Get-Item "F:\openclawhome\openclaw\fullstack_workspace\media\splat-viewer-fixed-bundle.zip"
Log "BUNDLE_READY: $($fin.Name) $($fin.Length) bytes"
