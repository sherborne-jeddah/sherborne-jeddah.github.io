# Makes the app icons from icons\crest-source.png (school crest on white).
# Run: powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\icons'
$src = [System.Drawing.Image]::FromFile((Join-Path $dir 'crest-source.png'))

function Make-Icon([int]$size, [string]$file, [double]$fill) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::White)
  $w = [int]($size * $fill); $h = [int]($w * $src.Height / $src.Width)
  $g.DrawImage($src, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h)
  $bmp.Save((Join-Path $dir $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Make-Icon 192 'icon-192.png' 0.86
Make-Icon 512 'icon-512.png' 0.86
Make-Icon 512 'icon-maskable-512.png' 0.66
Make-Icon 180 'apple-touch-icon.png' 0.82
$src.Dispose()
