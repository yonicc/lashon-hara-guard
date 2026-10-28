# 40 — Expanded fact-extractor (18 facts) and context-router data (v2.1)

Date: 2026-10-28 · Status: research data, synthetic, **human_review_pending** · No training, no deployment.

This round prepares data only. Training is run separately (commands at the end).

## Scope

The extractor grows from the 8 toelet/speaker facts (docs/38-39) to the 18 that can be decided from the message or
the near conversation: the original 8 + 10 `message.*` / `context.*` facts. Group D facts (external evidence,
expert ruling) are excluded on purpose. No local text establishes them, so they stay unknown.
The router keeps its 6 learned labels (`classifier/router/labels.json`, docs/35). This round adds data for the rare
labels and their combinations, and that is where the 10 new facts' context needs (prior report, rumour,
self-disclosure, purpose, relationship) land.

## Extractor v2.1 — `research/local-extractor/`

| file | role |
|---|---|
| `contract_v2.json` | 18 aliases → canonical ids in `rules/chafetz-chaim/facts.json`, definitions aligned with each `questionHe` |
| `make_data_v2.py` → `all_v2.jsonl` | deterministic template source (seed 20261029), split fixed per semantic unit; `--check` rebuilds |
| `gen_natural_modal.py --contract-file contract_v2.json` → `diverse/natural_v2.jsonl` | natural round (Modal) |
| `split_v2.py` → `train_v2 / dev_v2 / holdout_v2.jsonl` + `manifest_v2.json` | reads only the two sources; `--check` = rerun-identical |
| `validate_v2.py`, `audit_v2.py` → `results/audit_v2.json`, `results/review_v2.csv` | validators, quality report, review export |
| `train_v2_modal.py`, `score.py --contract contract_v2.json`, `test_v2_pipeline.py` | e10 training wrapper (not run), scorer, offline dry-run |

**Label semantics (corrected in v2.1, from `facts.json`):** `unverified_rumor` (was `rumor_public`). True means the
writer says it is an unclarified rumour. False means the writer says it was clarified. "Public / everyone knows"
alone → omitted. `second_source` = the writer confirms a report the reader already heard (hearing it from two
sources is a different thing). `repeats_prior` = passes on someone else's report. `subject_self_disclosed` true only
with ≥3 listeners stated or clear ("five people", "the whole class"). An unsized "group" → omitted, and it appears as
an unknown contrast. `medium_written` is scoped to how *this* disparagement is delivered. A past e-mail or a written
background sentence decides nothing. Unknown (U) phrases are never labelled. A missing label is unknown, not false.
Pairs whose phrasings imply each other are never put in one template row (`EXCLUDE_PAIRS`). Examples: firsthand ×
repeats_prior, rumour × verified, purpose × future_purpose.

**Leakage design.** A *semantic unit* is one fact sentence (alias, state, variant) or one background sentence. Its
Hebrew and English strings are translations and share the unit id. Every unit lives in exactly one split: 4
variants per fact/state, v0+v1 → train, v2 → dev, v3 → holdout. Backgrounds are scoped per split. `family` = hash of
the sorted fact units of a row. It is shared by the he/en/mixed renderings and by the unit's contrast rows
(quote / hypothetical / question, empty gold; quote is skipped for repeats_prior/second_source because quoting is
relaying). Natural rows: family = hash of the English source message, shared by he/en/mixed. Families that share a
normalized **evidence span** are merged (union-find) into one component. A component that touches template rows
follows their split; otherwise sha256(smallest family) % 100 → 80/10/10. Measured result: family / semantic-unit /
normalized-text / evidence-span overlap = **0** for every split pair, and 0 natural families dropped. Remaining shared
sentences (≈10-18 per pair) are the contrast frames ("Someone else wrote", "Is it accurate to say") and the
generator's trap questions ("should I send this message?"). Those are non-label text and are listed in
`manifest_v2.json`.

**Natural round (performed 2026-10-28):** `gen_natural_modal.py` with seed 20261030 and n=6000. Qwen2.5-32B writes
EN messages segment by segment. The same model re-extracts them blind and only exact agreement is kept. DictaLM-2.0
translates each segment, and 32B re-extracts the Hebrew blind. Results: generated 5,993, rejected for EN
disagreement 3,254, malformed 675, kept **3,900 rows** (en 2,062 / he 989 / mixed 849). Statistics are in
`results/natural_v2-genstats.json`. This is an automatic LLM-agreement filter, **not a human or agent review**.

| split | rows | families | templates | contrasts | natural | sha256 |
|---|---|---|---|---|---|---|
| train | 6,151 | 2,557 | 2,700 | 312 | 3,139 | `fdc3c2d9b8d96c572bfdfdf199f30b2286c8fe96e57132ac9e642fd388f89e00` |
| dev | 999 | 364 | 450 | 156 | 393 | `bcdf9c9648bea0a1f483b35c6104525c191f94e932e85cf1cf134b630cee17c4` |
| holdout | 1,124 | 399 | 600 | 156 | 368 | `facc6afdcedb4d272c5517a9f47e490cd438665e883a1e1523ccf11769c567ca` |

