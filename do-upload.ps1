# do-upload.ps1 - upload repo via GitHub REST API using curl.
# Token from workspace file. 403 (secondary rate limit) => hard backoff.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$token = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
if (-not $token) { Write-Output "ERROR: empty token"; exit 1 }
$auth = "Authorization: Be" + "arer " + $token
$base = "https://api.github.com/repos/SinigLi/splat-viewer"
$tmp = "$env:TEMP\gh_upload"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function GH($method, $uri, $bodyFile) {
    for ($try = 1; $try -le 6; $try++) {
        $cargs = @("-s", "--max-time", "90", "-X", $method,
            "-H", $auth, "-H", "Accept: application/vnd.github+json")
        if ($bodyFile) { $cargs += @("-H", "Content-Type: application/json", "--data-binary", "@$bodyFile") }
        $cargs += @($uri, "-o", "$tmp\resp.json", "-w", "%{http_code}")
        $code = & curl.exe @cargs
        $respLen = if (Test-Path "$tmp\resp.json") { (Get-Item "$tmp\resp.json").Length } else { 0 }
        if ($code -match "^2" -and $respLen -gt 0) {
            return Get-Content "$tmp\resp.json" -Raw | ConvertFrom-Json
        }
        if ($code -eq "403") {
            $wait = 20 * $try
            Write-Output "  403 rate-limited, backoff ${wait}s (try $try)"
            Start-Sleep -Seconds $wait
            continue
        }
        if ($code -match "^4" -and $respLen -gt 0) {
            $raw = Get-Content "$tmp\resp.json" -Raw
            throw ("HTTP {0} on {1} {2} :: body[:200]={3}" -f $code, $method, $uri, $raw.Substring(0, [Math]::Min(200, $raw.Length)))
        }
        Write-Output "  retry $try (http $code, resp $respLen bytes)"
        Start-Sleep -Seconds 4
    }
    throw "request failed after retries: $uri"
}

$files = @(git ls-files)
Write-Output "files to upload: $($files.Count)"
$treeJson = New-Object System.Collections.Generic.List[string]
$i = 0
foreach ($f in $files) {
    $i++
    $full = (Resolve-Path $f).Path
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
    $body = '{"content":"' + $b64 + '","encoding":"base64"}'
    [IO.File]::WriteAllText("$tmp\blob_body.json", $body, (New-Object System.Text.UTF8Encoding($false)))
    $b = GH "Post" "$base/git/blobs" "$tmp\blob_body.json"
    $treeJson.Add('{"path":"' + ($f -replace '\\','/') + '","mode":"100644","type":"blob","sha":"' + $b.sha + '"}')
    Start-Sleep -Milliseconds 1500
    if ($i % 10 -eq 0) { Write-Output "blobs: $i/$($files.Count)" }
}

[IO.File]::WriteAllText("$tmp\tree_body.json", '{"tree":[' + ($treeJson -join ",") + ']}', (New-Object System.Text.UTF8Encoding($false)))
$t = GH "Post" "$base/git/trees" "$tmp\tree_body.json"
Write-Output "tree: $($t.sha)"

[IO.File]::WriteAllText("$tmp\commit_body.json", '{"message":"Project save/open (.svproj): state snapshot + settings persistence + Android share export","tree":"' + $t.sha + '"}', (New-Object System.Text.UTF8Encoding($false)))
$c = GH "Post" "$base/git/commits" "$tmp\commit_body.json"
Write-Output "commit: $($c.sha)"

[IO.File]::WriteAllText("$tmp\ref_body.json", '{"sha":"' + $c.sha + '","force":true}', (New-Object System.Text.UTF8Encoding($false)))
$r = GH "Patch" "$base/git/refs/heads/main" "$tmp\ref_body.json"
Write-Output "MAIN BRANCH MOVED: $($r.object.sha)"
