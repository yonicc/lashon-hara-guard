# Zip a directory's contents with '/' entry separators (ZIP spec).
# Windows PowerShell 5.1 Compress-Archive writes 'vendor\x.mjs', which Firefox
# and AMO do not treat as a subdirectory path (verified 2026-11-08 on 0.17.7).
# Usage: powershell -NoProfile -File scripts/zip-forward-slash.ps1 <sourceDir> <zipPath>
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\', '/')
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
$zip = [System.IO.Compression.ZipFile]::Open($Destination, 'Create')
try {
  Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal')
  }
} finally { $zip.Dispose() }
$check = [System.IO.Compression.ZipFile]::OpenRead($Destination)
try {
  $bad = @($check.Entries | Where-Object { $_.FullName.Contains('\') })
  if ($bad.Count -gt 0) { throw ('backslash entry in zip: ' + $bad[0].FullName) }
  Write-Output ('zipped ' + $check.Entries.Count + ' entries with / separators')
} finally { $check.Dispose() }
