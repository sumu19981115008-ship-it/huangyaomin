# serve.ps1 - static server + API (no node required)
# GET  /api/level-list   - returns sorted JSON array of level filenames
# POST /api/save-level   - saves body.data to levels/body.filename

$port = 5174
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:${port}/")
$listener.Start()
Write-Host "FixelFlow 2: http://localhost:${port}/" -ForegroundColor Cyan
Write-Host "Editor:      http://localhost:${port}/editor.html" -ForegroundColor Cyan
Write-Host "Ctrl+C to stop" -ForegroundColor Gray

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

function Send-Json($resp, $obj, $status = 200) {
  $json  = $obj | ConvertTo-Json -Compress -Depth 10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $resp.StatusCode      = $status
  $resp.ContentType     = "application/json; charset=utf-8"
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
}

try {
  while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response
    $urlPath = $req.Url.LocalPath

    # GET /api/level-list
    if ($urlPath -eq "/api/level-list" -and $req.HttpMethod -eq "GET") {
      $levelsDir = Join-Path $root "levels"
      $files = Get-ChildItem -Path $levelsDir -Filter "level*.json" |
        Where-Object { $_.Name -match "^level\d+\.json$" } |
        Sort-Object { [int]($_.BaseName -replace "\D","") } |
        Select-Object -ExpandProperty Name
      Send-Json $resp @($files)
      $resp.Close()
      continue
    }

    # POST /api/save-level
    if ($urlPath -eq "/api/save-level" -and $req.HttpMethod -eq "POST") {
      $reader  = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $bodyStr = $reader.ReadToEnd()
      $reader.Close()
      try {
        $body     = $bodyStr | ConvertFrom-Json
        $filename = $body.filename
        if ($filename -notmatch "^level\d+\.json$") {
          Send-Json $resp @{ error = "invalid filename" } 400
        } else {
          $fp       = Join-Path $root "levels\$filename"
          $dataJson = $body.data | ConvertTo-Json -Compress -Depth 20
          [System.IO.File]::WriteAllText($fp, $dataJson, [System.Text.Encoding]::UTF8)
          Send-Json $resp @{ ok = $true }
        }
      } catch {
        Send-Json $resp @{ error = $_.Exception.Message } 500
      }
      $resp.Close()
      continue
    }

    # Static files
    if ($urlPath -eq "/") { $urlPath = "/index.html" }
    $fp  = Join-Path $root ($urlPath.TrimStart("/").Replace("/", "\"))
    $fp2 = Join-Path $root ("public\" + $urlPath.TrimStart("/").Replace("/", "\"))
    if (-not (Test-Path $fp -PathType Leaf) -and (Test-Path $fp2 -PathType Leaf)) {
      $fp = $fp2
    }
    if (Test-Path $fp -PathType Leaf) {
      $ext   = [System.IO.Path]::GetExtension($fp).ToLower()
      $mime  = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($fp)
      $resp.ContentType     = $mime
      $resp.ContentLength64 = $bytes.Length
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $resp.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
      $resp.OutputStream.Write($b, 0, $b.Length)
    }
    $resp.Close()
  }
} finally {
  $listener.Stop()
}
