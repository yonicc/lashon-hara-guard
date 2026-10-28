# Gmail send and read checks

Synthetic regression:
`node --test extension/*.test.cjs`

Real isolated MV3 Chromium regression (requires Playwright and its Chromium):
`node extension/gmail-browser.cjs <absolute-path-to-playwright-package>`

The browser harness uses a temporary profile, synthetic Gmail HTML and a mocked
/check response inside the extension worker. It never sends real mail or calls a
paid API. It checks early CSS cover before scanning, asynchronous expansion,
previous messages in the actual outgoing request, reuse after reload, send click,
duplicate suppression, warning approval and Ctrl+Enter. It does not establish
compatibility with the owner's live Gmail DOM or that an existing tab reloaded.

## History
Gmail scope uses the opened thread URL when message nodes lack a thread id.
Each prepare snapshots loaded bodies in DOM order before queueing. For incoming
mail, collection stops at the current body; for reply, all preceding mounted
bodies are candidates. The builder exports only five recent excerpts (300
characters each), preserving the existing packet/sanitizer contract. Full
captured history contributes to the local cache fingerprint. Older messages
beyond that packet budget are not all transmitted.

Collapsed handles are clicked once outside compose; scans, including the
settings-ready scan, wait up to two seconds for their bodies. A timeout does not
prove the missing text was loaded. A later mount changes the fingerprint and
requires a new check. A quote is used as a fallback when no prior bodies were
mounted; sender attribution is unknown in this fallback. No Gmail API access is
introduced. Changes to Gmail selectors require live validation.

## Send
Gmail's adapter resolves the button and compose within the same dialog/reply.
Capture listeners block click and Ctrl/Cmd+Enter while checking. Repeated send
attempts share the pending check. Text/context changes invalidate approval;
warnings require explicit Send anyway (or a new clear result after answering).
Errors do not release send. The button uses aria-busy and checking text because
the API supplies no measured progress percentage. No message text is rewritten.

## Read and cache
A document_start Gmail CSS guard hides unprocessed bodies until settings and
scanner state are available. Editable drafts and folder previews are excluded.
Loaded mail is checked on opening; chat baseline/burst behavior is preserved.
hideIncoming and platform/master switches control cover. Warning/error holds
offer reveal and explicit recheck.

Result reuse is in chrome.storage.local (the existing extension-local storage,
independent of the optional embedding memory), with SHA-256 keys including
recognized mailbox account, platform, conversation/message identity, complete
text, semantic context, answers, note, service credentials/URL and language.
Names/credentials are not stored in cache keys. Result explanations can contain
evidence, as documented in PRIVACY.md. Missing mailbox identity disables
persistent reuse. Pending requests with identical inputs share a promise.
Successful none/warn/unsure results can be reused for 14 days; errors and failed
rules are excluded. Maintenance after writes removes expired entries and keeps
at most 500. Explicit Check again bypasses reuse. Model/rule changes at the
server cannot be detected until expiry or explicit recheck.

## Installation verification
Read the Chrome profile's extension path and hash the files there; a git branch
or commit alone does not show what a loaded tab runs. BI-1 Profile 2 points to
the main checkout, not this worktree. This task does not copy, release, deploy,
bump the extension version, or merge to main. Existing tabs need an extension
reload and page refresh after a future authorized installation.
