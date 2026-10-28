# Multilingual gate: translated training data + routed max gate — 2026-10-28

## Decision (deployed)

Live gate = **v2 for Hebrew-only text; for text containing Latin letters,
max(v2, v4-xlmr-ml)** (`classifier/gate_route.py`, the one home of the rule).
Deployed on Oracle (primary, image `lhg-gate:3`) and Modal (fallback). Threshold 0.2
and the proxy contract (`p`, `ms`, `run`) are unchanged; `run` now reads
`v2+v4-xlmr-ml` when the second model was asked.

Why max and not a replacement: the gate is recall-first. With max, no message can
score lower than with v2 alone, on ANY text, not only on our small sets. The cost is
a few more escalations (model calls) and ~2x gate latency on Latin-script text.

## Data

- `classifier/data/v3_translated.jsonl`: 5,910 synthetic rows = 2,955 Hebrew training
  rows (agree=true only) translated to English + code-switched mixed by
  Qwen2.5-32B-Instruct (vLLM on a Modal H100, `classifier/translate_modal.py`).
  Labels inherited from the Hebrew source; `family` = source hash. 1,373 sources
  dropped by the mechanical filter (foreign scripts, niqqud, script balance, length).
  Agent spot review (50 random rows): label meaning preserved, occasional translation
  noise. Not human reviewed.
- `classifier/data/holdout_agent_v1.jsonl`: fresh holdout, 116 rows (en 44, mixed 42,
  he 30; incl. 6 ambiguous), agent-authored (claude-opus-5-5) with new names/content,
  never trained on, zero exact overlap with all training data. Labels are agent-reviewed,
  `human_review_pending`. It was used to choose among 4 candidates, so it is no longer
  a pristine holdout for the next round.

## Candidates (seed 13, 4 epochs, T4)

| run | base | data |
|---|---|---|
| v4-dicta-ml | dicta-il/dictabert | v1 + v2_aug + v3_translated |
| v4-xlmr-ml | FacebookAI/xlm-roberta-base | same |
| v4-xlmr-he2 / v4-dicta-he2 | as above | Hebrew rows twice (2x weight) |
| v2-repro | dictabert | v1 + v2_aug (v2 recipe) |

`v2-repro` reproduces v2 exactly on every slice: training is deterministic, so the
regressions below are real, not seed noise.

## Results at 0.2 (misses / concerns, escalated / harmless), `classifier/results/v4_comparison.json`

| slice | v2 | v4-xlmr-ml | routed max (deployed) |
|---|---:|---:|---:|
| eval_codex_v2 he | 1/122, 5/127 | 9/122, 4/127 | 1/122, 5/127 |
| holdout en | 3/22, 5/20 | 0/22, 2/20 | 0/22, 6/20 |
| holdout mixed | 1/20, 1/20 | 0/20, 0/20 | 0/20, 1/20 |
| holdout he | 1/14, 0/14 | 0/14, 0/14 | 1/14, 0/14 |
| expansion en | 5/30, 12/30 | 4/30, 9/30 | 3/30, 12/30 |
| expansion mixed | 5/30, 10/30 | 4/30, 10/30 | 4/30, 11/30 |
| Phase A en | 2/20, 6/20 | 1/20, 1/20 | 1/20, 7/20 |
| Phase A mixed | 2/20, 6/20 | 2/20, 2/20 | 1/20, 6/20 |
| **total** | **22 / 59** | 26 / 38 | **13 / 62** |

Every single model trained with translations lost Hebrew sarcasm/backhanded praise
("כל הכבוד ל... 👏", insinuations) on eval_codex_v2 (6–10 misses vs 1), also with 2x
Hebrew weight and at lower thresholds. Hence routing instead of replacement.
Alternative measured, not deployed: route Latin text to v4-xlmr-ml alone (15 misses,
43 escalations) — fewer model calls, but no per-message guarantee.

## Serving verification

- Oracle side container (127.0.0.1:8091) then live, 758 rows: 758/758 agreement at
  0.2, max |diff| 0.0 vs the offline routed scores. Public tunnel: Hebrew-only p50
  126 / p95 146 ms, Latin p50 234 / p95 276 ms (Oracle timeout in the proxy: 800 ms).
  Container memory 0.5–1.5 GiB → limit raised to 3 GiB (`deploy.sh`). 401/400 contract
  checked. Modal fallback redeployed: 758/758, max |diff| 5e-5.
- Rollback (Hebrew-only, previous behaviour): Oracle `bash deploy.sh 4` without the 2nd
  argument (old files in `/home/ubuntu/lhg-gate/backup-v2-single/`); Modal:
  `LHG_GATE_RUN_ML=` then `py -m modal deploy classifier/serve_modal.py`.

## Cost

GPU time: translation pilots + full run on L4/L40S/H100 (~25 min in total, mostly
model load), 5 trainings on T4 (~40 min incl. setup), CPU evaluations. Estimated
a few dollars; no Modal invoice was read.

## Lessons (verified)

- vllm 0.6.6.post1 needs `transformers==4.47.1` (else `Qwen2Tokenizer has no attribute
  all_special_tokens_extended`); AWQ Qwen failed to load (`float16 is not supported for
  quantization method awq`) → use bf16.
- Qwen2.5-14B mixed-language output leaked Chinese/Portuguese/niqqud; 32B with
  few-shot + a strict script filter was usable.
- Files from the BI-1 checkout are CRLF; scp'd `deploy.sh` fails in bash (`set: pipefail
  : invalid option name`). Convert to LF on the host before running.
