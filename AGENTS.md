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

## MVP runtime (verified 2026-10-26)
- Brain machine API base is `https://br.ysho.uk/dash` (without `/dash`: 401). Model call: `agent_kind=meta_api`, `muse-spark-1.3`, `reasoning_effort=minimal` (docs/10 §0).
- Proxy = Cloudflare Worker `lhg-proxy` (`proxy/`), deployed from BI-1 with `npx wrangler deploy` (wrangler logged in as yonicc). The extension's alert level is defined only in `proxy/src/handler.ts` `alertFor`.
- Worker secrets: use `npx wrangler secret bulk <json outside repo>`. Piping a value into `npx wrangler secret put` in PowerShell 5.1 reports Success but stores a wrong value (every call then 401).
