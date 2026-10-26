# Release the extension (run on BI-1, Windows PowerShell 5.1):
#   powershell -NoProfile -File scripts\release-extension.ps1
# 1. Refuses unless HEAD == origin/main and extension/ is clean (the release
#    is always an exact pushed commit).
# 2. Runs the extension tests.
# 3. Publishes that commit to https://lap.ysho.uk (TZ repo lap-worker:
#    package-extension.py -> commit -> push as yonicc -> wrangler deploy),
#    unless LAP already serves this commit.
# 4. Verifies live: version.json commit == HEAD and the ZIP's SHA-256 matches.
# BI-1 itself loads the unpacked extension from this checkout (nothing to copy).
# YONI-PC / any Linux box then installs from LAP: scripts/install-from-lap.sh
param(
  [string]$TzRepo = 'C:\Users\dev\worktrees\tz-lap',   # any checkout/worktree of yonicc/tizkoret-ze
  [string]$Wrangler = 'C:\Users\dev\lashon-hara-guard\proxy\node_modules\.bin\wrangler.cmd'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
function Fail($m) { Write-Host "RELEASE FAILED: $m"; exit 1 }
function Git { & git @args; if ($LASTEXITCODE -ne 0) { Fail "git $args" } }

Set-Location $repo
$env:GH_TOKEN = (gh auth token --user yonicc)
try {
  Git fetch -q origin
  $head = (git rev-parse HEAD).Trim()
  $main = (git rev-parse origin/main).Trim()
  if ($head -ne $main) { Fail "HEAD $head is not origin/main $main - push (or pull) first" }
  if (git status --porcelain -- extension) { Fail 'extension/ has uncommitted changes' }
  $version = (Get-Content extension\manifest.json -Raw | ConvertFrom-Json).version
  Write-Host "Release: extension $version @ $head"

  Push-Location extension
  $ErrorActionPreference = 'Continue'
  node --test 2>&1 | Select-String -Pattern '^. (tests|pass|fail) '
  $testExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Pop-Location
  if ($testExit -ne 0) { Fail 'extension tests failed' }

  $live = $null
  try { $live = Invoke-RestMethod -UserAgent 'lhg-release' -Uri 'https://lap.ysho.uk/downloads/version.json' } catch { }
  if ($live -and $live.commit -eq $head) {
    Write-Host "LAP already serves $head - nothing to publish."
  } else {
    $wt = Join-Path $env:TEMP ('tz-lap-release-' + [DateTime]::Now.ToString('yyyyMMddHHmmss'))
    Git -C $TzRepo fetch -q origin
    Git -C $TzRepo worktree add --detach $wt origin/main
    try {
      Set-Location $wt
      & python lap-worker\package-extension.py $head
      if ($LASTEXITCODE -ne 0) { Fail 'package-extension.py failed' }
      Git add lap-worker/public/downloads/lap-extension.zip lap-worker/public/downloads/version.json
      $msg = Join-Path $env:TEMP 'lhg-lap-release-msg.txt'
      [IO.File]::WriteAllText($msg, "LAP download: publish extension $version (lashon-hara-guard $($head.Substring(0,7)))`n", (New-Object Text.UTF8Encoding $false))
      Git -c user.name=yoni -c user.email=yonicc@gmail.com commit -q -F $msg
      Git push -q origin HEAD:main
      Set-Location (Join-Path $wt 'lap-worker')
      $ErrorActionPreference = 'Continue'
      & $Wrangler deploy 2>&1 | Select-String -Pattern 'Current Version ID|Deployed|error' 
      $deployExit = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      if ($deployExit -ne 0) { Fail 'wrangler deploy failed' }
    } finally {
      Set-Location $repo
      & git -C $TzRepo worktree remove --force $wt 2>$null
    }
  }

  $v = Invoke-RestMethod -UserAgent 'lhg-release' -Uri 'https://lap.ysho.uk/downloads/version.json'
  $zip = Join-Path $env:TEMP 'lhg-lap-verify.zip'
  Invoke-WebRequest -UseBasicParsing -UserAgent 'lhg-release' -Uri 'https://lap.ysho.uk/downloads/lap-extension.zip' -OutFile $zip
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($v.commit -ne $head) { Fail "LAP serves $($v.commit), expected $head" }
  if ($hash -ne $v.sha256) { Fail "LAP zip sha256 $hash != version.json $($v.sha256)" }
  Write-Host "OK LAP: $($v.version) @ $($v.commit) sha256=$hash"
  Write-Host 'Next: on YONI-PC run  sudo bash scripts/install-from-lap.sh  (or via the runner), then reload the extension.'
} finally {
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
}
