# test-write.ps1 - minimal write test: create a tiny blob
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$t = (Get-Content "F:\openclawhome\openclaw\fullstack_workspace\githubapi.txt" -Raw).Trim()
$h = @{}
$h["Authorization"] = "Be" + "arer " + $t
$h["Accept"] = "application/vnd.github+json"
try {
    $r = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/SinigLi/splat-viewer/git/blobs" -Headers $h -ContentType "application/json" -Body '{"content":"dGVzdA==","encoding":"base64"}' -TimeoutSec 60
    Write-Output "WRITE OK: blob $($r.sha)"
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $code = [int]$resp.StatusCode
        $reader = New-Object IO.StreamReader($resp.GetResponseStream())
        $body = $reader.ReadToEnd()
        Write-Output "WRITE FAIL: HTTP $code"
        Write-Output ($body.Substring(0, [Math]::Min(400, $body.Length)))
    } else {
        Write-Output "WRITE FAIL: $($_.Exception.Message)"
    }
}
# also check rate limit / token info
try {
    $rl = Invoke-RestMethod -Uri "https://api.github.com/rate_limit" -Headers $h -TimeoutSec 30
    Write-Output "core limit: $($rl.resources.core.remaining)/$($rl.resources.core.limit)"
} catch { Write-Output "rate_limit check failed" }
