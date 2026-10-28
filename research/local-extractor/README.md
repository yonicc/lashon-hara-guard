# Local fact extraction pilot

Offline research only. This folder neither installs a browser model nor changes
the proxy, Oracle gate, extension, /check, or any deployed service.
See docs/37-local-extractor-pilot.md for measured results and limitations.

The prompt/alias contract is contract.json. Eight canonical catalog ids, boolean
value plus a verbatim message span; omitted means unknown, never false.
No meaning/irony judgment, general tools, verdict, free-text analysis or question
generation is implemented. Runtime/context facts still belong to their existing
owners. Model proposals are candidates, never verified real-world facts.

## Reproduce

Use project AGENTS.md, Git preflight and an isolated worktree on BI-1.
CLI profile: yonicc. Artifacts: Modal Volume lhg-models,
local-extractor/<unique-tag>/{adapter,merged,gpu-results.json}.
No min_containers, endpoints or modal deploy.

From the repository root:
```powershell
py research/local-extractor/make_data.py
py research/local-extractor/audit_data.py
Push-Location research/local-extractor
py -m unittest test_score.py
Pop-Location
py -m modal run research/local-extractor/pilot_modal.py --tag <NEW-TAG>
py research/local-extractor/score.py --tag <NEW-TAG>
Push-Location engine
npm ci --no-audit --no-fund
node --import tsx ../research/local-extractor/validate-results.mts <NEW-TAG>
Pop-Location
```

Paid runs need an authorized budget. Original ceiling: $15 for this pilot.
One A10G function <=7200 s; CPU function <=3600 s, four threads, no retries.
Long jobs MUST run detached from a .ps1 with logs and an exit-status file.
Never put PowerShell variables in a remote_exec one-liner.
Original launcher: D:\lhg-extractor-pilot-run.ps1 (outside repository).
If GPU completed and CPU failed, --cpu-only reuses the unique-tag merged model.

Additional measured stages (new unique tags should preserve e2-/e3-/e4- prefixes):
```powershell
py -m modal run research/local-extractor/probe_modal.py --tag e2-<NEW>
py research/local-extractor/score.py --tag e2-<NEW>
py -m modal run research/local-extractor/translation_probe.py --tag e3-<NEW>
py research/local-extractor/score.py --tag e3-<NEW>
py -m modal run research/local-extractor/train4_modal.py --tag e4-<NEW>
py research/local-extractor/score.py --tag e4-<NEW>
py -m modal run research/local-extractor/translation_probe.py --tag e5-<NEW> --reuse-translation --translation-tag e3-<EXISTING> --trained-tag e4-<EXISTING>
py research/local-extractor/score.py --tag e5-<NEW>
```

e2 compares Qwen3-4B-Instruct-2507 and the 3B control with an explicit-example
prompt, then tests the 4B base model with Torch int8 on CPU. e3 translates the
114 Hebrew cases with local OPUS-MT (4-thread CPU) and extracts in English
on GPU; evidence is mapped to the WHOLE original message, not aligned words.
Keep upstream decoding errors even when no mapped fact survives.
e4 uses the same 842 training rows and shared training code for 4B LoRA,
then tests its merged model in FP32 on eight preselected he/en cases, four
threads, 32 GiB requested RAM. No quantization is used for that CPU check.
All e4 evaluation is development diagnostics because e2 results were inspected.
e5 reuses the existing translator outputs but runs the trained 4B model on them;
no new training or translation occurs. It retains the coarse evidence-mapping
limitation; all scores remain development diagnostics.

The script refuses to overwrite a Volume tag. Preserve committed result files:
for reproduction use a new tag. It resolves and records Hugging Face revisions
for both models before loading; use those recorded revisions for exact model
reproduction. Seeds are fixed; GPU/CPU kernels can still vary.

## Data and measurement

train.jsonl is generated from a small pool of explicit templates (842 unique
messages), not LLM-generated language diversity. Legacy evaluation is derived
from the existing 74-item fact fixture; never enters training. fresh.jsonl was
authored separately from templates before observing model predictions:
24 semantic families x Hebrew/English/mixed = 72 rows, not 72 independent cases.
The same agent wrote both; no claim of independent author or human review.
Every row is synthetic, agent_reviewed and human_review_pending.

No training-set DEV split or threshold tuning in this pilot. Two epochs fixed
in advance for each training run; model/prompt changes were guided by results.
Do not call any eval set untouched after using this report to guide
a later run; author a new evaluation set. audit_data.py verifies hashes, train/
eval exact disjointness, labels/evidence and family membership.

score.py strictly validates JSON/known aliases/booleans/verbatim evidence.
It reports per-fact and per-language precision/recall, unsupported proposals,
wrong values (both FP and FN), misses, unknown-as-false and format errors.
An empty valid object leaves all facts unknown. Invalid output is an error,
even if no fact survives. A quoted span proves textual support only, never truth.

validate-results.mts passes accepted proposals through the REAL engine validator
and checks user-only ids, fabricated evidence and invalid confidence rejection.
Its confidence=EXTRACTION_CONFIDENCE_MIN is solely an admission-test placeholder,
not a learned/calibrated confidence or authorization for production integration.

CPU: merged 1.5B model, dynamic int8 Linear with fp32 embeddings, four Torch
threads, 16 preselected cases; warmup excluded, cold load/quantization and RSS
reported separately. CPU and GPU outputs are compared on those 16 rows.
This describes e1/e2 only; e4 instead tests FP32 on eight rows.
Modal x86 CPU results do not predict the Oracle host or browser WASM speed.
GPU timings use batches and are not single-message interactive latency.

Historical cloud comparison is limited to the same eight ids in the legacy
74-item corpus; older cloud runs used a broader prompt/catalog. There is no
fresh cloud measurement and no measurement of overall cloud replacement quality.

## Model scope/licensing

Qwen/Qwen2.5-1.5B-Instruct: Apache-2.0.
Qwen/Qwen2.5-3B-Instruct: qwen-research; comparison-only candidate, not a suggested
commercial installer artifact. See official model cards linked in docs/37.
Qwen/Qwen3-4B-Instruct-2507: Apache-2.0. OPUS-MT he-en: CC-BY-4.0.
No model weights are committed. Installing a model and choosing local/cloud
processing remain proposed follow-up work, not an implemented UI.
