---
name: lhg-firefox-release
description: WHEN building, validating or publishing the LHG Firefox extension or its AMO preparation ZIP to lhg.ysho.uk. Covers Firefox packaging, signing status and cross-repository publication; not Chrome releases or extractor/model changes.
---

# LHG Firefox release

BI-1 checkout: D:\projects\lashon-hara-guard (yonicc/lashon-hara-guard).
Read its AGENTS.md and docs/52-firefox.md first. That document owns
architecture, manifest constraints and known limitations; do not copy those
definitions here. Follow the project Git preflight and release branch agreed
with the owner; this skill does not authorize merging into main.

## Build and validate

From the LHG checkout, in PowerShell:

```powershell
node scripts/build-ollama.mjs --check
node --test extension/*.test.cjs
node scripts/build-firefox.mjs --check
node scripts/build-firefox.mjs
npx --yes web-ext lint --source-dir dist-firefox/stage
Get-ChildItem dist-firefox/lhg-firefox-*.zip
Get-FileHash dist-firefox/lhg-firefox-*.zip -Algorithm SHA256
```

Check each exit code. Build output must say FIREFOX BUILD OK.
--check stages/validates but produces no ZIP. Real build writes the versioned
ZIP and .sha256 sidecar; keep manifest.json at archive root.
The script owns public-build preparation and exclusions: do not hand-zip
extension/ or accidentally ship Chrome's manifest, offscreen document or the
unsupported threaded decider runtime. Both source manifest versions must match.

For a real Gecko selector smoke, use the installed Playwright package
(verified path below; locate an equivalent if moved):

```powershell
node scripts/test-selectors-firefox.mjs C:/Users/dev/lhg-worktrees/browser-tools/package.json
```

Selector fixtures and temporary add-on loading do not establish signed-in
Gmail/Chat/WhatsApp, actual embedding inference or Firefox Ollama support.
Use the manual checklist in docs/52-firefox.md and disclose unexecuted checks.
A VM-created Array can fail deepStrictEqual across realms despite equal
elements; normalize it with Array.from rather than weakening a runtime rule.

## Publish the exact pushed artifact

Commit/push the selected LHG revision, verify its remote SHA, then build from
that clean revision. Site code belongs to yonicc/tizkoret-ze, not lhg-proxy.
The verified site worktree was D:\projects\tz-firefox-publish; first read
its applicable AGENTS.md, docs/lap.md and lap-worker/package-firefox.py.

From that site's checkout, the verified packaging interface is:

```powershell
py lap-worker/package-firefox.py <absolute-versioned-zip-path> <pushed-LHG-commit-sha>
```

Follow docs/lap.md for the site's tests, commit/push and existing lap-worker
Wrangler deployment. Re-read the current deployment configuration rather
than assuming its branch or credentials. No proxy deployment is needed.

After deployment download /downloads/lhg-firefox.zip from https://lhg.ysho.uk
and hash the response bytes; compare with the local ZIP, then inspect
/downloads/firefox-version.json for the source SHA, version and signing status.
HTTP 200 alone is not verification. Report source/site SHAs and actual QA.

## Signing boundary

The preparation ZIP is unsigned; normal Firefox installation requires AMO
signing. Keep signed:false and the site's unsigned label until an actual
signed artifact exists. AMO Developer Hub submission/signing instructions
are in docs/52-firefox.md; API credentials belong to the owner, never the repo.
Publishing the preparation ZIP does not prove AMO submission or acceptance.

Verified 2026-10-31: 228 extension tests passed; Gecko 142.0.1 selector and
temporary-load checks passed; web-ext lint had zero errors with documented
warnings. AMO signing and authenticated-site/local-inference QA were not done.
