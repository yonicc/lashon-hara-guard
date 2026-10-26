# Project instructions

## Git access
- Remote: https://github.com/yonicc/lashon-hara-guard (default branch: main).
- Push account: yonicc; commit identity: Yoni <yoni@citycar.co.il>.
- BI-1: set GH_TOKEN per command/script using gh auth token --user yonicc. Never switch the shared active account.
- Working directory: C:\Users\dev\lashon-hara-guard on BI-1.

## Scope and conventions
- Phase: the user approved building the MVP on 2026-10-26 (extension → proxy → Brain, see docs/11). Other proposed architecture is still not user-approved.
- Read README.md and docs/06-decisions.md before changes.
- Keep requirements, proposals, and questions distinct; preserve incoming-message scanning as a core user requirement.
- Religious/legal rules require exact sources and qualified review. Draft rules must never produce approved verdicts.
- Never infer that speaker presence, group size, or declared benefit alone permits a message.
- Missing context is unknown, never false. Store provenance, scope, and validity for facts.
- Use synthetic examples only. Do not commit messages, identities, tokens, or real relationship graphs.
- One rule has one canonical definition; adapters and UI consume it.

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
- Worker secrets: use `npx wrangler secret bulk <json outside repo>`. Piping a value into `npx wrangler secret put` in PowerShell 5.1 reports Success but stores a wrong value (every call then 401).

## Gate classifier on Modal (verified 2026-10-26, docs/12)
- The proxy asks the Modal gate (`classifier/serve_modal.py`, model v2 fp32) first; `p < LHG_GATE_THRESHOLD` (0.2) skips the model. Gate failure/timeout must always escalate to the model, so the gate can only save a call, never hide a message. Disable by removing `LHG_GATE_URL` from `proxy/wrangler.toml`.
- Modal CLI on BI-1: `py -m modal ...`, profile `yonicc` in `C:\Users\dev\.modal.toml`. Secret `lhg-gate` (GATE_KEY) == Worker secret `LHG_GATE_KEY`. Models live in Volume `lhg-models` (`/v1`, `/v2`). Do not set `min_containers` without the user's decision (always-on ≈ $2.6/day).
- Judge a gate model only on an INDEPENDENT eval set (`classifier/gen_eval.py`, another vendor/prompt, never trained on). Same-generator test scores were optimistic (v1: 0.986 own test vs 0.906 on Codex eval). Once an eval set has guided data changes, generate a fresh one.
- `serve_modal.py` must not use `from __future__ import annotations` (breaks `modal.parameter()`).
- brain-mcp's `/api/v1/chat/completions` codex branch drops `system_prompt` (fix in progress, child chat 2026-10-26); until verified fixed, put instructions in the user turn for `agent_kind=codex`.

## Concurrent agents
- More than one agent edits this repo at the same time (e.g. context layer vs gate). Always `git pull --ff-only` before editing, re-read a file before patching it, and stage only your own paths.
- Never edit a file containing Hebrew with `Set-Content -Encoding ascii` / raw PowerShell replace: it turns Hebrew into `?` (happened to `extension/manifest.json`, caught by `git diff`). Use `remote_edit_file`.

## Extension distribution
- WhatsApp selectors live only in `extension/selectors.js`. Never add a bare `#main header [title]`-style selector for the conversation title: it can match an icon button and give every chat the same key, mixing conversation context. The manual panel (Ctrl+Shift+L) shows what was detected (chat, visible messages, compose) and has a "copy diagnostics" button that copies DOM structure only (no message text) — ask the user for it when selectors fail.
- Google Chat inside Gmail runs in a separate `chat.google.com` IFRAME (verified on BI 2026-10-27 from the diagnostics button: `top:false`, host `chat.google.com`). The Google content script therefore needs `all_frames: true`, and only the focused frame answers the panel command (`panel.js` → `ownsCommand`). The chat compose box itself carries `g_editable` and `aria-multiline`, so the "exclude Gmail e-mail compose" filter may run only on `mail.google.com`.
- Source of truth is `extension/` in this repo (on BI-1). Every extension change must also be copied to the active unpacked copy on YONI-PC: `/home/yoni/lashon-hara-guard-gmail/extension` (Linux, user `yoni`; Chrome profile `Default`, extension id `naggldcglajoihfllgnboobgkfaknkoj`). Verify the copied files' SHA-256 match the repo's and that `manifest.json` parses.
- **Every extension release is also published to https://lap.ysho.uk (owner rule, 2026-10-27)** — the public download users install from. It is part of "done", not optional. After the extension commit is pushed: in a fresh worktree of `yonicc/tizkoret-ze` at `origin/main`, run `python lap-worker/package-extension.py <40-char sha of the pushed commit>` (builds the ZIP from that exact GitHub revision, runtime files only), commit `lap-worker/public/downloads/{lap-extension.zip,version.json}`, push as yonicc (`GH_TOKEN` per command; the private repo answers `Repository not found` to a fetch without it), then `wrangler deploy` in `lap-worker/`. Verify live: `https://lap.ysho.uk/downloads/version.json` shows the new version + commit, and the downloaded ZIP's SHA-256 equals its `sha256`. Details: TZ repo `docs/lap.md`. Bump `manifest.json` `version` on every release so users can see which build they have.
- Never copy secrets or the user's access key to YONI-PC; the options page stores it locally in that Chrome profile.
- The manual panel shortcut is a native Chrome command `open-panel` (manifest `commands`, default `Ctrl+Shift+L`); Chromium's command parser has no valid `Equal`/`Plus` key name, so never reintroduce `Ctrl+Shift++` as a Chrome command — the old in-page handler is only a non-zoom-safe fallback.
- After updating that directory, the user reloads the extension in `chrome://extensions` (there is no hot-reload for an unpacked extension whose `manifest.json` changed).
- Merely reopening Gmail/WhatsApp does not load new content scripts after a manifest change; reload the extension first, then refresh the supported page. Incoming messages never show an automatic popup: they only get an inline tag, while the shared manual panel opens with Ctrl+Shift+plus in the focused supported tab.
