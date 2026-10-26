# 14 — Who / about whom / why ("analysis") — extension 0.6.0

The warning panel has a collapsed **"פרטים: מי, על מי ולמה"** button. It shows:
who is speaking, about whom, to whom (private / group / public), what is said or
implied about that person, why a reader may take it as disparaging, up to three
clarifying questions (purpose and benefit, first-hand and accurate, does the
listener need it), and how many earlier messages of the conversation were used.

## Flow and trust boundaries

- **Model** (`engine/src/extractor/brainSend.ts` prompt) returns an optional
  `analysis` object next to `meaning`/`directAssessment`.
- **Engine** (`validate.ts` → `validateAnalysis`) keeps only:
  `speakerRef`/`subjectRef` that are `self` or a participant ref from the
  request's ContextPacket; `subjectMention` only if it is a verbatim span of the
  message; short Hebrew strings clipped to `ANALYSIS_LIMITS`; audience from a
  fixed set; at most 3 questions. Anything else is dropped silently.
- **`alertFor` ignores `analysis`.** It is an explanation, never an input to the
  alert level and never a ruling.
- **Proxy** returns `analysis` and `contextMessages` (number of earlier messages
  in the packet; 0 = the message was checked alone).
- **Extension**: names never leave the browser. The packet carries refs
  (`self`, `p1`…); `context-runtime.js` `withLocalNames` maps the returned refs
  back to display names in-page (`context-builder.js` `displayForRef`), and
  `panel.js` `detailLines` renders them with `textContent` only.

## Limits

- Context exists only when the adapter found a stable conversation id
  (WhatsApp title; Google Chat `data-group-id`, unverified until the panel
  reports "מזהה השיחה זוהה"). Without it the details still show the mention /
  description, claim and why, and say the message was checked alone.
- Incoming-message tags do not show details yet (manual panel and outgoing only).

## Release

`scripts/release-extension.ps1` (BI-1) → tests, publish exact HEAD to
lap.ysho.uk, live verify; `scripts/install-from-lap.sh` (YONI-PC / Linux) →
install the published ZIP after SHA-256 check.
