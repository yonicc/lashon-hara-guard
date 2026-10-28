---
name: lhg-router-train
description: WHEN reproducing or extending LHG local context-router training, synthetic labeling, ONNX compression, or evaluation against the local memory; not for the gate or halachic verdict training.
---

# LHG local context router

Read AGENTS.md and docs/35-local-router-evaluation.md in this repository first.
Canonical BI-1 checkout: C:\Users\dev\lashon-hara-guard.
Use an isolated worktree from authenticated origin/main; the shared checkout can be behind.
This runbook records the offline experiment committed as 5894d61 on 2026-10-28.
Creating this skill does not authorize new paid runs or deployment.

## Contract and evidence

The single label definition is classifier/router/labels.json.
Heads: mem_recent, mem_search, ask_user; no active head means no expansion.
Multiple heads can activate. This is a classifier, not a general tool agent.
Deterministic research/local-router/getters.mjs executes bounded retrieval from
extension/memory.mjs. No verdict or "permitted" output. Missing facts remain unknown.
ask_user queues one question within the existing global question budget.

All data is synthetic, agent-sample-reviewed and human_review_pending.
Keep translations and contrast pairs in one family/split.
router_holdout_v1 has already guided model selection; use a fresh independently
reviewed holdout to validate improvements, not a claimed untouched benchmark.

## Reproduce without GPU charges

From repository root:
```powershell
py -I classifier/router/evaluate.py --data classifier/data/router_v2_synth.jsonl --holdout classifier/data/router_holdout_v1.jsonl --probs "classifier/results/router/r2-*.probs.json" --out classifier/results/router/summary_r2.json
Push-Location engine
node --import tsx --test ../research/local-router/getters.test.mjs
Pop-Location
```

Preserve committed result files before reruns. Inspect script CLI inputs before
running integration.test.mjs and memory-eval.mjs: they require local artifacts,
the real memory module and its pinned embedding revision. Do not substitute
a mocked retrieval test for the end-to-end check.

Verified original results: 14 getter tests, 4 integration tests; planted-memory
retrieval 16/16 with forced correct head, router plus retrieval 15/16.
Node/fake-indexeddb tests do not establish Chrome offscreen latency.

## Paid reproduction (only within an authorized budget)

Modal profile yonicc; CLI on BI-1 is py -m modal. Volume lhg-models.
Read gen_router_modal.py and relabel_modal.py resource settings before spending:
72B relabeling uses four H100 GPUs. Establish a dollar/time ceiling and monitor
GPU-seconds; the prior complete experiment cost approximately $5–6, not invoiced.
Use a NEW tag for each training run; r2 below denotes the historical run.
Do not overwrite historical Volume artifacts.

From repository root, historical working commands:
```powershell
py -m modal run classifier/router/gen_router_modal.py --out classifier/data/router_v1_synth.jsonl --holdout classifier/data/router_holdout_v1.jsonl --n-prompts 1200 --n-mix 3000
py -m modal run classifier/router/gen_router_modal.py --out classifier/data/router_v1_aug.jsonl --n-prompts 500 --n-mix 1000 --seed 2027 --focus need_purpose,need_participants
py -m modal run classifier/router/relabel_modal.py --data classifier/data/router_v1_synth.jsonl,classifier/data/router_v1_aug.jsonl --holdout classifier/data/router_holdout_v1.jsonl --out classifier/data/router_v2_synth.jsonl
py -m modal run classifier/router/train_router_modal.py --data classifier/data/router_v2_synth.jsonl --holdout classifier/data/router_holdout_v1.jsonl --cands xlmr,e5s,e5lr --tag r2
```

Long jobs: write a .ps1 launcher with remote_write_file, launch detached with
separate stdout/stderr logs, then inspect logs and exit state in subsequent calls.
Do not put PowerShell variables or GH_TOKEN in a remote_exec one-liner.
Never modal deploy or alter live gate, proxy, Oracle, extension or /check.

## Download, compress and calibrate

Keep large artifacts on D: on BI-1; check free disk space first.
modal volume get destination must be an existing directory.
Use absolute paths or restore the project directory after downloading:
```powershell
Push-Location D:\lhg-router-models
py -m modal volume get lhg-models router/r2-e5s .
Pop-Location
py classifier/router/onnx_bench.py --model D:\lhg-router-models\r2-e5s --holdout classifier/data/router_holdout_v1.jsonl --probs classifier/results/router/r2-e5s.probs.json --variants fp32,emb8 --ship emb8
Push-Location research/local-router
npm ci
node bench-router.mjs D:\lhg-router-models r2-e5s ..\..\classifier\data\router_holdout_v1.jsonl 1
Pop-Location
```

Calibrate thresholds on DEV probabilities from the actual exported artifact/runtime;
report holdout precision/recall per head and language, missed heads, no-expansion
misses, needless expansion, CPU identity, p50/p95 and cold load separately.

## Verified pitfalls

- Direct Qwen2.5-32B Hebrew generation in this experiment produced zero usable
  rows. Generate English, translate with DictaLM-2.0-instruct at temperature 0
  and an explicit Hebrew translation instruction. Review a language sample
  before scaling. Keep vLLM 0.6.6.post1 + transformers 4.47.1 and bf16 for
  reproducing the generator; the large teacher is offline only.
- Ordinary dynamic int8 damaged XLM-R decisions. Embedding-table-only emb8
  reduced e5-small 449MB to 174MB; 13/459 head decisions changed. Python ONNX
  parity did not guarantee transformers.js parity. Judge decisions, not size.
- DictaBERT failed to load in transformers.js 2.17 (NFD normalizer).
- Historical selected e5s emb8: 3/107 no-expansion misses, 48.9% needless
  expansion, Node p50 6.4ms/p95 7.8ms. These are synthetic research results,
  not production accuracy, browser timing, or proof of halachic coverage.
