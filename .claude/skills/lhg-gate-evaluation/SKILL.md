---
name: lhg-gate-evaluation
description: WHEN evaluating the LHG linguistic gate in Hebrew, English or mixed text, reproducing Phase A on Modal, or expanding its synthetic diagnostic dataset before training.
---

# LHG gate evaluation

Read the project's AGENTS.md first. On BI-1 use a clean checkout/worktree of
https://github.com/yonicc/lashon-hara-guard (main). Canonical checkout:
C:\Users\dev\lashon-hara-guard. Do not assume its active branch is main.

## Reproduce the deployed baseline

From the project root, with the existing Modal profile yonicc:

```powershell
py classifier/eval_phase_a.py
```

Verified 2026-10-27: 432 predictions (135 multilingual + 297 previous Hebrew),
26.54 s wall time; new-set recall he 20/20, en 18/20, mixed 18/20 at 0.2.
Evidence and limits: docs/28-phase-a-multilingual-evaluation.md and
classifier/results/phase_a_multilingual_v1.json.

The harness calls deployed lhg-gate/Gate quantize=0, max_containers=1,
retries=0, timeout=120, scaledown_window=2, at most 1,000 rows and 600 s local
submission. Read the harness before changing input/output files; it currently
has fixed filenames and overwrites its result. Preserve a previous result
before rerunning. These bounds are not a provider-enforced dollar cap.
Use only the authorized experiment budget. Do not deploy, train, change the
live threshold, allocate GPUs or set min_containers as part of evaluation.
Modal is the fallback gate; Oracle is primary. Direct Modal scoring measures
the fallback model, not end-to-end alerts or the full production route.

## Expand and review offline

```powershell
py classifier/validate_expansion.py
```

Verified 2026-10-27: 210 rows, 40 families, 70 rows per language, no normalized
exact overlap with v1/v2_aug training, eval_codex_v2 or Phase A.
Outputs classifier/results/multilingual_expansion_v1_audit.json and
multilingual_expansion_v1_review.csv. No network or paid calls.

Author synthetic rows in classifier/data/multilingual_expansion_v1.jsonl.
Use its existing schema: stable id, text, gold (concern/no_concern/ambiguous),
language (he/en/mixed), category, family, source, review_status, split, why.
Keep translations AND positive/negative contrast pairs in one family.
All new labels remain human_review_pending and development_candidate.
Do not count paraphrases/translations as independent observations.

Give reviewers the CSV and collect reviewer_label, reviewer and review_notes.
Review disagreements and ambiguous cases before selecting training data.
Keep all members of a family in the same split; also check semantic overlap
across families and earlier data. Exact normalization alone cannot prove
independence. These diagnostics already guide development; build a separate,
fresh, independently reviewed holdout to judge a new model. The training
scripts do not automatically consume this expansion; explicitly select
reviewed data for a separately authorized training task.

## Interpret correctly

Concern means negative information about an identifiable person warrants
context analysis, not a halachic ruling. Safety/help-seeking reports may need
analysis but must not be discouraged. Ambiguous examples stay separate.
Report recall/misses and harmless escalation by language; gate escalation
is not a user-visible warning false positive. Do not tune a production
threshold on this small synthetic set or claim population accuracy.
Record dataset hashes, deployed model identity limitations, threshold,
failures, timings and any cost estimate separately from invoiced cost.
Never commit secrets, actual user messages or relationship graphs.
