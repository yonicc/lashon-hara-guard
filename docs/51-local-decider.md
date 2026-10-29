# Local meaning decider — separate from the gate

Owner approval: 2026-10-29. Gate deployment, weights and threshold 0.2 are
unchanged (Oracle primary, Modal fallback). Gate saves a model call only.
This work reuses the trained v2 DictaBERT and v4-xlmr-ml weights as a separately
versioned local artifact, with its own development-only calibration.

## Artifact and reproducibility

- Artifact: `d2-v2fp32-xlmr-emb8`; hashes: extension/decider-manifest.mjs.
- HF: https://huggingface.co/yonicc/lhg-local-decider/tree/10fdd53ae2a9f34641cd12e8c37ca625b6478fac .
  Download lhg-decider-d2.zip (1,085,244,860 bytes), extract, explicitly import
  the folder in options. Anonymous range probe returned 206 and ZIP magic.
- v2: fp32 ONNX 737,689,911 bytes. XLM-R: embedding-table-only int8,
  535,437,494 bytes. Config/tokenizers add about 20 MB; total about 1.3 GB.
  No dynamic linear int8. DictaBERT emb8 changed 2/210 development decisions
  at 0.2 and was rejected on development data alone.
- Chrome on BI-1 rejected a whole large ONNX Cache.put with a network error.
  Import still hashes the complete file first, then stores 32 MiB parts;
  all parts are required for installed status, and customCache stream-reassembles
  the exact bytes for cached-only inference. No proxy or model download on inference.
- Scripts: classifier/export_decider.py (Modal CPU, no training),
  prepare_decider_tokenizer.py, score_decider_modal.py, publish_decider.py;
  research/local-decider/bench.mjs, calibrate.py, export-manifest.mjs, browser.mjs.
- Runtime is standalone Transformers.js 3.8.1 + pinned ORT Web
  1.22.0-dev.20250409-89f8206ba4, one WASM CPU thread. It is packaged separately
  from memory/router's 2.17 runtime and does not modify its global env/cache.
  Use dist/transformers.min.js, not web.min (the latter has bare ORT imports).
  Official custom-model settings:
  https://huggingface.co/docs/transformers.js/v3.8.1/en/custom_usage .

The original DictaBERT tokenizer fails in 2.17 on NFD. Version 3.8.1 supports
NFD, but its JS regex also needs unescaped quotes and a Unicode word-class
translation (JS `\\w` alone is ASCII). Stage a separate tokenizer; preserve
Python originals and require token-ID parity. Never remove normalization to
make loading succeed. All 510 dev/Set B texts plus 10 Unicode fixtures per
model matched Python IDs (1,040 comparisons, zero mismatches).

ONNX export must bind inputs in forward-signature order, not tokenizer-dict
order: BERT tokenizer puts token_type_ids before attention_mask. The first
export was rejected because this swapped masks. The corrected d2 export
pins input names and order; the rejected artifact was never released.

## Routing, calibration and evaluation

Canonical routing stays in classifier/gate_route.py. The browser port is
extension/decider-route.mjs, pinned against Python across 1,034 Unicode/ASCII
texts and all 30 score combinations by classifier/test_decider_route.py.
Hebrew-only uses v2; any ASCII Latin letter adds XLM-R and takes max.

Development: multilingual_expansion_v1.jsonl (210 synthetic rows; 180 binary,
30 ambiguous). No training here. Choose warning precision >=0.95 with >=20
predictions; choose the largest low threshold with development concern
false-negative rate <=0.01. Initial 0.98 warning target had no eligible band;
this objective was revised using development data only, before independent
results were inspected. Scores are model softmax values, not calibrated
probabilities of correctness.

Frozen thresholds: T_low=0.000522539983057867;
T_high=0.9998533564805935 (extension/decider-policy.mjs).

| Data / band | TP | FP | FN | TN | P | R | FNR |
|---|---:|---:|---:|---:|---:|---:|---:|
| DEV warning | 20 | 1 | 70 | 89 | .9524 | .2222 | .7778 |
| DEV at low boundary | 90 | 85 | 0 | 5 | .5143 | 1 | 0 |
| Independent B warning | 60 | 0 | 227 | 2 | 1 | .2091 | .7909 |
| Independent B at low boundary | 287 | 2 | 0 | 0 | .9931 | 1 | 0 |

