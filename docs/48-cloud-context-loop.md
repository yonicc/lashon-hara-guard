# 48 — Shared cloud/local context loop

Owner decision: 2026-10-29. The /check wire contract may change without backward compatibility. Each follow-up is a new billed /check; account reservation and settlement remain per request.

## Protocol and ownership

`engine/src/needs.ts` owns Needs, validation, catalog question construction and local-head mapping. Proxy and the generated Ollama bundle consume it. Rebuild with `node scripts/build-ollama.mjs`; never edit bundles/dist.

Request: `round?: 1|2|3` (default 1), plus the ordinary message, confirmedFacts and sanitized ContextPacket. Invalid rounds are rejected. Response after extraction: `needs: {round,maxRounds:3,requests,questions}`.
There are at most two requests, with distinct bounded ids:
- `get_recent`, args `{n:1..20}`
- `search_history`, args `{query:string<=300,top_k:1..5}`

Unknown operations and unknown arguments are dropped, never executed. Scope, account, conversation, URLs and writes cannot be chosen by the model. Numeric positive integers are capped; malformed arguments are dropped. Questions are rebuilt from FACT_CATALOG (up to five unique unanswered ids, including explicit null answers as already answered), with exactly the existing factId/textHe/answers shape. Deterministic engine questions have priority over model questions. Existing rules.questions/question mirrors serve the unchanged batch-answer panel.

The cloud model chooses read requests and catalog fact ids in its extraction JSON. The proxy validates them after extraction and combines them with deterministic unanswered catalog facts. A pending request/question never produces none; draft findings can only raise warnings. Follow-ups bypass both cheap gate shortcuts so a low gate score cannot erase unresolved context.

## One executor and trust boundary

`extension/context-loop.js` runs in background for both cloud and local routes. It calls the existing memory-background admission and offscreen memory.mjs read tools, bound to the captured sender/account/conversation. It stops after three checks, repeated/no new excerpts, disabled memory, missing scope, a five-second retrieval timeout, or error. Failure preserves the last result/questions, never an approval. With memory disabled the existing catalog questions are shown immediately.

The original isolated content frame masks returned candidates with its captured builder.mergeMemory name/email/phone redaction and provenance tags. Background then calls canonical sanitizeContextPacket before the next check. Only selected excerpts fit the shared five-by-300 budget. Retrieved text never becomes confirmedFacts or primary-message evidence. No new results archive is introduced.

Content token liveness is checked before a request, after every response (including the final response), and around retrieval. Edited/detached/superseded elements and changed conversation/context abandon the loop; panel session guards remain active. Each loop has its own in-flight token; pending/stopped loops are not reusable cached approvals. Progress is indeterminate checking-round text in i18n.js, he/en. Batch answers still require explicit submission.

## Local limitations

The Ollama model is a narrow fact extractor (`alias:[bool,quote]`), not a tool-request model. Local needs are produced by router heads (mem_recent -> get_recent; mem_search -> search_history with the message as query; ask_user -> catalog questions) plus the deterministic engine's unanswered catalog facts. The optional router remains off by default and needs its pinned installed model. In local mode plan_context obtains heads without pre-retrieval; the common executor retrieves after the first result. Missing/failing router leaves deterministic questions.

The extractor consumes returned excerpts next round as untrusted ADDITIONAL CONTEXT through its existing render(). It was not trained with context; this is no quality/parity claim. Its evidence is still restricted to the primary message, and missing meaning assessment stays unresolved. GGUF/Ollama ids and the eight-fact trained contract were not changed. Model e10-v2 replacement is separate work.

## Verification commands

```text
npm --prefix engine run typecheck
npm --prefix engine test
npm --prefix proxy run typecheck
npm --prefix proxy test
cd extension; node --test
node scripts/build-ollama.mjs --check
node scripts/test-context-loop-browser.mjs C:\Users\dev\lhg-worktrees\browser-tools\package.json
node scripts/test-ollama-live.cjs
```

The Chromium test uses real MV3 scripts, service worker, offscreen IndexedDB and scoped get_recent; only the proxy and embedding vector used to seed synthetic memory are mocked. It verifies two cloud checks, masking, no foreign-conversation leakage, memory-off questions, and edited-draft cancellation. Existing Ollama browser/setup tests use a mocked server on 11434; stop Ollama first and restore it afterward, waiting until /api/tags returns the current model before the live smoke.

Verified on BI-1, 2026-10-29: engine 370 passed + one live skip; proxy 78 passed including workerd referral execution; extension 196 passed. Both typechecks and bundle freshness passed. Three new proxy regressions fail behaviourally on ca6aaed (pending needs returned none). Real Chromium also verifies queued incoming hold/progress labels do not invalidate their own check. Existing Ollama transport/setup Chromium suites passed; real Ollama 0.40.12/current Qwen GGUF smoke: four synthetic inputs, zero failures, real scores on three nonempty outputs. These checks establish protocol/transport, not model accuracy; the known narrow extractor error in docs/45 remains.
