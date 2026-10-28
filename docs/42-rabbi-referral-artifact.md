# 42 — Structured rabbi-referral artifact for group-D sections

Date: 2026-10-29 · Status: implemented (engine + proxy + panel), `research/rabbi-referral` · Owner decision 2026-10-29 (docs/40 §B).

## 1. What this is

Of the 177 Chafetz Chaim sections, **73 are group D** (docs/32): they need
external evidence, an authorized/expert halachic ruling, or are not
representable as a message decision at all. No device-side context can decide
them.

**Owner's decision (2026-10-29):** group D does **not** produce a ruling. It
produces a **well-organized question to refer to a rabbi**, carrying every fact
already gathered.

This document is the design + implementation of that artifact.

## 2. The hard red line

A group-D section **NEVER auto-rules**. The engine never emits a verdict
(permitted/forbidden) for it, and the word "permitted" appears nowhere in the
referral path. Enforcement is in `engine/src/evaluate.ts` and is locked by
`engine/test/rabbiReferral.test.ts`.

Group D splits into two sub-kinds (from `sourceCoverage.json`):

| Sub-kind | Count | `disposition` | Behavior |
|---|---:|---|---|
| **blocked** | 12 | `blocked` | No implemented reminder at all → **only** a referral; the rule is skipped before any finding/question logic. |
| **partial** | 61 | `partial` + `chatFeasibility=external_evidence` | Has an implemented draft reminder for the part that IS checkable. The reminder may still fire (a reminder is not a ruling). A referral is emitted **in addition**, because the device cannot conclusively rule on the external-evidence branch. |

This distinction matters: 61 partial sections already produce useful draft
reminders today (cc-toelet, cc-speech, cc-rechilut…). Blocking them outright
would silently remove existing, reviewed reminder coverage. So the red line is
"never **conclusively ruled**", not "never reminded".

## 3. The artifact — `RabbiReferral`

Defined in `engine/src/types.ts`. One artifact per group-D section reached:

```
sectionKey      coverage key, e.g. "p1_prin1:2"
sourceRef       human citation (Chafetz Chaim, Part One, …, Principle 1:2)
sourceUrl       Sefaria URL (https only)
category        expert_ruling | external_evidence | not_representable | external_evidence_partial
questionHe      the open halachic question, phrased FOR a rabbi (a real "?", never a psak)
howToAskHe      one-line framing for the user
backgroundHe    card summary of the section
quotesHe        short quotes from the primary text (≤ 4)
gatheredFacts   every fact already gathered: {id, questionHe, valueHe (status+value), provenanceHe}
uncertainHe     the open points of doubt (card uncertainHe + coverage unimplementedHe + blocker reasonHe)
whyNotCheckedHe why the device cannot conclude this section
```

### Design choices

- **Which facts are bundled** — `gatheredFactsForReferral` (deterministic,
  sorted by id) includes every fact the check already holds with status
  `known` / `candidate` / `disputed`, each labeled with its **status** and
  **provenance** in Hebrew. Unknown facts are not listed (they are the open
  question, not evidence). This is exactly "the gathered details" the owner
  asked for — and it is *evidence for a rabbi*, never a computed verdict.
- **How the open question is phrased** — `openQuestionHe` is category-driven
  and always interrogative ("האם … וכיצד נוהגים?"). It never asserts an
  outcome. The phrasing is deterministic (no model call), driven by the
  reviewed `sourceCoverage.json` + rule cards.
- **Citations** — `sourceRef` + `sourceUrl` come straight from the coverage
  section; `quotesHe` from the rule card (`rules/chafetz-chaim/cards`).
- **Where it appears** — in the panel, as an expandable `<details>` packet
  under the rules box, visually distinct (amber, "🕮 שאלה לרב (לא פסק)"),
  **not** a yes/no/unknown prompt and with no answer buttons.

## 4. Implementation

- **`engine/src/chafetzChaim/referral.ts`** (new) — the deterministic builder.
  Loads the 73 group-D sections from `sourceCoverage.json` and the card
  summaries/quotes/doubts from `rules/chafetz-chaim/cards` (read at runtime,
  cached; `__setReferralData` is the test seam). Exposes `coverageKeyOfSource`,
  `isGroupDSource`, `groupDByKey`, `buildReferral`. Repo-root resolution walks
  up from the module and from `process.cwd()` so tsx/test runners work.
- **`engine/src/evaluate.ts`** — in the rule loop: a **blocked** group-D rule
  emits a referral and is skipped (no finding, no question). After the loop:
  any **partial** group-D section whose rule matched a finding or was left with
  an unresolved branch also emits a referral. Adds `referrals` to
  `EvaluationResult` and a `limitationsHe` note. Status logic unchanged — a
  referral is neither a user question nor a ruling, so it does not by itself
  force `needs_clarification`.
- **`proxy/src/rules.ts`** — `RulesResult.referrals?: RulesReferral[]` added
  **additively** to the fixed `/check` contract (the extension only renders it
  when present; nothing existing changed). `runLiveRules` maps the engine
  referrals through verbatim.
- **`extension/rules.js`** — `readRules` normalizes `rules.referrals`
  defensively (https-only `sourceUrl`, arrays capped, blank entries dropped).
- **`extension/panel.js`** — `appendReferrals` renders each referral as an
  expandable packet; `rulesVisible` and the `noFurtherNote` guard account for
  referrals. `appendReferrals` is internal to `appendRules`.
- **`extension/i18n.js` / `content.css`** — `referral.*` strings (en+he) and
  `lhg-referral*` styles.

## 5. Determinism & red-line tests

- `engine/test/rabbiReferral.test.ts` — group D is exactly the 73
  blocked/external_evidence sections; a blocked section yields a referral and
  never a finding; a partial section's reminder may fire yet still yields a
  referral; the referral carries gathered facts in deterministic order and
  contains no "permitted".
- `extension/rules.test.cjs` — a referral renders as "שאלה לרב (לא פסק)" with
  the question + gathered facts, **no** answer buttons, and no forbidden ruling
  word; malformed/blank referrals and non-https URLs are dropped.

Regression: engine 279/279, proxy 63/63, extension 129/129 (all green).

## 6. Open questions (for the owner / expert review)

1. **Wording review.** `openQuestionHe` / `howToAskHe` are deterministic
   templates. A qualified rabbi should review the exact Hebrew phrasing before
   this is shown to end users — the structure is fixed, the wording is a draft.
2. **Bundle scope.** Today `gatheredFacts` lists every known/candidate fact in
   the check. Should it be narrowed to facts *relevant to that section* (the
   section's `factsNeeded`), or is the full gathered set more useful to a rabbi?
3. **Multi-question budget.** The referral is independent of the one-question
   budget (docs/18). When contract point A (up to 5 questions, docs/40 §A) is
   approved, decide whether a referral counts against any display cap.
4. **Dedup across sections.** Several rules map to one section; a section emits
   at most one referral per check. Should multiple nearby sections ever be
   merged into a single rabbi question, or always kept separate?
5. **Persistence.** Should a surfaced referral be saved locally so the user can
   carry it out of the app (copy/print), and if so under what retention?
