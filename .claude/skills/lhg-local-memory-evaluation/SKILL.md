---
name: lhg-local-memory-evaluation
description: WHEN testing, installing or diagnosing Lashon Hara Guard local vector memory, its MV3 offscreen database, scoped retrieval tools or local embedding model import.
---

# LHG local memory evaluation

Read the project's AGENTS.md first. Source: https://github.com/yonicc/lashon-hara-guard.
On BI-1: C:\Users\dev\lashon-hara-guard. Follow git preflight and use an isolated worktree.
Read docs/36-extension-local-memory.md for the integration and docs/35-local-memory-ingestion-and-browser-test.md for the ingestion contract.

## Reproduce the browser checks

Run from the selected checkout; use synthetic content and a temporary browser profile.
In PowerShell, upload the following as a .ps1 with remote_write_file, then run
`powershell -NoProfile -File <script-path>`. Do not pass environment assignments through remote_exec.

```powershell
param([Parameter(Mandatory=$true)][string]$Checkout,
      [Parameter(Mandatory=$true)][string]$TransformersDir)
$ErrorActionPreference = 'Stop'
Set-Location $Checkout
node --test extension/*.test.cjs
if ($LASTEXITCODE -ne 0) { throw 'Extension tests failed' }
Set-Location research/local-memory
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed' }
$env:LHG_TRANSFORMERS_DIR = $TransformersDir
$env:LHG_IMPORT_MODEL = '1'
node extension-test.mjs
if ($LASTEXITCODE -ne 0) { throw 'MV3 integration failed' }
Remove-Item Env:LHG_IMPORT_MODEL
node browser-test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Browser memory regression failed' }
```

TransformersDir must be an installed @xenova/transformers 2.17.2 directory containing
.cache/Xenova/multilingual-e5-small and its four original model files.
The previously verified BI-1 location is:
C:\Users\dev\lhg-worktrees\rnd-ctx\research\vector-poc\node_modules\@xenova\transformers
Check that it still exists. browser-test.mjs uses installed Chrome (channel chrome);
extension-test.mjs uses Playwright Chromium. Read extension-results.json and the
browser test output; record browser version, counts, timings and external requests.
The MV3 harness currently asserts version 0.10.0; when evaluating a newer release,
review that assertion against manifest.json rather than treating it as a memory failure.

Verified baseline, 2026-10-28, commit 02bb47c (docs/36):
118 extension tests, 17 MV3 checks, 26 browser-memory checks.
2,000 synthetic records: full query p50 57.7ms / p95 64.3ms in the regression,
with zero external requests. These are historical measurements, not a quality SLA.
The MV3 harness redirects model downloads to loopback by default; it does not prove
external downloads work. LHG_IMPORT_MODEL=1 exercises the actual options folder picker.

## Install/diagnose in the user's browser

Reload the extension in chrome://extensions, then refresh the supported site.
In options, explicitly install the local search model, then enable local memory.
If YSHO blocks downloading, import a local directory containing:
config.json, tokenizer.json, tokenizer_config.json, onnx/model_quantized.onnx.
The prepared YONI-PC directory was:
/home/yoni/.local/share/lhg-models/multilingual-e5-small
Verify its presence; do not change filtering or copy browser profiles to obtain assets.

All four files must pass the pinned SHA-256 checks in memory-embedding.mjs.
The pinned revision is 761b726dd34fb83930e26aab4e9ac3899aa1fa78.
Inference uses cached model data only; there is no remote embedding fallback.

Validate draft ingestion/update/clear, collected mail context, Hebrew semantic retrieval,
account isolation, disabled memory and persistence after offscreen/browser restart.
The application binds scope before exposing get_recent({k}) and
search_history({query,top_k}); a model must not select an account or write records.
Missing reliable account identity skips memory and leaves ordinary checks working.
Use diagnostics without reading or committing real message content.

## Pitfalls and limits

- Store owner: extension-origin offscreen document; canonical code is extension/memory.mjs.
  Site-origin IndexedDB is not a shared extension vault.
- Cache.put rejects chrome-extension:// request keys; model cache keys use HTTPS.
- Distribution must include nested .mjs, vendor WASM and licenses. This evaluation
  skill does not itself authorize a release; follow AGENTS.md when a release is requested.
- Ingestion includes unsent drafts plus collected context. Retrieved text remains
  candidate/dom_observed, never a confirmed fact or a religious ruling.
- No trained router or automatic retrieval injection into /check was included in this baseline.
- DOM virtualization is not deletion; explicit site-deletion synchronization was not implemented.
  Retention is 14 days from first observation. Disabling does not erase data;
  the clear-memory action deletes text and vectors but retains model files.
- Synthetic fixtures establish integration behavior, not compatibility with every live DOM.
  Report live-site verification separately and never claim it from fixture tests.
