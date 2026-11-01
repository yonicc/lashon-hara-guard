# Release the extension, Chrome AND Firefox (run on BI-1, Windows PowerShell 5.1):
#   powershell -NoProfile -File scripts\release-extension.ps1
# 1. Refuses unless HEAD == origin/main, extension/ is clean and both
#    manifests carry the same version (the release is always an exact pushed
#    commit).
# 2. Runs the extension tests, builds the Firefox ZIP of that same commit
#    (scripts/build-firefox.mjs) and lints it (web-ext lint, 0 errors).
# 3. Publishes BOTH browsers to https://lhg.ysho.uk in ONE lhg-site commit
#    (package-extension.py + package-firefox.py -> commit -> push as yonicc ->
#    one wrangler deploy), unless LAP already serves this commit for both.
#    One commit/deploy for both avoids the clobber trap (a deploy uploads the
#    whole public/downloads/ of the deploying checkout).
# 4. Verifies live: version.json and firefox-version.json name HEAD, and both
#    downloaded ZIPs' SHA-256 match (the Firefox one also the local build).
# Owner rule 2026-11-01: a release is not done until Firefox ships with Chrome.
# BI-1 itself loads the unpacked extension from this checkout (nothing to copy).
# YONI-PC / any Linux box then installs from LAP: scripts/install-from-lap.sh
param(
  [string]$SiteRepo = 'D:\projects\lhg-site',   # checkout of yonicc/lhg-site
  [string]$Wrangler = 'C:\Users\dev\lashon-hara-guard\proxy\node_modules\.bin\wrangler.cmd'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$site = 'https://lhg.ysho.uk/downloads'
function Fail($m) { Write-Host "RELEASE FAILED: $m"; exit 1 }
# NOT named "Git": PowerShell names are case-insensitive, so a function "Git"
# shadows git.exe and calls itself (call depth overflow).
function Invoke-Git { & git.exe @args; if ($LASTEXITCODE -ne 0) { Fail "git $args" } }
# Native tools write progress to stderr; run them with 'Continue' and judge
# by the exit code only.
function Invoke-Native([scriptblock]$cmd, [string]$pattern) {
  $ErrorActionPreference = 'Continue'
  $out = & $cmd 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($pattern) { $out | Select-String -Pattern $pattern | ForEach-Object { Write-Host $_.Line } }
  return $code
}
function Get-Json([string]$name) {
  try { return Invoke-RestMethod -UserAgent 'lhg-release' -Uri "$site/$name" -Headers @{ 'Cache-Control' = 'no-cache' } } catch { return $null }
}
function Get-LiveHash([string]$name) {
  $zip = Join-Path $env:TEMP ('lhg-verify-' + $name)
  Invoke-WebRequest -UseBasicParsing -UserAgent 'lhg-release' -Uri "$site/$name" -OutFile $zip
  $h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  Remove-Item $zip -ErrorAction SilentlyContinue
  return $h
}

Set-Location $repo
$env:GH_TOKEN = (gh auth token --user yonicc)
try {
  Invoke-Git fetch -q origin
  $head = (git rev-parse HEAD).Trim()
  $main = (git rev-parse origin/main).Trim()
  if ($head -ne $main) { Fail "HEAD $head is not origin/main $main - push (or pull) first" }
  if (git status --porcelain -- extension) { Fail 'extension/ has uncommitted changes' }
  $version = (Get-Content extension\manifest.json -Raw | ConvertFrom-Json).version
  $ffVersion = (Get-Content extension\manifest.firefox.json -Raw | ConvertFrom-Json).version
  if ($version -ne $ffVersion) { Fail "manifest.json $version != manifest.firefox.json $ffVersion" }
  Write-Host "Release: extension $version @ $head (Chrome + Firefox)"

  Push-Location extension
  $testExit = Invoke-Native { node --test } '^. (tests|pass|fail) '
  Pop-Location
  if ($testExit -ne 0) { Fail 'extension tests failed' }

  # Firefox build of the same commit (the script owns staging and exclusions).
  $ffZip = Join-Path $repo "dist-firefox\lhg-firefox-$version.zip"
  Remove-Item $ffZip -ErrorAction SilentlyContinue
  $buildExit = Invoke-Native { node scripts/build-firefox.mjs } 'FIREFOX BUILD|wrote|error'
  if ($buildExit -ne 0 -or -not (Test-Path $ffZip)) { Fail 'Firefox build failed' }
  $ffHash = (Get-FileHash $ffZip -Algorithm SHA256).Hash.ToLower()
  $lintExit = Invoke-Native { npx --yes web-ext lint --source-dir dist-firefox/stage --output json } ''
  if ($lintExit -ne 0) { Fail 'web-ext lint reported errors' }
  Write-Host "Firefox ZIP: $ffZip sha256=$ffHash (lint: 0 errors)"

  $live = Get-Json 'version.json'
  $liveFf = Get-Json 'firefox-version.json'
  if ($live -and $live.commit -eq $head -and $liveFf -and $liveFf.commit -eq $head -and $liveFf.sha256 -eq $ffHash) {
    Write-Host "LAP already serves $head for Chrome and Firefox - nothing to publish."
  } else {
    $wt = Join-Path $env:TEMP ('lhg-site-release-' + [DateTime]::Now.ToString('yyyyMMddHHmmss'))
    Invoke-Git -C $SiteRepo fetch -q origin
    Invoke-Git -C $SiteRepo worktree add --detach $wt origin/main
    try {
      Set-Location $wt
      & python package-extension.py $head
      if ($LASTEXITCODE -ne 0) { Fail 'package-extension.py failed' }
      & python package-firefox.py $ffZip $head
      if ($LASTEXITCODE -ne 0) { Fail 'package-firefox.py failed' }
      Invoke-Git add public/downloads
      $msg = Join-Path $env:TEMP 'lhg-lap-release-msg.txt'
      [IO.File]::WriteAllText($msg, "LAP download: publish extension $version, Chrome + Firefox (lashon-hara-guard $($head.Substring(0,7)))`n", (New-Object Text.UTF8Encoding $false))
      if (git status --porcelain -- public/downloads) {
        Invoke-Git -c user.name=yoni -c user.email=yonicc@gmail.com commit -q -F $msg
        Invoke-Git push -q origin HEAD:main
      }
      Remove-Item $msg -ErrorAction SilentlyContinue
      $deployExit = Invoke-Native { & $Wrangler deploy } 'Current Version ID|Deployed|error'
      if ($deployExit -ne 0) { Fail 'wrangler deploy failed' }
    } finally {
      Set-Location $repo
      & git -C $SiteRepo worktree remove --force $wt 2>$null
    }
  }

  $v = Get-Json 'version.json'
  $hash = Get-LiveHash 'lhg-extension.zip'
  if (-not $v -or $v.commit -ne $head) { Fail "LAP Chrome serves $($v.commit), expected $head" }
  if ($hash -ne $v.sha256) { Fail "LAP Chrome zip sha256 $hash != version.json $($v.sha256)" }
  Write-Host "OK LAP Chrome:  $($v.version) @ $($v.commit) sha256=$hash"

  $f = Get-Json 'firefox-version.json'
  $fHash = Get-LiveHash 'lhg-firefox.zip'
  if (-not $f -or $f.commit -ne $head) { Fail "LAP Firefox serves $($f.commit), expected $head" }
  if ($f.version -ne $version) { Fail "LAP Firefox version $($f.version) != $version" }
  if ($fHash -ne $f.sha256 -or $fHash -ne $ffHash) { Fail "LAP Firefox zip sha256 $fHash != firefox-version.json $($f.sha256) / local $ffHash" }
  Write-Host "OK LAP Firefox: $($f.version) @ $($f.commit) sha256=$fHash signed=$($f.signed)"
  Write-Host 'Next: on YONI-PC run  sudo bash scripts/install-from-lap.sh  (or via the runner), then reload the extension.'
} finally {
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
}
exit 0
