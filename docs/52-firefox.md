# Firefox (AMO) build

Branch `feat/firefox-mv3` (2026-10-31). The extension is MV3 on both
browsers from one `extension/` tree: Chrome loads `manifest.json`
(service worker), Firefox loads a renamed copy of
`manifest.firefox.json` (event page). Both manifests MUST carry the
same `version` (`firefox-build.test.cjs` fails otherwise).

Project home on BI-1: `D:\projects\lashon-hara-guard`
(moved from `C:\Users\dev\lashon-hara-guard` on 2026-10-31; the C:
checkout stays until its in-progress work lands — do not delete it).

## Manifest map (Chrome -> Firefox)

| Chrome (`manifest.json`) | Firefox (`manifest.firefox.json`) |
|---|---|
| `background.service_worker` | `background.scripts` (event page, real document) |
| `permissions: [..., "offscreen"]` | `permissions: ["storage", "tabs"]` |
| `host_permissions: [...]` (install-time) | `optional_host_permissions: [...]` (opt-in, same 4 origins incl. `http://127.0.0.1:11434/*`) |
| `options_page` | `options_ui` (`open_in_tab: true`) |
| `minimum_chrome_version` | `browser_specific_settings.gecko`: id `lhg@ysho.uk`, `strict_min_version` 140.0 |
| everything else (commands, content_scripts, action, CSP) | identical |

Why 140: Mozilla's built-in data consent starts at Firefox 140. New AMO
submissions require `data_collection_permissions`; this build declares
personalCommunications, authenticationInfo and websiteContent because
message checks/context and the user's access token leave the browser.
Source: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/

## Background scripts order (hard rule)

A Firefox event page has no `importScripts`, so `background.scripts`
lists the dependency chain explicitly IN ORDER, `background.js` last.
It must mirror the `importScripts` chain at the top of `background.js`
exactly; the committed test extracts that chain and compares. When the
chain changes, update `manifest.firefox.json` in the same commit.

## Offscreen bypass

`memory-background.js` detects Firefox positively
(`browser.runtime.getBrowserInfo`, which Chrome and Node never define)
and relays memory ops to `memory-firefox.mjs` via dynamic `import()`
instead of creating an offscreen document. Sender/setting admission is
unchanged and stays in `memory-background.js`; the handler module
registers no message listener. The Chrome/offscreen path is untouched.

## Permissions opt-in UX

`extension/permissions.js` (`LHG_PERMISSIONS`) wraps
`permissions.contains/request` (promise form first, callback fallback).
The options page shows a `permCard` section ONLY on Firefox with one
"grant host access" button requesting the four optional origins.
Call request before any awaited contains check to preserve user activation.
Limitation: only the declared origins can ever be granted, so a custom
`proxyUrl` host does not work in the Firefox build (documented gap).

## WASM: single-threaded only

Extension pages have no cross-origin isolation, hence no
SharedArrayBuffer. The embedding (`memory-embedding.mjs`) and router
(`memory-router-model.mjs`) loaders already pin `numThreads=1` and
`proxy=false` with the non-threaded ORT 1.14.0 binaries — no change.
The optional local meaning decider is EXCLUDED from the Firefox build:
its runtime is a threaded JSEP build (`vendor/decider/*`, ~22 MiB) that
cannot instantiate without threads. `memory-firefox.mjs` fails decider
ops closed (`decider-unsupported-firefox`); the options page names the
gap (`perm.deciderUnsupported`). Future work: ship a verified
non-threaded JSEP pair and let the runtime pick it per browser.

## Build

```
node scripts/build-firefox.mjs [--check] [--out <dir>]
```

Stages to `dist-firefox/` (git-ignored): copies `extension/` minus
tests (`*.test.cjs`, `*.testlib.cjs`), Chromium helpers
(`gmail-browser*.cjs`), the dev doc, `memory-offscreen.*`, the
`decider-*.mjs` modules and `vendor/decider/`; writes
`manifest.firefox.json` as `manifest.json`; validates (manifest parity,
every background/content/options file staged, no `threaded` payload, no
SharedArrayBuffer-capable runtime, WASM pins present); zips to
`dist-firefox/lhg-firefox-<version>.zip` + `.sha256` sidecar.
`--check` validates without zipping. The staged check-mode.js sets
LHG_PUBLIC_BUILD=true, matching the site's public Chrome distribution.

## AMO signing route (manual)

1. Build the zip above from a clean, pushed commit.
2. Sign with `web-ext sign` (API key/secret from AMO Developer Hub, held
   by the owner — never commit them):
   `npx web-ext sign --source-dir dist-firefox/stage/ --api-key ... --api-secret ...`
   or upload the zip manually in the AMO Developer Hub (review queue).
3. Distribute the signed `.xpi` / AMO listing. Source transparency: the
   repo is the source of truth; Transformers.js/ORT ship with their
   LICENSE files; no remote code, no minified first-party code.

## QA

Automated: `node --test extension/*.test.cjs` (includes `firefox-build.test.cjs`
manifest/packaging/static-WASM assertions and the `detection.test.cjs`
selector suite over fixtures), plus
`node scripts/test-selectors-firefox.mjs <playwright-package.json>`
(real Gecko `querySelector` run over the same selector surface).
Manual checklist before AMO upload: install signed build, grant host
access in Settings, cloud check on Gmail/Chat/WhatsApp, memory install
+ viewer, local Ollama mode (needs Ollama + `OLLAMA_ORIGINS` for the
`moz-extension://` origin), options/commands smoke.

## Known gaps (Firefox v1)

## Verified QA (2026-10-31)

- The initial lone failure was `firefox host permissions are opt-in and match
  the request helper`: Node strict equality rejected the VM realm's Array
  prototype, despite identical values. Array.from normalizes it; no runtime
  change was needed for that failure.
- 227/227 extension tests passed after that correction. A further regression
  covers the synchronous Firefox permission request/user-gesture requirement.
- Real Playwright Firefox 142.0.1 compiled all 100 platform selectors and
  matched synthetic WhatsApp compose/incoming and Chat compose fixtures.
- web-ext 10.8.0 installed the staged build as a temporary add-on in real
  Firefox 142.0.1 headless successfully. This proves loading, not signed-in
  website checks or embedding-model inference.
- web-ext lint: zero errors. Review warnings remain for the unreachable
  Chrome offscreen branch and eval/Function inside bundled Transformers.js.
  Android 140 consent warning is outside this desktop-only release scope.
- Real-account Gmail/Chat/WhatsApp, actual embedding/router inference and
  live Firefox Ollama requests were NOT executed. AMO signing/review remains
  manual; the public download is explicitly an unsigned AMO-source ZIP.
- Known duplication retained to keep the Chrome owner unchanged: operation
  dispatch in memory-firefox.mjs mirrors memory-offscreen.mjs. Future changes
  must update both until a shared owner module is extracted.

## Remaining limitations

- Optional local meaning decider unsupported (threaded runtime).
- Custom `proxyUrl` hosts cannot be granted (only declared origins).
- Untested on real Gmail/WhatsApp/Chat DOM in Firefox (needs logged-in
  manual pass); selectors are engine-neutral standard CSS + DOM APIs.
