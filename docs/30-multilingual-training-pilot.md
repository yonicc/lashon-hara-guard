# Multilingual gate training pilot — 2026-10-27

## Decision

Candidate `v3-multilingual-pilot` FAILED regression. Do not deploy it to Oracle
or replace the Modal fallback. Existing production v2 and threshold 0.2 are unchanged.

## Reproduce

On BI-1, clean checkout, existing Modal profile yonicc:

```powershell
$env:MODAL_PROFILE='yonicc'
py -m modal run classifier/train_modal.py --data classifier/data/v1.jsonl,classifier/data/v2_aug.jsonl --run v3-multilingual-pilot --base-model microsoft/Multilingual-MiniLM-L12-H384 --epochs 4
py classifier/eval_v3_candidate.py
```

Run names must be unique for future experiments: the training command overwrites
the named Modal volume directory. The comparison harness deliberately names this
specific candidate, runs an ephemeral app, and never deploys it.

Base: microsoft/Multilingual-MiniLM-L12-H384. Seed 13, four epochs, T4,
max_length 96, existing category-stratified split. 4,590 source rows, 11
harmless rows flagged by verifier excluded; 3,680 training / 899 internal-test
rows. 65 seconds GPU training, exclusive of setup and model loading.
The original row split is not a semantic/family-independent quality estimate.

No Phase A or expansion examples were used in training. Their synthetic
provisional labels remain human_review_pending; they are diagnostics, not a
human-reviewed holdout. No user messages or private relationship data used.

## Same-threshold comparison

642 rows scored by each model: 135 Phase A + 210 expansion + 297 earlier
Hebrew regression. Ambiguous rows excluded from binary rates.

| Dataset/language | Baseline concern misses | Candidate misses | Baseline harmless escalations | Candidate escalations |
|---|---:|---:|---:|---:|
| Phase A Hebrew | 0/20 | 1/20 | 4/20 | 3/20 |
| Phase A English | 2/20 | 2/20 | 6/20 | 1/20 |
| Phase A mixed | 2/20 | 2/20 | 6/20 | 2/20 |
| Expansion Hebrew | 2/30 | 2/30 | 10/30 | 12/30 |
| Expansion English | 5/30 | 2/30 | 12/30 | 14/30 |
| Expansion mixed | 5/30 | 3/30 | 10/30 | 16/30 |
| Previous Hebrew | 1/122 | 9/122 | 5/127 | 9/127 |

The baseline was scored directly via deployed Modal lhg-gate/Gate fp32;
the deployment config identifies it as v2. This is not an Oracle live-path
parity check or an independently verified weight identity. Per-row scores,
dataset hashes, timing and decision are in
`classifier/results/v3_multilingual_comparison.json`.
Internal split metrics are in `classifier/results/v3-multilingual-pilot.json`.

The candidate improves some English/mixed diagnostics but regresses materially
in Hebrew. CPU timing from the training host (28.5ms/message) and RPC batch
timings are not Oracle ARM serving benchmarks. No Oracle resources were changed.
No actual Modal invoice or balance was obtained; do not equate 65 seconds of
GPU training with total billed runtime.

## Verified operational lesson

This multilingual tokenizer requires sentencepiece/protobuf in the training
image. The first attempt failed during tokenizer initialization before training;
adding sentencepiece==0.2.0 and protobuf==5.29.3 resolved it. Saved fast tokenizer
assets loaded successfully in the unchanged CPU serving image.

## Next quality gate

Review the multilingual development labels and build a fresh independently
reviewed family-separated holdout before a promotion decision. Train a candidate
with multilingual training examples; merely replacing the base encoder while
fine-tuning only on Hebrew did not preserve the existing recall.
A passing candidate still needs Oracle side-by-side latency, resource,
HTTP-contract and score-parity checks and a rollback-ready switch.
