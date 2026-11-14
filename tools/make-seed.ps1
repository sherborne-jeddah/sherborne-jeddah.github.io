# Builds _private\seed.sql from exported JSON documents (one file per record):
#   <ExportDir>\clubs\<id>.json  and  <ExportDir>\students\<id>.json
# Run: powershell -ExecutionPolicy Bypass -File tools\make-seed.ps1 -ExportDir <folder>
# The output contains student names: it lives in _private\ and is never committed.
param([Parameter(Mandatory = $true)][string]$ExportDir)
$out = Join-Path $PSScriptRoot '..\_private\seed.sql'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('-- CCA Planner data import. Run AFTER supabase/schema.sql, in the Supabase SQL Editor.')
[void]$sb.AppendLine('begin;')
foreach ($pair in @(@('clubs', 'cca_clubs'), @('students', 'cca_students'))) {
  $files = Get-ChildItem (Join-Path $ExportDir $pair[0]) -Filter *.json | Sort-Object Name
  [void]$sb.AppendLine("insert into public.$($pair[1]) (id, data) values")
  $rows = foreach ($f in $files) {
    $id = [IO.Path]::GetFileNameWithoutExtension($f.Name).Replace("'", "''")
    $json = (Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Depth 10 -Compress).Replace("'", "''")
    "  ('$id', '$json'::jsonb)"
  }
  [void]$sb.AppendLine(($rows -join ",`n"))
  [void]$sb.AppendLine('on conflict (id) do update set data = excluded.data, updated_at = now();')
  Write-Host "$($pair[0]): $($files.Count)"
}
[void]$sb.AppendLine('commit;')
[IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $out"
