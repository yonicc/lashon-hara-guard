# 49 — Qwen extractor v2 GGUF release qualification

Owner approved the model swap on 2026-10-29. Base: 0d31b54 (extension 0.12.0).
Status: **Owner authorized release despite failed parity (option A, 2026-10-29)**.
The owner accepted Set B/18 precision 0.9239→0.8997 and Set A/8 recall
0.6288→0.5939 (also A/18 0.7344→0.6992): Q4-v2 Set B/8 precision 0.9259
at recall 0.8427 is substantially better than shipped e8 precision 0.596
at similar recall (e8 bf16 0.854, docs/47). The gate remains for future swaps.
Publication requires explicit --allow-parity-regression; incomplete prompt reports stay blocked.

## Final parity results

All 700 unique prompts matched the actual built extension render byte for byte.
Precision/recall below are validated fact pairs before confidence/user-only admission.

| Set / scope | bf16 P / R | Q4_K_M P / R | decision flips | format-error rows bf16 → Q4 |
|---|---|---|---|---|
| A / 8 | 0.9730 / 0.6288 | 0.9577 / 0.5939 | 15/400 | 3 → 2 |
| A / 18 | 0.9699 / 0.7344 | 0.9684 / 0.6992 | 27/400 | 3 → 2 |
| B / 8 | 0.9434 / 0.8427 | 0.9259 / 0.8427 | 10/300 | 12 → 7 |
| B / 18 | 0.9239 / 0.8718 | 0.8997 / 0.8744 | 22/300 | 12 → 7 |

No token-limit hits in either artifact on either set. Format-error rows include dropped pairs,
using the frozen independent scorer. Gate failures: A/8 recall −0.0349345,
A/18 recall −0.0352697, B/18 precision −0.0241769 (limit: −0.02).
Neither prompt, threshold nor data was changed in response. No replacement quantization was tried.

Evidence: results/e11-v2-parity.json and results/e11-v2-parity.raw.jsonl under research/local-extractor/.
The report pins canonical Git input bytes to 0d31b54 and records the one identical repeated measurement.
After the stop/resume snapshot (188 rows), the old chunk-2 committed one final row late;
the resumed run produced the same raw output, prompt hash and stop reason for that ID.
Only identical repeats are deduplicated; conflicting repeats abort scoring. Both records remain auditable.

## Frozen artifact and measurement

- Checkpoint: Volume lhg-models, local-extractor/e10-v2-7b-20261029-supervisor/merged.
- Contract: research/local-extractor/contract_v2.json; exact instruction from probe_modal.instruction.
- Conversion reuses gguf_modal.convert with llama.cpp b4500 and the existing null-config staging fix.
  e8 tags remain unchanged. Q4_K_M is 4,683,070,784 bytes; no local conversion or training.
- Set A (400, supplementary, generator-only labels) and Set B (300, natural, blind double-labeled)
  are measurement only (docs/47). No prompt, threshold or data tuning.
- llama-cpp-python 0.3.7, four CPU threads per Modal function, n_ctx 4096, raw Qwen template,
  temperature 0, top_k 1, maximum 256 generated tokens. Per-row output/usage/limit/prompt hash
  are journaled to local-extractor/e11-v2-parity in the Volume.
- Completed rows survived stopping the original seven 100-row functions and resharding only
  the remaining rows into groups of 25. Model, inputs and decoding settings stayed frozen.
- score_v2_parity.py reuses the frozen decode function from score_all.py, checks all 700 row IDs,
  and compares every prompt SHA-256 with the actual extension render(). Both 8- and 18-fact
  scopes are reported separately per set, including pair-set decision flips.
- Release gate: neither P nor R may drop by more than 0.02 on either set/scope;
  format-error rows and token-limit hits may not increase. The scorer exits 2 on failure;
  hf_publish_modal.py --model 7b-v2 refuses a failed parity report unless the owner-authorized
  --allow-parity-regression flag is supplied; incomplete reports cannot be overridden.

## Per-model integration

ollama-client.js owns model references, contract version and template in SPECS; check-mode.js
owns mode membership. Qwen uses contract v2; DictaLM retains its trained contract v1 (no v2 retrain).
local-union still combines both engines using the existing cautious alert/needs policy;
it is not an independently measured quality improvement over Qwen v2.