Docs/47 fact/router labels do not label meaning. All 300 Set B messages were
reviewed score-blind for a new linguistic-concern target, before model scores:
classifier/data/decider_setB_concern_v1.jsonl, SHA-256
952c9dedd827caca8c89e628aa26c8d72a14edde8a236580273f96aa99445a36.
Source hash 446ea8508bc84af9c8bff56a0619f9e01738f1c2449ea3e7d01dc363e3d70d5a.
There are 287 concern, only 2 no_concern and 11 ambiguous cases.
This is agent-only synthetic annotation, not human review or a second blind
meaning annotator. Zero FP in two negatives cannot establish general
precision or safety. Set A has fact labels, not validated meaning labels;
no meaning P/R claim is made for it. Neither set was used to calibrate,
train, repair data, or adjust thresholds.

Parity at both frozen boundaries: zero warning/low flips vs Python on
210 DEV + 300 independent B texts. Max score drift: v2 fp32 0.00000457;
XLM-R emb8 0.03636. Judge compression by band decisions, not max drift alone.
Raw results and limitations: research/local-decider/report.json.
BI-1 native CPU, one thread, warm tokenize+forward p50/p95:
v2 49/99 ms; XLM-R 51/96 ms. Latin text invokes both models.

Real Chromium MV3/offscreen CPU: all 510 rows matched native band decisions
(0 flips, maximum score drift 0.00000103), no HTTP requests during inference.
Warm route p50/p95 224.6/670.9 ms; first check 3691.9 ms. Explicit pinned
folder import, installed status, HE/EN (no Hebrew in EN card), mobile layout
and cautious merge passed. Fact-engine input in this merge test is synthetic;
the classifier and its offscreen inference are real. Existing Ollama suites
separately exercise extraction. Evidence: research/local-decider/provenance.json.
Screenshots: C:\Users\dev\lhg-design\shots\decider-he.png, decider-en.png,
decider-mobile-en.png (temporary test profile, not the owner's active profile).
Regression: 216 extension tests, 370 engine tests (+1 live skip), 81 proxy tests;
both typechecks and Ollama bundle freshness passed. Real MV3 Ollama transport,
setup, context loop and preset suites passed. The setup harness now opens
Advanced before its setup link (the preset grid had moved that link).

## User-visible behavior and safety

All local modes, including presets C–F, run the optional imported decider
after a successful fact-engine result. It can raise unsure to warn; it never
lowers extractor/rule warnings, supplies facts, or suppresses pending questions.
Missing facts stay unknown. Low and middle bands both remain unsure: **no
decider-only none**. The measured low-band FNR is not permission to approve
messages. In fact, no Set B message fell below T_low.

Missing/unavailable/failed decider means no meaning signal; existing extraction
continues. Failed extractor still means not_checked/fallback per existing
choice. Cloud mode never invokes the local decider; cloud fallback behavior
is unchanged. Imports are SHA-256 pinned; inference is cached-only, inside
the existing offscreen owner, with no message archive or network request.
The installed artifact ID participates in the result-cache key.

Options shows installed/not installed and an explicit download/import action,
in HE/EN. Accuracy dots remain unchanged: standalone classifier recall is
low at the cautious warning threshold and the new extractor/DictaLM union
has not been re-measured. This is a limited extra warning signal, not a
general improvement in local accuracy. Extractor meaning training remains
separate debt: [TECH-DEBT](TECH-DEBT.md).

## Re-run (BI-1, from the task checkout)

```powershell
py classifier/test_gate_route.py
py classifier/test_decider_route.py
py -m modal run --detach classifier/export_decider.py --out C:\Users\dev\lhg-design\decider-export.json
py -m modal run --detach classifier/score_decider_modal.py --out C:\Users\dev\lhg-design\decider-reference.json
node research/local-decider/bench.mjs D:/lhg-decider-runtime D:/lhg-decider-models/d2-js C:/Users/dev/lhg-design/decider-reference.json C:/Users/dev/lhg-design/decider-bench-d2-fp32.json
node research/local-decider/browser.mjs
node --test extension/*.test.cjs
```

Native benchmark needs DECIDER_FP32=1 (set in an uploaded .ps1); runtime
package is @huggingface/transformers@3.8.1. DEV calibration deliberately
refuses to overwrite existing policy; do not delete/recalibrate the shipped
policy or use independent results to select new thresholds. The reproducible
DEV selection logic is calibrate.py; use a new version for future candidates.
Release with scripts/release-extension.ps1 from clean main, then
scripts/install-from-lap.sh on YONI-PC. Public check-mode.js prepends its
documented public-build flag; byte verification must account for that one
intentional difference from the personal BI-1 source.
