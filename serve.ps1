# 本地静态服务器（不依赖 npm/node，使用 PowerShell 内置 .NET HTTP 监听）
# 用法：在 PowerShell 中运行 .\serve.ps1，然后访问 http://localhost:5174

$port = 5174
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:${port}/")
$listener.Start()
Write-Host "FixelFlow 2 已启动：http://localhost:${port}/" -ForegroundColor Cyan
Write-Host "按 Ctrl+C 停止" -ForegroundColor Gray

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

try {
  while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response

    $urlPath = $req.Url.LocalPath
    if ($urlPath -eq '/') { $urlPath = '/index.html' }

    $filePath = Join-Path $root ($urlPath.TrimStart('/').Replace('/', '\'))

    # 依次查找：根目录 → public/ 子目录
    $publicPath = Join-Path $root ('public\' + $urlPath.TrimStart('/').Replace('/', '\'))
    if (-not (Test-Path $filePath -PathType Leaf) -and (Test-Path $publicPath -PathType Leaf)) {
      $filePath = $publicPath
    }

    if (Test-Path $filePath -PathType Leaf) {
      $ext     = [System.IO.Path]::GetExtension($filePath).ToLower()
      $mime    = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { 'application/octet-stream' }
      $bytes   = [System.IO.File]::ReadAllBytes($filePath)
      $resp.ContentType     = $mime
      $resp.ContentLength64 = $bytes.Length
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $resp.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
      $resp.OutputStream.Write($body, 0, $body.Length)
    }
    $resp.Close()
  }
} finally {
  $listener.Stop()
}