export-ollama-prompt.py exports each contract's exact instruction. The browser bundle is rebuilt
from source. Every contract ID is checked against FACT_CATALOG at startup. All 18 IDs exist;
12 can be admitted from model output, while six remain confirmedByUserOnly:
message.includes_same_self_disparagement, message.is_unverified_rumor,
message.confirms_prior_report_from_second_source, context.parent_or_rabbi_requested_disclosure,
context.repeats_prior_report, context.subject_disclosed_own_business_before_three.
These are reported as confirmed_by_user_only, never silently treated as unknown IDs.
The existing confidence threshold, scoreKeys token probabilities and per-pair drops remain in force.
The installed e8 reference cannot satisfy v2 availability; the setup wizard must download v2.

## Verification before publication (original qualification)

- Extension: 199 passed, including e8-to-v2 availability and v2/user-only admission.
- Engine: 370 passed, one live test skipped; proxy: 78 passed; both typechecks passed.
- Bundle freshness passed. Real Chromium: Ollama transport/mode registration, setup wizard
  (Hebrew/RTL, download/cancel/retry/activation), and shared needs/memory loop passed.
- Ollama was restored after the mock-server tests. Live v2 smoke and release were not attempted:
  the earlier parity gate failed, as the owner required.
- No proxy source was changed; the lhg-proxy Worker needs no deployment.

## Release verification (2026-10-29, extension 0.12.2)

- Published new public repository: https://huggingface.co/yonicc/lhg-extractor-qwen7b-v2-gguf
  at HF commit 550702a4bbaf33b0bb85eb14cb9ac81d3cb24f7b. Anonymous HTTP range download
  returned 206, GGUF magic and total size 4,683,070,784 bytes. Model card separates
  development/independent metrics and states the failed parity gate and owner exception.
  Publication receipt: results/e11-v2-hf.json. e8 repositories were not changed.
- BI-1 Ollama 0.40.12 pulled exactly hf.co/yonicc/lhg-extractor-qwen7b-v2-gguf:Q4_K_M
  (manifest digest c7e7883513e0796e1d8d396bf595cc875e08a12ccf2e00fe8ec8c134e06fd470).
- Live smoke: nine synthetic cases, eight nonempty scored outputs, zero failures;
  all output keys had aligned finite token scores (0.94356–0.999999).
  Four expanded-contract facts admitted; all six user-only facts rejected by canonical policy.
  End-to-end case latency 0.670–32.583 s (cold first case); warm nonempty 4.961–5.850 s.
  The local needs executor completed two real inference rounds with synthetic untrusted
  retrieval, no confirmed-fact promotion, five catalog questions, unsure, and stopped
  at no_new_information. Evidence: results/e11-v2-live.jsonl.
- Both Ollama Chromium suites and shared context-loop Chromium suite passed.
  Initial regression: extension 199, engine 370 + one live skip, proxy 78 including
  workerd, both typechecks and build/freshness passed. Explicit publication-guard
  checks confirmed default refusal, authorized override, and refusal of incomplete reports.
- Release rebased onto bda154a (concurrent 0.12.1 send-check fix), retaining that change.
  Final regression: extension 205 passed, engine 370 passed + one live skip, proxy 78 passed
  including workerd; both typechecks, bundle build/freshness and all three Chromium suites passed.
  Three-target publication uses scripts/release-extension.ps1 and scripts/install-from-lap.sh;
  verification compares each packaged/installed file to git show HEAD bytes using Python subprocess.

## Commands

Run on BI-1 in the task worktree; heavy computation is on Modal only:

```text
py -m modal run --detach research/local-extractor/gguf_v2_parity_modal.py --messages D:\lhg-independent-eval
# To resume/re-shard: first stop the exact app and download its journals to an existing D: folder.
py -m modal volume get --force lhg-models local-extractor/e11-v2-parity D:\lhg-v2-parity
py -m modal run --detach research/local-extractor/gguf_v2_parity_modal.py --messages D:\lhg-independent-eval --resume D:\lhg-v2-parity\e11-v2-parity
py research/local-extractor/score_v2_parity.py --chunks D:\lhg-v2-parity\e11-v2-parity
# Owner-authorized exception for this artifact only (otherwise require a passing gate):
py -m modal run --detach research/local-extractor/hf_publish_modal.py --model 7b-v2 --allow-parity-regression
node scripts/test-ollama-live.cjs extractor-7b-q4
```

Windows launchers use a .ps1, Start-Transcript, and native Modal output redirected to a log.
The parity image must explicitly mount gguf_modal.py as well as pilot_modal.py;
otherwise measure containers fail to import their sibling module. Failed experiment apps were
stopped by exact app ID. No serving endpoints were changed.
