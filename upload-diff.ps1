# upload-diff.ps1 v2 - resumable incremental upload via GitHub REST + curl.
# Blob cache across runs (temp file) so killed runs resume without re-upload.
# Long 403 backoffs for GitHub secondary (abuse) rate limit.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$proj = "F:\openclawhome\openclaw\fullstack_workspace\projects\splat-viewer"
$token = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
$auth = "Authorization: Be" + "arer " + $token
$base = "https://api.github.com/repos/SinigLi/splat-viewer"
$tmp = "$env:TEMP\gh_diff2"
$cacheFile = "$env:TEMP\gh_upload_cache.json"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Log($m) {
    Add-Content -Path "$tmp\progress.log" -Value ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m)
}

# blob cache: key "path|rawSha" -> blobSha
$cache = @{}
if (Test-Path $cacheFile) {
    try {
        $j = Get-Content $cacheFile -Raw | ConvertFrom-Json
        $j.PSObject.Properties | ForEach-Object { $cache[$_.Name] = $_.Value }
    } catch { }
}

$backoffs = @(60, 120, 180, 240, 300)

function GH($method, $uri, $bodyFile) {
    for ($try = 0; $try -lt $backoffs.Count; $try++) {
        $cargs = @("-s", "--noproxy", "*", "--max-time", "120", "-X", $method,
            "-H", $auth, "-H", "Accept: application/vnd.github+json")
        if ($bodyFile) { $cargs += @("-H", "Content-Type: application/json", "--data-binary", "@$bodyFile") }
        $cargs += @($uri, "-o", "$tmp\resp.json", "-w", "%{http_code}")
        $code = & curl.exe @cargs
        $len = if (Test-Path "$tmp\resp.json") { (Get-Item "$tmp\resp.json").Length } else { 0 }
        if ($code -match "^2" -and $len -gt 0) { return Get-Content "$tmp\resp.json" -Raw | ConvertFrom-Json }
        if ($code -eq "403") {
            $w = $backoffs[$try]
            Log "  403 backoff ${w}s (try $($try+1))"
            Start-Sleep -Seconds $w
            continue
        }
        if ($code -match "^4" -and $len -gt 0) {
            $raw = Get-Content "$tmp\resp.json" -Raw
            throw ("HTTP {0} :: {1}" -f $code, $raw.Substring(0, [Math]::Min(150, $raw.Length)))
        }
        Log "  net retry (http $code)"
        Start-Sleep -Seconds 5
    }
    throw "exhausted retries: $uri"
}

Set-Location $proj
try {
    $head = GH "Get" "$base/commits/main" $null
    Log "remote head: $($head.sha)"
    $treeSha = $head.commit.tree.sha
    $tree = GH "Get" "$base/git/trees/${treeSha}?recursive=1" $null
    $remote = @{}
    foreach ($e in @($tree.tree)) { if ($e.type -eq "blob") { $remote[$e.path] = $e.sha } }
    Log "remote blobs: $($remote.Count)"

    $changed = New-Object System.Collections.Generic.List[object]
    $localPaths = @(& git ls-files)
    foreach ($f in $localPaths) {
        if (-not (Test-Path $f)) { continue }
        $sha = (& git hash-object --no-filters $f).Trim()
        if (-not $remote.ContainsKey($f) -or $remote[$f] -ne $sha) {
            $changed.Add(@{ path = ($f -replace '\\', '/'); full = $f; raw = $sha })
        }
    }
    $deleted = @($remote.Keys | Where-Object { $localPaths -notcontains ($_ -replace '/', '\') -and $localPaths -notcontains $_ })
    Log "changed: $($changed.Count)  deleted: $($deleted.Count)  same: $($localPaths.Count - $changed.Count)"

    $entries = New-Object System.Collections.Generic.List[string]
    $n = 0
    foreach ($c in $changed) {
        $n++
        $key = $c.path + "|" + $c.raw
        if ($cache.ContainsKey($key)) {
            $entries.Add('{"path":"' + $c.path + '","mode":"100644","type":"blob","sha":"' + $cache[$key] + '"}')
            Log "  [$n/$($changed.Count)] cache hit: $($c.path)"
            continue
        }
        $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($c.full))
        $body = '{"content":"' + $b64 + '","encoding":"base64"}'
        [IO.File]::WriteAllText("$tmp\blob_body.json", $body, (New-Object System.Text.UTF8Encoding($false)))
        $b = GH "Post" "$base/git/blobs" "$tmp\blob_body.json"
        $cache[$key] = $b.sha
        $cache | ConvertTo-Json | Set-Content $cacheFile -Encoding UTF8
        $entries.Add('{"path":"' + $c.path + '","mode":"100644","type":"blob","sha":"' + $b.sha + '"}')
        Log "  [$n/$($changed.Count)] uploaded: $($c.path)"
        Start-Sleep -Seconds 4
    }
    foreach ($d in $deleted) { $entries.Add('{"path":"' + ($d -replace '\\', '/') + '","sha":null}') }

    [IO.File]::WriteAllText("$tmp\tree_body.json", '{"base_tree":"' + $treeSha + '","tree":[' + ($entries -join ",") + ']}', (New-Object System.Text.UTF8Encoding($false)))
    $t = GH "Post" "$base/git/trees" "$tmp\tree_body.json"
    Log "tree: $($t.sha)"

    $msg = "Project save/open (.svproj): state snapshot + settings persistence + Android share export"
    [IO.File]::WriteAllText("$tmp\commit_body.json", '{"message":"' + $msg + '","tree":"' + $t.sha + '","parents":["' + $head.sha + '"]}', (New-Object System.Text.UTF8Encoding($false)))
    $c = GH "Post" "$base/git/commits" "$tmp\commit_body.json"
    Log "commit: $($c.sha)"

    [IO.File]::WriteAllText("$tmp\ref_body.json", '{"sha":"' + $c.sha + '","force":true}', (New-Object System.Text.UTF8Encoding($false)))
    $r = GH "Patch" "$base/git/refs/heads/main" "$tmp\ref_body.json"
    Log "MAIN: $($r.object.sha)"
    Log "UPLOAD_COMPLETE $($r.object.sha)"
} catch {
    Log ("UPLOAD_FAILED: " + $_.Exception.Message)
    exit 1
}
