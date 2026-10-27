# Phase A — multilingual gate diagnostic (2026-10-27)

Authorized scope: evaluate the current classifier within a $15 Modal ceiling. No training or production changes.

## Reproduce

From the repository root on BI-1, with the existing Modal profile yonicc:

```powershell
py classifier/eval_phase_a.py
```

The harness calls deployed Modal class lhg-gate/Gate, fp32 (quantize=0), through a separate invocation variant: 1 container, 120-second per-call timeout, no retries, 2-second idle scale-down. Local submission stops after 600 seconds; at most 1,000 rows. It does not change the production deployment, account wallet, extension, or threshold.

## Data and interpretation

135 new synthetic rows: 20 paired concern/harmless families, plus 5 ambiguous families, each in Hebrew, English and code-switched text. Labels were written before scoring. All labels require human review; translations are correlated, and the mixed examples are deliberately terse. This is a small diagnostic, not the proposed full ~1,000-example benchmark or a population accuracy estimate.

297 old eval_codex_v2 examples were also rescored as a regression check. That set already informed model selection; it is not a fresh holdout. No normalized exact matches were found against v1.jsonl/v2_aug.jsonl; semantic overlap remains possible. New examples must now be treated as development diagnostics if they guide improvements. Keep all translated siblings together in future splits, and create a fresh holdout for judging a new model.

Gold concern means linguistic negative content warrants further analysis, not a halachic prohibition. Safety/help-seeking reports remain eligible for downstream context and benefit analysis. Never discourage protective reporting. Ambiguous labels are reported separately.

## Results at the unchanged threshold 0.2

| Set | Clear / ambiguous | Concern detected | Missed | Harmless escalated |
|---|---:|---:|---:|---:|
| New Hebrew | 40 / 5 | 20/20 | 0 | 4/20 (20%) |
| New English | 40 / 5 | 18/20 | 2 | 6/20 (30%) |
| New mixed | 40 / 5 | 18/20 | 2 | 6/20 (30%) |
| Old Hebrew regression | 249 / 48 | 121/122 | 1 | 5/127 (3.94%) |

All 15 new ambiguous examples were escalated. Old ambiguous examples: 38/48 escalated. Escalation is a paid downstream analysis opportunity, not necessarily a warning shown to the user; this does not measure end-to-end alert false positives.

English/mixed misses included a rumor of theft and a help-seeking report of violence. Harmless escalations included meeting logistics, sincere praise, article/data discussion and product complaints. These examples suggest follow-up priorities, not category-wide statistical conclusions.

## Runtime, cost and validation

432 predictions were returned in 26.54 seconds wall time. The first batch of 32 took 16.52 seconds including startup/RPC; subsequent full batches took 0.62–0.88 seconds. These are batched RPC timings, not single-message latency or a load test.

Requested-resource compute estimate: $0.00087, using 2 cores and 2 GiB, wall time plus 2 seconds, at [Modal published rates](https://modal.com/pricing). This is not an invoice, an exact cost or confirmation of the grant balance/expiry. Actual usage metering may differ. No GPU, paid generation API, model training, new volume or always-on capacity was used. There is no reason to spend the $15 ceiling merely to consume it.

Validated prediction count/ranges, unique new IDs, absence of normalized exact training overlap, and the metric function against a hand-computed confusion matrix including an ambiguous row and threshold equality. The old evaluation reproduced the recorded baseline.

Files:
- classifier/data/phase_a_multilingual_v1.jsonl — new provisional examples.
- classifier/eval_phase_a.py — bounded evaluation and audit metadata.
- classifier/results/phase_a_multilingual_v1.json — all predictions, SHA-256 data hashes, metrics and batch timings.

## Next decision

Before training, have humans review the new labels and expand natural English/code-switching samples and benign hard negatives. Preserve family-level separation from a fresh final holdout. Compare a multilingual encoder against this Hebrew baseline under the next authorized experiment budget. Do not tune the production threshold on these 135 examples alone.