Sources: `all_v2.jsonl` 4,374 rows `118dc0080c7bcdf4a14c993b3ec5d881fd22816dbb9ac7e190dbd0c2b07270ae`;
`diverse/natural_v2.jsonl` 3,900 rows `1f1efaf8c62f7bc921ab58eec95fca3dad2ff7f9b765678a71c9b6053438ae66`.
Every fact × value occurs in every split (minimum: train 127, dev 10, holdout 16).
**Known gap:** the natural round is skewed toward `true`. It has no `no_alternative:false` and only 12
`firsthand:false`, 18 `rejects:false` and 25 `repeats_prior:false`. The falses come mostly from templates. A
false-focused natural round is the next data step if per-fact recall on falses lags.
`diverse/natural_v1.jsonl` (8-fact) is deliberately **not** mixed in. It was verified for 8 facts only, so a row
could state one of the 10 new facts unlabelled.

## Router v3 data — `classifier/data/`

Produced by the pipeline documented in docs/35 (only `--seed`, `--n-prompts` and `--focus` changed):
`gen_router_modal.py --out classifier/data/router_v3_aug.jsonl --holdout classifier/data/router_holdout_v1.jsonl
--n-prompts 1500 --n-mix 2000 --seed 2031 --focus need_purpose,need_prior_knowledge,need_participants`, followed by
`relabel_modal.py` with Qwen2.5-72B → `router_v3_aug_relabeled.jsonl`. It has **8,017 rows / 3,746 families**
(he 3,739 / en 3,746 / mixed 532; train 6,825 / dev 1,192 by family hash). Per label: prior_knowledge 2,608,
event 2,030, relationship 1,442, participants 1,343, recent 1,169, purpose 463, none 2,085. Overlap with
`router_v2_synth.jsonl` (family and normalized text) = 0, and with `router_holdout_v1` = 0. The raw 32B file is not
kept: its rows are inside the relabeled file (`labels_32b`), as in docs/35. `classifier/router/concat_data.py`
joins v2 + v3 into one training file (19,198 rows / 8,687 families, sha256
`170f5b6509a0b8ba549057e4047506060f3a5f4e660269910159855e27828857`). It refuses cross-file families and holdout
overlap. The 4-head template seed from round 1 (`research/local-router/*_v2*`, 74 rows) was removed. It used a head
set that differs from `labels.json` and a split script that overwrote its own input.

## Review status and what the holdouts are

All rows have `synthetic=true`, `agent_reviewed=false` and `human_review_pending=true`. No human has looked at any
row, and no agent review pass was performed either. Generating templates is not a review. `results/review_v2.csv`
(210 rows, stratified: every split × fact × value, contrasts, unknown-only rows, natural rows per language) has empty
`human_verdict` / `human_note` columns for the reviewer.
`dev_v2` / `holdout_v2` are **development** sets: the same author and pipeline built all splits, and the template
holdout was read while it was being written. The natural holdout rows were assigned by hash and not
read row by row (only the leakage report's shared-sentence snippets were seen), but they come from the same generator. `router_holdout_v1` already informed decisions in docs/35. **No independent
benchmark exists for the 18 facts or for router v3.** One needs a fresh set from a different author, or human-written,
that is never used for tuning.

## Training commands (for the trainer; not run here)

```powershell
cd <worktree of research/data-expansion-v2-20261028-215713>
# extractor e10 (H100, LoRA r16 q/k/v/o, 2 epochs, lr 1e-4 = e8 recipe; refuses to start unless split_v2.py --check passes)
py research/local-extractor/test_v2_pipeline.py
py -m modal run --detach research/local-extractor/train_v2_modal.py --candidate 7b --tag e10-v2-7b-20261029
py research/local-extractor/score.py --contract contract_v2.json --tag e10-v2-7b-20261029
# router r3 (same trainer as r2; holdout_v1 is development-exposed)
py -I classifier/router/concat_data.py --out classifier/data/router_v3_train.jsonl classifier/data/router_v2_synth.jsonl classifier/data/router_v3_aug_relabeled.jsonl
py -m modal run classifier/router/train_router_modal.py --data classifier/data/router_v3_train.jsonl --holdout classifier/data/router_holdout_v1.jsonl --cands xlmr,e5s,e5lr --tag r3
py -I classifier/router/evaluate.py --data classifier/data/router_v3_train.jsonl --holdout classifier/data/router_holdout_v1.jsonl --probs "classifier/results/router/r3-*.probs.json" --out classifier/results/router/summary_r3.json
```
Expected compute (estimate): e8-7B trained 3,289 rows in ~550 s on H100. e10 has 6,151 rows with a ~3.8k-char
system prompt (`--max-train-tokens 2048`), plus a zero-shot and LoRA evaluation of 2,123 rows. That is roughly 30-60
H100-minutes per candidate, about $2-4. The router r3 cost is that of r2 on 1.7× the rows. Data generation in this
round used about 1 H100-hour plus short A100 runs (estimate, not a billed figure).

## Owner decisions still open (unchanged)

A. Question budget 1 → up to 5 is a breaking `/check` wire change (docs/18; proxy, panel, router ranking). Not done.
B. Group D → structured rabbi-referral packet, never a verdict. A design is needed; not done.
