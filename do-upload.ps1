$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$token = (Get-Content "$env:TEMP\gh_token.txt" -Raw).Trim()
if (-not $token) { Write-Output "ERROR: empty token"; exit 1 }
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$base = "https://api.github.com/repos/SinigLi/splat-viewer"

function Invoke-GH($method, $uri, $bodyObj) {
    $json = if ($bodyObj) { $bodyObj | ConvertTo-Json -Depth 8 } else { $null }
    for ($try = 1; $try -le 4; $try++) {
        try {
            if ($json) { return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json }
            else { return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers }
        } catch {
            if ($try -eq 4) { throw }
            Write-Output "  retry $try : $($_.Exception.Message)"
            Start-Sleep -Seconds 4
        }
    }
}

$tree = @()
$files = @(git ls-files)
Write-Output "files to upload: $($files.Count)"
$i = 0
foreach ($f in $files) {
    $i++
    $full = (Resolve-Path $f).Path
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
    $b = Invoke-GH "Post" "$base/git/blobs" @{ content = $b64; encoding = "base64" }
    $tree += @{ path = ($f -replace '\\','/'); mode = "100644"; type = "blob"; sha = $b.sha }
    if ($i % 20 -eq 0) { Write-Output "blobs: $i/$($files.Count)" }
}

$t = Invoke-GH "Post" "$base/git/trees" @{ tree = @($tree) }
Write-Output "tree: $($t.sha)"

$c = Invoke-GH "Post" "$base/git/commits" @{ message = "Splat viewer: mobile-first Gaussian Splat viewer (three.js + Capacitor, CI build)"; tree = $t.sha }
Write-Output "commit: $($c.sha)"

try {
    $r = Invoke-GH "Post" "$base/git/refs" @{ ref = "refs/heads/main"; sha = $c.sha }
    Write-Output "MAIN BRANCH CREATED: $($r.object.sha)"
} catch {
    Write-Output "ref create failed, trying force-move"
    $r2 = Invoke-GH "Patch" "$base/git/refs/heads/main" @{ sha = $c.sha; force = $true }
    Write-Output "MAIN BRANCH MOVED: $($r2.object.sha)"
}
