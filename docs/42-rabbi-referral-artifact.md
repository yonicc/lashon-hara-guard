# 42 — Structured rabbi-referral artifact for group-D sections

Status: corrected after blocking merge review (engine + Worker + panel).
Original proposal: `research/rabbi-referral`; dataset decision reference:
`docs/40-fact-router-dataset-expansion.md` on
`research/fact-router-dataset-20261028` (main's docs/40 concerns GGUF research).

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
| **blocked** | 12 | `blocked` | No executable rules: source-card topic routing emits a referral independently of the rule loop. |
| **partial** | 61 | `partial` + `chatFeasibility=external_evidence` | Relevant rules emit a referral only; no findings, internal observations or yes/no questions from these rules, even if approved. |

The original implementation incorrectly allowed partial-D reminder findings.
The corrected guard applies to all 73 sections before findings, observations
and question planning, in every rule mode and review status.

Routing is conservative topic selection, not a ruling: at least one positive,
non-generic fact from the source card or rule must be present. Identity/fellow
status alone, false facts and unknown facts do not establish a topic.
Candidate/disputed positive facts can route a question but remain labelled as
such. Partial-D rules also require applicability not known false; blocked
sections have no executable applicability and use source-card topics directly.
Routing may intentionally include related sections; it does not claim an exact
halachic applicability decision. Non-CC packs do not receive blocked referrals.

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
quotesHe        source-card quotes, without silent truncation
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

- **`engine/src/chafetzChaim/referral.ts`** — deterministic builder using
  bundled `referralData.ts`. No runtime filesystem access. Regenerate from
  canonical coverage/cards with `cd engine; node --import tsx
  ../scripts/generate-referral-data.mts`; append `--check` to check freshness.
- **`engine/src/evaluate.ts`** — all group-D rules exit through the referral
  guard, independently of review status. Blocked topic routing runs outside
  the rule loop. Referrals are deduplicated by section and deterministically
  sorted. Pending referrals yield `needs_clarification`; other sections keep
  ordinary evaluation and their question budget.
- **`proxy/src/rules.ts`** — `RulesResult.referrals?: RulesReferral[]` added
  **additively** to the fixed `/check` contract (the extension only renders it
  when present; nothing existing changed). `runLiveRules` maps the engine
  referrals through verbatim.
- **`extension/rules.js`** — `readRules` normalizes `rules.referrals`
  defensively (https-only `sourceUrl`, blank entries dropped). All valid
  sections/facts/quotes/doubts survive normalization, without preview caps.
- **`extension/panel.js`** — `appendReferrals` renders each referral as an
  expandable packet; `rulesVisible` and the `noFurtherNote` guard account for
  referrals. `appendReferrals` is internal to `appendRules`.
- **`extension/i18n.js` / `content.css`** — `referral.*` strings (en+he) and
  `lhg-referral*` styles.
- **`proxy/src/handler.ts`** — a pending referral raises only a clean
  `none` to `unsure`; existing warnings and failures are preserved.

## 5. Determinism & red-line tests

- `engine/test/referralBoundary.test.ts` — positive boundary tests for every
  one of 73 sections, all rule modes/review statuses (including approved
  fixtures), and true/unknown/false applicability. Each of the 12 blocked
  sections must produce a referral through the real pack despite having no
  executable rule. Bundled data is compared with canonical coverage/cards.
- `engine/test/predicateFixture.ts` preserves dormant predicate regression
  coverage: it first asserts actual runtime referral boundaries, then evaluates
  synthetic non-CC copies to test predicate/exception/question semantics.
  These synthetic predicate outcomes are not live group-D behavior.
- `proxy/test/referralWorker.test.ts` bundles real `runLiveRules` with
  esbuild and executes it in workerd with the project's compatibility settings.
  It asserts successful blocked/partial referrals and absence of D findings.
- `extension/rules.test.cjs` — a referral renders as "שאלה לרב (לא פסק)" with
  the question + gathered facts, **no** answer buttons, and no forbidden ruling
  word; malformed/blank referrals and non-https URLs are dropped.

The extension completeness test preserves all 73 sections and 166 gathered
facts per section, plus quote/doubt lists beyond the old silent caps.

## 6. Open questions (for the owner / expert review)

1. **Wording review.** `openQuestionHe` / `howToAskHe` are deterministic
   templates. A qualified rabbi should review the exact Hebrew phrasing before
   this is shown to end users — the structure is fixed, the wording is a draft.
2. **Bundle scope.** Today `gatheredFacts` lists every known/candidate fact in
   the check. Should it be narrowed to facts *relevant to that section* (the
   section's `factsNeeded`), or is the full gathered set more useful to a rabbi?
3. **Multi-question budget.** Referrals are separate specialist artifacts,
   independent of the up-to-five catalog questions in docs/18 and docs/41.
   They have no yes/no answer buttons.
4. **Dedup across sections.** Several rules map to one section; a section emits
   at most one referral per check. Should multiple nearby sections ever be
   merged into a single rabbi question, or always kept separate?
5. **Persistence.** Should a surfaced referral be saved locally so the user can
   carry it out of the app (copy/print), and if so under what retention?
