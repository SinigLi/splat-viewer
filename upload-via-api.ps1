param(
    [string]$Token = $env:GH_TOKEN,
    [string]$Message = "Splat viewer: initial import"
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Token) { Write-Output "ERROR: no token"; exit 1 }
$headers = @{ Authorization = "Bearer $Token"; Accept = "application/vnd.github+json" }
$base = "https://api.github.com/repos/SinigLi/splat-viewer"

function Invoke-GH($method, $uri, $bodyObj) {
    $json = if ($bodyObj) { $bodyObj | ConvertTo-Json -Depth 8 } else { $null }
    for ($try = 1; $try -le 3; $try++) {
        try {
            if ($json) {
                return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json
            } else {
                return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers
            }
        } catch {
            if ($try -eq 3) { throw }
            Write-Output "  retry $try : $($_.Exception.Message)"
            Start-Sleep -Seconds 5
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
    if ($i % 10 -eq 0) { Write-Output "blobs: $i/$($files.Count)" }
}

$t = Invoke-GH "Post" "$base/git/trees" @{ tree = @($tree) }
Write-Output "tree: $($t.sha)"

$c = Invoke-GH "Post" "$base/git/commits" @{ message = $Message; tree = $t.sha }
Write-Output "commit: $($c.sha)"

try {
    $r = Invoke-GH "Post" "$base/git/refs" @{ ref = "refs/heads/main"; sha = $c.sha }
    Write-Output "MAIN BRANCH CREATED: $($r.object.sha)"
} catch {
    $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
    Write-Output "REF POST failed ($code), fallback"
    if ($code -eq 422) {
        $r2 = Invoke-GH "Patch" "$base/git/refs/heads/main" @{ sha = $c.sha; force = $true }
        Write-Output "MAIN BRANCH MOVED: $($r2.object.sha)"
    } else {
        $initBody = @{ message = "init"; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("splat-viewer")); branch = "main" } | ConvertTo-Json
        Invoke-RestMethod -Method Put -Uri "$base/contents/README.md" -Headers $headers -ContentType "application/json" -Body $initBody | Out-Null
        Write-Output "repo initialized via contents API"
        $r2 = Invoke-GH "Patch" "$base/git/refs/heads/main" @{ sha = $c.sha; force = $true }
        Write-Output "MAIN BRANCH MOVED: $($r2.object.sha)"
    }
}
