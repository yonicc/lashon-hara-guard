# 17 — Chafetz Chaim: source layer and draft rule cards

## Layers
1. **Source** — `sources/chafetz-chaim/` (commit 3f76fc0): Part One 1–10 + Part Two 1–9 from Sefaria,
   177 se'ifim, CC-BY-SA. `manifest.json` holds per se'if the exact `ref`, `url` and a text `sha256`.
2. **Rule cards** — `rules/chafetz-chaim/cards/<key>.json`: one card per se'if, drafted by
   `meta-models/muse-spark-open-1026` (Baseten, via the Brain `agent_kind=baseten`). Fields: `kind`,
   `titleHe`, `summaryHe`, `quotesHe` (verbatim), `appliesTo`, `conditionsHe`, `exceptionsHe`,
   `factsNeeded` (ids from `rules/chafetz-chaim/facts.json`), `proposedNewFacts`, `relevanceToChat`,
   `uncertainHe`, `reviewIssues`, `reviewStatus`.
3. **Engine rules** — `engine/src/chafetzChaim/allPacks.ts` exports `CC_ALL_DRAFT_PACK`:
   234 executable draft reminders in eleven packs, connected to `/check` in `live_draft` mode (final scope and blockers: docs/25).
   These source-linked conditions are warnings/clarifications, never approved religious rulings.
   Cards remain draft study material; linking a reminder does not implement every branch of its section.
   Per-section implementation limits and documentary branches: docs/22 and `sourceCoverage.json`.

## Guarantees (enforced by `engine/test/ccCards.test.ts`)
- Every se'if in the manifest has exactly one card; no orphan cards.
- `ref`/`url` equal the manifest; SHA-256 is recomputed from the actual section text (prefix 16,
  matching the importer) and compared with manifest and card, independently of their agreement.
  CC-07 mutates text without changing the manifest/card and verifies rejection. LF/CRLF are supported.
- Every card is `draft`. A model-drafted card is never reviewed/approved by a script.
- Every quote occurs in the se'if (niqqud-insensitive); the generator already dropped quotes that did not
  and recorded `quote_not_verbatim` in `reviewIssues`.
- `factsNeeded` uses only the vocabulary; unknown ids moved to `proposedNewFacts`.

## Run (2026-10-27)
- 177/177 cards, 0 failures, ~14–30 s per call, 6 workers, ~11 min end to end.
- kinds: prohibition 79, listener_duty 32, exception 25, condition 24, aggravation 8, definition 5, repair 4.
- relevanceToChat: high 135, medium 32, low 10. 508 verified quotes, every card has ≥1.
- 15 non-verbatim quotes dropped (13 cards) — those cards need a closer human look.
- Most needed facts: subject.identifiable (119), message.content_is_disparaging (75), rechilut report (67),
  may_be_understood_as_disparagement (62), toelet.purpose_is_constructive (59), listener.believes_report (58).
- 357 distinct proposed new facts — to be merged by hand into a small vocabulary, not adopted wholesale.

## Regenerate
```powershell
# token: a brk_ service token with chat:send, in a temp file OUTSIDE the repo, deleted after the run
$env:LHG_BRAIN_TOKEN_FILE = 'C:\Users\dev\lhg-tmp\brk.txt'
python -I rules\chafetz-chaim\gen_cards.py --workers 6          # resumable; skips cards whose text hash is unchanged
python -I rules\chafetz-chaim\gen_cards.py --only p1_prin10:2   # redraft one se'if
```

## Not included / open
- Petichah (lavin/asin/arurin), Be'er Mayim Chaim, Tziyurim — not in the source layer yet.
- Human review of cards and executable reminders. Vocabulary consolidation is implemented:
  161 canonical facts plus five lesson facts (docs/19 and docs/25); facts outside the catalog remain unknown.
- Documentary branches are tracked section by section in docs/22; legal/court classifications,
  source-specific missing predicates and post-event duties do not become automatic permits.
