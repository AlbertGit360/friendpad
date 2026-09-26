# Minimal static file server for Friendpad (no Python/Node needed). Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8000]
param([int]$Port = 8000)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.gif'='image/gif';
  '.ico'='image/x-icon'; '.md'='text/plain; charset=utf-8'; '.ts'='text/plain; charset=utf-8' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Host "Could not start on port $Port : $($_.Exception.Message)" -ForegroundColor Red; Read-Host 'Press Enter to exit'; exit 1 }
Write-Host "Friendpad running at http://localhost:$Port/  (Ctrl+C to stop)" -ForegroundColor Green
Start-Process "http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $path.StartsWith($root) -or -not (Test-Path $path -PathType Leaf)) {
      $res.StatusCode = 404; $b = [Text.Encoding]::UTF8.GetBytes('Not found')
    } else {
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $b = [IO.File]::ReadAllBytes($path)
    }
    $res.ContentLength64 = $b.Length
    $res.OutputStream.Write($b, 0, $b.Length)
    Write-Host "$($res.StatusCode) /$rel"
  } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
  finally { $res.OutputStream.Close() }
}
