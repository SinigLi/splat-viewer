$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$token = (Get-Content "$env:TEMP\gh_token.txt" -Raw).Trim()
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$base = "https://api.github.com/repos/SinigLi/splat-viewer"

# init main branch with a tiny README via contents API (handles empty repo)
$readmeB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("# splat-viewer`nMobile-first Gaussian Splat viewer APK (three.js + Capacitor)`n"))
$initBody = @{ message = "init"; content = $readmeB64; branch = "main" } | ConvertTo-Json
$initJson = [IO.File]::WriteAllText("$env:TEMP\init_body.json", $initBody, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -s --max-time 60 --retry 3 -X PUT -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$base/contents/README.md" --data-binary "@$env:TEMP\init_body.json" -H "Content-Type: application/json" -o "$env:TEMP\init_resp.json"
$initResp = Get-Content "$env:TEMP\init_resp.json" -Raw | ConvertFrom-Json
if (-not $initResp.commit) { Write-Output "INIT FAILED: $($initResp.message)"; exit 1 }
Write-Output "repo initialized, main at: $($initResp.commit.sha)"
