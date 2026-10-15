$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = @{
    client_id   = "178c6fc778ccc68e1d6a"
    device_code = "01fdc09773cacb445c5846de41a2ab1453a065e3"
    grant_type  = "urn:ietf:params:oauth:grant-type:device_code"
} | ConvertTo-Json
[IO.File]::WriteAllText("$env:TEMP\devpoll_body.json", $body, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -s --max-time 30 -X POST -H "Accept: application/json" -H "Content-Type: application/json" --data-binary "@$env:TEMP\devpoll_body.json" https://github.com/login/oauth/access_token -o "$env:TEMP\devpoll3.json"
$j = Get-Content "$env:TEMP\devpoll3.json" -Raw | ConvertFrom-Json
if ($j.access_token) {
    [IO.File]::WriteAllText("$env:TEMP\gh_token.txt", $j.access_token, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "TOKEN_RECEIVED scope=$($j.scope)"
} elseif ($j.error) {
    Write-Output "STATUS: $($j.error)"
} else {
    Write-Output "UNEXPECTED"
}
