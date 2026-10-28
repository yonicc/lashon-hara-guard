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

## What was built — v2 (seed 20261029, validator/manifest present)

### 1. Fact extractor v2 — `research/local-extractor/{make_data_v2.py, contract_v2.json, train_v2.jsonl, dev_v2.jsonl, holdout_v2.jsonl, manifest_v2.json, validate_v2.py, audit_v2.py}`

- `contract_v2.json`: **18 facts** (8 original + 10 new extractable `message.*`
  / `context.*`). New: `said_in_jest`, `is_hint`, `medium_written`,
  `same_self_disparagement`, `rumor_public`, `second_source`, `future_purpose`,
  `requested_disclosure`, `repeats_prior`, `subject_self_disclosed`. All canonical ids exist in `rules/chafetz-chaim/facts.json`.
- Generation: deterministic `make_data_v2.py --seed 20261029 --per-lang 800` → `train_v2.jsonl`.
  Three-state semantics (explicit true / explicit false / unknown-omitted, missing != false).
  Added: per-row `family` (fact-set + bucket), `provenance=synthetic_template(_contrast)`,
  `synthetic=true`, `agent_reviewed=false`, `human_review_pending=true`, `language in he/en/mixed`,
  `source=synthetic_templates_v2`, and **contrast rows** (quoted third-party / hypothetical / question) with empty gold.
- Family-grouped split (`split_v2.py --seed 20261029`): paraphrase/translation families never cross splits.
  `train_v2.jsonl` 1,916 rows / 1,805 families, `dev_v2.jsonl` 164 / 148, `holdout_v2.jsonl` 186 / 171.
  Languages balanced (633–648 per lang in train; similar in dev/holdout).
  Per-fact totals 163–210 pre-split; post-split detailed in `results/audit_v2.json`.
  Contrasts: 123 in train; unknown omitted never counted as false (validator checks).
- Validation (`validate_v2.py`): alias ∈ contract, canonical ∈ facts.json, evidence verbatim in text,
  synthetic/human_review_pending provenance, family + normalized-text disjoint across splits (0 overlap).
- Audit (`audit_v2.py` → `results/audit_v2.json` + `results/review_v2.csv`): per-split label counts,
  family overlap 0, text overlap 0, holdout **development** (author has seen it — not independent),
  36-row review export. `agent_reviewed` stays false until a synthetic verification pass runs.
- Hashes (from `manifest_v2.json`):
  - `train_v2` f45f0d126506698b3a64984021088a40e339953c119fac8ee8a080ad93572126
  - `dev_v2` 1880fcc0f01193ed6c7eb185fe6726676dfdb7921de5a261d4720f4c12ebba57
  - `holdout_v2` 25170a5d685a7a71e60cc219b953acb542893a082b8f33660d47876c31cf657f
- Excluded by design: `evidence.*`, `audience.*`, `subject.is_established_*`,
  and the expert-ruling group — these need external evidence, not text.
- Caveat: holdout is **development** — same seed/agent authored all splits. A truly independent
  holdout (different author/seed, never inspected) is still needed before claiming generalization.

### 2. Context router v2 — `research/local-router/{make_router_v2.py, router_train_v2.jsonl, router_dev_v2.jsonl, router_holdout_v2.jsonl, manifest_router_v2.json, split_router_v2.py}`

- `router_train_v2.jsonl` originally 48 hand-authored templates (4 heads × he/en). Now:
  74 rows total via `make_router_v2.py --seed 20261029 --emit-splits` — adds mixed-language
  variants and combo heads (`mem_recent+ask_user`), each row with `family`, `language in he/en/mixed`,
  `need` + `heads` (multi-head combos allowed), `provenance`, `synthetic=true`, `agent_reviewed=false`,
  `human_review_pending=true`, plus `propose_question`/`group_d_referral` on ask_user.
- Family-grouped split (`split_router_v2.py --seed 20261029`): text+family disjoint.
  `router_train_v2` 50 / 42 families, `router_dev_v2` 12 / 10, `router_holdout_v2` 12 / 10.
  All holdout is development (same author/seed).
