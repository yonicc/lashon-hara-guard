# 40 — Expanded fact-extractor and context-router dataset (round 2)

Date: 2026-10-29 · Status: research, human_review_pending · Owner decision required on two contract points before runtime use.

## Goal

Extend the local pipeline beyond the 8 toelet/speaker facts of docs/39 toward
the extractable subset of the 161-fact catalog (`rules/chafetz-chaim/facts.json`),
and expand the context router's training scenarios. This round builds training
data only — no training run, no deployment.

## Scope decision (from docs/32 group analysis)

The 177 sections split into groups A (37, message alone), B (5, recent
conversation), C (57, wider history/recipient), D (73, external/expert). Only
A/B/C facts that are **decidable from text or near conversation** are
templatable. Group D is intentionally excluded: no local text establishes it,
so it stays unknown and routes to ask_user / a rabbi referral (see below).

## What was built

### 1. Fact extractor v2 — `research/local-extractor/make_data_v2.py`, `contract_v2.json`

- `contract_v2.json`: **18 facts** (8 original + 10 new extractable `message.*`
  / `context.*`). New: `said_in_jest`, `is_hint`, `medium_written`,
  `same_self_disparagement`, `rumor_public`, `second_source`, `future_purpose`,
  `requested_disclosure`, `repeats_prior`, `subject_self_disclosed`.
- `train_v2.jsonl`: **2,104 rows** across he/en/mixed, deterministic
  (seed 20261029), same three-state semantics as v1 (explicit true / explicit
  false / unknown-omitted).
- Fact coverage verified: all 18 facts present, 163–210 rows each, pos/neg
  balanced (no fact skewed to one polarity).
- Excluded by design: `evidence.*`, `audience.*`, `subject.is_established_*`,
  and the expert-ruling group — these need external evidence, not text.

### 2. Context router v2 — `research/local-router/make_router_v2.py`

- `router_train_v2.jsonl`: 48 hand-authored template scenarios across 4 heads
  (`none` 12, `mem_recent` 12, `mem_search` 12, `ask_user` 12) in he+en.
- Each `ask_user` row carries a `propose_question` (the clarifying question the
  router may surface) and a `group_d_referral` note for cases whose resolution
  needs an external/expert ruling.
- This file is a **template seed**, not the full training set. The production
  router (docs/35) was trained on ~11k model-generated rows; scaling v2 to that
  size needs the same generate-translate-audit pipeline (English -> DictaLM ->
  blind audit), not more templates. See "Next".

## Two owner-decision contract points

### A. Question budget: 1 -> up to 5

The live `/check` contract (docs/18) and AGENTS.md rules 15 and 22 fix the
display to **at most one question** (`question?: {factId,textHe,answers:[כן/לא/
לא יודע]}`). The owner directed (2026-10-29) to raise this to **up to 5
questions**.

This is a **breaking wire change**, not a data change. It requires:
1. docs/18 contract: `question?` -> `questions?: [ {factId,textHe,answers}, ... up to 5 ]`.
2. `proxy/src/handler.ts` arbitration to surface multiple catalog-backed questions.
3. The extension panel UI to render and answer up to 5 questions.
4. Router `ask_user` head to rank/select which questions to ask within the cap.

**Not changed in this round** — the extension and proxy are built on the
one-question contract, and AGENTS.md says to ask the owner before touching it.
Flagged here so the owner can approve the multi-question contract change before
any runtime edit. The v2 data already supports multiple ask_user facts; the
cap is enforced downstream.

### B. Group D -> structured rabbi referral

The owner directed (2026-10-29): group D should produce **not a verdict** but a
structured question to a rabbi, carrying every fact already gathered.

- Today `rules.question` is a single user-facing yes/no/unknown prompt. Group D
  needs a different artifact: a referral packet (facts collected + the open
  halachic question) formatted for a qualified rabbi.
- v2 router data models this with the `group_d_referral` note on ask_user rows.
- A dedicated `referral` output type in the engine/panel is **future work** and
  needs an owner-approved design (what facts are bundled, how it is phrased,
  where it appears). Never auto-ruled.

## Caveats

- All data is synthetic, agent_reviewed, **human_review_pending**. Template data
  is not an independent benchmark (same-generator scores are optimistic).
- Extractor v2 facts are single-sentence explicit phrasings; real chat is
  messier. A model-generated natural round (like docs/39) is needed on top of
  these templates before the new facts are trusted.
- No training, no eval, no deployment performed this round.

## Next

1. Owner approves contract changes A and B.
2. Scale router v2 from 48 templates to ~thousands via the proven
   English->DictaLM->blind-audit pipeline (docs/70 in AGENTS.md), with a fresh
   independent holdout.
3. Run a natural (non-template) extractor round over the 18 v2 facts.
4. Only after independent eval: consider promoting any fact into the live extractor.
