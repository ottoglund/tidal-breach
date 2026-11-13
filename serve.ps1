# Minimal local web server for Windows (no Python/Node needed).
# Usage (in the repo folder):  powershell -ExecutionPolicy Bypass -File .\serve.ps1
# Then open http://localhost:8000/game/   (Ctrl+C to stop)
# Serves only files under this folder, only on localhost. No external calls.
param([int]$Port = 8000)
$root = (Resolve-Path $PSScriptRoot).Path
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8';
  '.css'='text/css'; '.json'='application/json'; '.webp'='image/webp'; '.png'='image/png'; '.jpg'='image/jpeg';
  '.svg'='image/svg+xml'; '.md'='text/plain; charset=utf-8'; '.txt'='text/plain; charset=utf-8'; '.wasm'='application/wasm' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serving $root at http://localhost:$Port/game/  (Ctrl+C to stop)"
try {
  while ($l.IsListening) {
    $ctx = $l.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403 }
      else {
        if (Test-Path $path -PathType Container) {
          if (-not $ctx.Request.Url.AbsolutePath.EndsWith('/')) { $res.Redirect($ctx.Request.Url.AbsolutePath + '/'); $res.Close(); continue }
          $path = Join-Path $path 'index.html'
        }
        if (Test-Path $path -PathType Leaf) {
          $ext = [IO.Path]::GetExtension($path).ToLower()
          $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
          $bytes = [IO.File]::ReadAllBytes($path)
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else { $res.StatusCode = 404 }
      }
    } catch { $res.StatusCode = 500 }
    $res.Close()
  }
} finally { $l.Stop() }
