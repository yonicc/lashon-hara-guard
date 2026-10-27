# Project instructions

## Git access
- Remote: https://github.com/yonicc/lashon-hara-guard (default branch: main).
- Push account: yonicc; commit identity: yonicc <yonicc@gmail.com> (owner's rule 2026-10-27; repo-local git config on BI-1 is set to it — commits before ea07a34 inclusive were made as Yoni <yoni@citycar.co.il> and were not rewritten).
- BI-1: set GH_TOKEN per command/script using gh auth token --user yonicc. Never switch the shared active account.
- Working directory: C:\Users\dev\lashon-hara-guard on BI-1.

## Scope and conventions
- Phase: the user approved building the MVP on 2026-10-26 (extension → proxy → Brain, see docs/11). Other proposed architecture is still not user-approved.
- Read README.md and docs/06-decisions.md before changes.
- Keep requirements, proposals, and questions distinct; preserve incoming-message scanning as a core user requirement.
- Religious/legal rules require exact sources and qualified review. Draft rules must never produce approved verdicts.
  **Owner's decision 2026-10-27 — state "live_draft":** the Chafetz Chaim draft pack `CC_ALL_DRAFT_PACK` (eight source-linked reminder packs, including the original to-elet pack) runs in the live `/check` flow as if approved (`evaluate(..., ruleMode:'live_draft')` → findings with `draft:true`; switch `LHG_CC_RULES=live|off`); expert review comes in a later improvement round. Hard limits stay: no ruling and never "permitted" — a rule may only raise the alert to `warn` (only in `alertFor`) or ask one question, never lower it to `none`; a missing fact is unknown, never false; a declared benefit alone permits nothing; an engine failure is `rules.notChecked=true` with the alert unchanged. The `/check` `confirmedFacts`/`rules` wire contract (docs/18) is fixed — the extension is built on it; ask the owner before changing it.
- Never infer that speaker presence, group size, or declared benefit alone permits a message.
- Missing context is unknown, never false. Store provenance, scope, and validity for facts.
- Use synthetic examples only. Do not commit messages, identities, tokens, or real relationship graphs.
- One rule has one canonical definition; adapters and UI consume it.
- After changing CC_ALL predicates, run from engine/: `node --import tsx ../scripts/refresh-coverage.mts`, then `--check`; it regenerates runtime bindings and docs22 from reviewed semantic notes. Edit limitations in sourceCoverage first; the generator cannot validate interpretation.
- The one-question budget covers the complete display: a catalog-backed `rules.question` consumes it, so suppress `analysis.questionsHe`; otherwise retain at most one analysis question. Keep the proxy arbitration and the panel's compatibility guard covered by regression tests.
- Exceptions use the same three-valued semantics as conditions: an unknown/disputed exception blocks that rule's finding and can require clarification; it is never an absent exception.
- Confidence admission lives in `extractor/factPolicy.ts`; both proposals and meaning must reject non-finite/out-of-range scores before conversion. Never clip provider scores into 0..1: clipping 2 to 1 promoted malformed meaning to known facts. Source integrity tests recompute hashes from section text, independently of card/manifest agreement.

## Context integration
- Canonical packet types/sanitizer: `engine/src/contextPacket.ts`; extractor types reference it. The proxy sanitizes before extraction. `user_confirmed` is the builder's explicit confirmation provenance; candidate/unknown never become false.
- Load DOM → store → builder → runtime before adapters. Capture packets before incoming queue delays so switching conversations cannot change a queued request's context. Names and DOM conversation keys stay local.
- Visible authors do not establish total audience size. Omit participantCount unless independently known. Google context requires a thread/space identity; otherwise retain single-message checks.
- Regression commands: `node --test extension/*.test.cjs`; in both `engine/` and `proxy/`: `npm run typecheck`, `npm test`. `proxy/test/contextIntegration.test.ts` exercises the real browser scripts through the Worker handler with a synthetic provider.

## MVP runtime (verified 2026-10-26)
- Worker server calls must use `redirect:'manual'` and explicitly reject 3xx:
  Cloudflare Workers does not implement `redirect:'error'` (it throws before
  making any request). Never follow redirects carrying partner credentials.
- Personal `lap_...` tokens are managed at `https://lap.ysho.uk` (TZ repo,
  `src/lap-access.js`). `proxy/src/accountAccess.ts` verifies/reserves via
  central LAP partner endpoints before extraction and captures/releases after.
  `LHG_ACCOUNT_KEY` is a Worker secret; no message text goes to accounts.
  Legacy access key remains valid for the owner's existing installation.
  Token revocation, current grants, funds and daily account quota are enforced
  centrally. Failed settlement returns 503 and leaves a hold for admin recovery.
- Brain machine API base is `https://br.ysho.uk/dash` (without `/dash`: 401). Model call: `agent_kind=meta_api`, `muse-spark-1.3`, `reasoning_effort=minimal` (docs/10 §0).
- Proxy = Cloudflare Worker `lhg-proxy` (`proxy/`), deployed from BI-1 with `npx wrangler deploy` (wrangler logged in as yonicc). The extension's alert level is defined only in `proxy/src/handler.ts` `alertFor`.
- Measuring extraction (`proposedFacts` are not in the /check response): run a temporary eval worker with `wrangler dev --remote -c <toml OUTSIDE the repo, name = "lhg-proxy">` — it gets the Worker's secrets; never `wrangler deploy` it. Harness and results: docs/20, `classifier/eval_facts.py`. Cloudflare answers a Python default User-Agent with 403/1010: always send `user-agent`.
- Worker secrets: use `npx wrangler secret bulk <json outside repo>`. Piping a value into `npx wrangler secret put` in PowerShell 5.1 reports Success but stores a wrong value (every call then 401).

## Gate classifier on Modal (verified 2026-10-26, docs/12)
- The proxy asks the Modal gate (`classifier/serve_modal.py`, model v2 fp32) first; `p < LHG_GATE_THRESHOLD` (0.2) skips the model. Gate failure/timeout must always escalate to the model, so the gate can only save a call, never hide a message. Disable by removing `LHG_GATE_URL` from `proxy/wrangler.toml`.
- Modal CLI on BI-1: `py -m modal ...`, profile `yonicc` in `C:\Users\dev\.modal.toml`. Secret `lhg-gate` (GATE_KEY) == Worker secret `LHG_GATE_KEY`. Models live in Volume `lhg-models` (`/v1`, `/v2`). Do not set `min_containers` without the user's decision (always-on ≈ $2.6/day).
- Judge a gate model only on an INDEPENDENT eval set (`classifier/gen_eval.py`, another vendor/prompt, never trained on). Same-generator test scores were optimistic (v1: 0.986 own test vs 0.906 on Codex eval). Once an eval set has guided data changes, generate a fresh one.
- Since 2026-10-27 the PRIMARY gate is Oracle (`classifier/oracle`, docs/16): container `lhg-gate` (cores 2-3, 2g, 127.0.0.1:8090) behind the `shiurim` tunnel path `/lhg-gate/*`; Modal is the fallback, then the model. Worker secret `LHG_GATE_ORACLE_KEY` == `GATE_KEY` in Oracle `/home/ubuntu/lhg-gate/gate.env`. Scoring in `classifier/oracle/server.py` duplicates `serve_modal.Gate._score` (max_length 96, strip): change both together.
- `serve_modal.py` must not use `from __future__ import annotations` (breaks `modal.parameter()`).
- brain-mcp's `/api/v1/chat/completions` codex branch drops `system_prompt` (fix in progress, child chat 2026-10-26); until verified fixed, put instructions in the user turn for `agent_kind=codex`.

## Concurrent agents
- More than one agent edits this repo at the same time (e.g. context layer vs gate). Always `git pull --ff-only` before editing, re-read a file before patching it, and stage only your own paths.
- Never edit a file containing Hebrew with `Set-Content -Encoding ascii` / raw PowerShell replace: it turns Hebrew into `?` (happened to `extension/manifest.json`, caught by `git diff`). Use `remote_edit_file`.

## Extension distribution
- WhatsApp selectors live only in `extension/selectors.js`. Never add a bare `#main header [title]`-style selector for the conversation title: it can match an icon button and give every chat the same key, mixing conversation context. The manual panel (Ctrl+Shift+L) shows what was detected (chat, visible messages, compose) and has a "copy diagnostics" button that copies DOM structure only (no message text) — ask the user for it when selectors fail.
- Google Chat inside Gmail runs in a separate `chat.google.com` IFRAME (verified on BI 2026-10-27 from the diagnostics button: `top:false`, host `chat.google.com`). The Google content script therefore needs `all_frames: true`, and only the focused frame answers the panel command (`panel.js` → `ownsCommand`). The chat compose box itself carries `g_editable` and `aria-multiline`, so the "exclude Gmail e-mail compose" filter may run only on `mail.google.com`.
- Source of truth is `extension/` in this repo (on BI-1). Every extension change must also be copied to the active unpacked copy on YONI-PC: `/home/yoni/lashon-hara-guard-gmail/extension` (Linux, user `yoni`; Chrome profile `Default`, extension id `naggldcglajoihfllgnboobgkfaknkoj`). Verify the copied files' SHA-256 match the repo's and that `manifest.json` parses.
- **Every extension release goes to three places (owner rule, 2026-10-27): BI-1, https://lap.ysho.uk (the public download) and YONI-PC.** It is part of "done", not optional. Bump `manifest.json` `version`, commit, push, then:
  1. BI-1: `powershell -NoProfile -File scripts\release-extension.ps1` — refuses unless HEAD == origin/main and `extension/` is clean, runs the extension tests, publishes that exact commit to LAP (TZ repo `lap-worker/package-extension.py <sha>` → commit/push as yonicc → `wrangler deploy`) and verifies live that `/downloads/version.json` names the commit and the ZIP's SHA-256 matches. BI-1's Chrome loads the unpacked extension from this checkout, so nothing else to copy there.
  2. YONI-PC (runner, as root): `bash scripts/install-from-lap.sh` — installs the published ZIP into `/home/yoni/lashon-hara-guard-gmail/extension` after the SHA-256 check, keeping a backup. (BI-1 has no SSH route to YONI-PC, so this step runs there.)
  3. The user reloads the extension and refreshes the tab. Manual fallback and details: TZ repo `docs/lap.md`. The private TZ repo answers `Repository not found` to a fetch without `GH_TOKEN` of yonicc.
- Never copy secrets or the user's access key to YONI-PC; the options page stores it locally in that Chrome profile.
- The manual panel shortcut is a native Chrome command `open-panel` (manifest `commands`, default `Ctrl+Shift+L`); Chromium's command parser has no valid `Equal`/`Plus` key name, so never reintroduce `Ctrl+Shift++` as a Chrome command — the old in-page handler is only a non-zoom-safe fallback.
- After updating that directory, the user reloads the extension in `chrome://extensions` (there is no hot-reload for an unpacked extension whose `manifest.json` changed).
- Merely reopening Gmail/WhatsApp does not load new content scripts after a manifest change; reload the extension first, then refresh the supported page. Incoming messages never show an automatic popup: they only get an inline tag, while the shared manual panel opens with Ctrl+Shift+plus in the focused supported tab.