- Hashes (manifest_router_v2.json):
  - `router_train_v2` 17bde2917fccafbe7da9d19e3719c9338eff970e038db84258e7ab41f02bc7e8
  - `router_dev_v2` 3d64e990c15fe87fac448ee1f6dc7d333b31feaa585cedad1347f6539ab204b7
  - `router_holdout_v2` 8de2288cd2cf8020a58855f7b062d26af3641bfaf4a9eb9f131cf2f59b05af0b
- This file remains a **template seed**, not the full training set. The production
  router (docs/35) used ~11k model-generated rows; scaling v2 to that
  size needs the same generate-translate-audit pipeline (English -> DictaLM ->
  blind audit), not more templates. Still `human_review_pending`.

## Provenance / review_status

All v2 rows: `provenance=synthetic_template(_contrast/_mixed/_combo)`, `synthetic=true`,
`human_review_pending=true`, `agent_reviewed=false` (no synthetic verification pass has run
that would justify true). Any row ever shown to the author for tuning is development,
not an independent benchmark. Do not present synthetic verification as human review.

## Data locations (worktree C:\Users\dev\worktrees\research\data-expansion-v2-20261028-215713)

- Extractor v2: `research/local-extractor/train_v2.jsonl` (1,916), `dev_v2.jsonl` (164), `holdout_v2.jsonl` (186) — contracts in `contract_v2.json`.
- Router v2: `research/local-router/router_train_v2.jsonl` (50), `router_dev_v2.jsonl` (12), `router_holdout_v2.jsonl` (12) — templates `make_router_v2.py`.
- Manifests: `research/local-extractor/manifest_v2.json`, `research/local-router/manifest_router_v2.json`.
- Validators: `research/local-extractor/validate_v2.py`, `split_v2.py`, `audit_v2.py`; router `split_router_v2.py`.
- Audit: `research/local-extractor/results/audit_v2.json`, `results/review_v2.csv` (36 sampled rows).

## Leakage prevention (AGENTS requirement)

- Split by `family` (paraphrases/translations/contrasts of the same fact set share a family).
  Family overlap train/dev/holdout = 0; normalized exact-text overlap = 0 (audit verified).
- Unknown is always omitted from gold, never false.
- No synthetic data is an independent benchmark until a fresh holdout by a different author/seed that was never inspected.

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

- All data is synthetic, **human_review_pending**, `agent_reviewed=false`. Template data
  is not an independent benchmark (same-generator scores are optimistic).
- Extractor v2 facts are single-sentence explicit phrasings; real chat is
  messier. A model-generated natural round (like docs/39) is needed on top of
  these templates before the new facts are trusted.
- Router v2 at 74 rows is a seed; production needs thousands via the EN->DictaLM->blind-audit pipeline before training.
- No training, no eval, no deployment performed this round.

## Next

1. Owner approves contract changes A and B.
2. Scale router v2 from 74 templates to ~thousands via the proven
   English->DictaLM->blind-audit pipeline (with a fresh independent holdout never inspected during data prep).
   Extractor v2 needs a natural-language round above the templates for the 10 new facts.
3. Only after independent eval: consider promoting any fact into the live extractor.
4. Training commands (father executes, not this branch):
   ```powershell
   # Extractor — LoRA on Modal (pilot_modal.py reads contract_v2 + train_v2/dev)
   # Adapt pilot_modal.py to read contract_v2.json (or pass --contract contract_v2.json) then:
   py -m modal run research/local-extractor/pilot_modal.py --tag e10-v2-20261030
   py research/local-extractor/score.py --tag e10-v2-20261030   # reports per-fact on dev_v2 + holdout as development diagnostics
   # Router — from research/local-router (existing train script, point at router_train_v2/dev)
   # See research/local-router/README and docs/35; holdout_v2 is development until a fresh independent set replaces it.
   ```
