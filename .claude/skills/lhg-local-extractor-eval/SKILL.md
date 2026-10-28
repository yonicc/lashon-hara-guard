---
name: lhg-local-extractor-eval
description: WHEN reproducing or extending LHG offline local fact-extractor fine-tuning, CPU/quantization parity, or Hebrew-to-English adapter evaluation on Modal; not for the gate, router, rulings, or deployment.
---

# Local fact extractor evaluation

Read project AGENTS.md, docs/37-local-extractor-pilot.md and
research/local-extractor/README.md first. The original experiment is 30b3533.
This runbook records verified commands; it does not authorize paid runs,
new model installation in the extension, deployment or live /check changes.

## Contract and evaluation

research/local-extractor/contract.json owns the eight aliases/catalog ids.
Output: alias -> [boolean, verbatim MESSAGE substring]; omit unknown facts.
Writer statements are candidate facts, not verified real-world truth.
Questions, hypothetical acts and somebody else's motives are not known writer facts.
Do not add a verdict, general tools, inferred facts or free-form explanations.

Training: 842 synthetic templates. legacy/fresh/confirmation have all guided
model selection and are development diagnostics. Never train on them.
Keep translated siblings and contrast pairs in a single family/split.
For an improvement claim, author and freeze a fresh family-disjoint evaluation set
before examining new predictions; retain synthetic/agent_reviewed/human_review_pending.
Low training loss on templates did not establish generalization.

## Offline checks (no Modal credentials needed)

Run from repository root in an isolated worktree:
```bash
python3 research/local-extractor/audit_data.py
(cd research/local-extractor && python3 -m unittest test_score.py)
```

These commands can rewrite tracked audit/results files. Inspect the diff and
preserve historical experiment output before running generators or scoring.
Do not regenerate make_data.py output as a substitute for richer data.

## Reproduce the measured Modal stages

Use the authenticated yonicc Modal profile and Volume lhg-models.
On BI-1 the CLI is `py -m modal`; on Linux use an isolated Python environment
with Modal installed. Verify `python -m modal profile list` first.
A missing profile requires account login; never print/copy tokens into chat or Git.
Honor the user's chosen host; do not fall back to BI-1 if YONI-PC was requested.

From the repository root, substitute NEW unique tags:
```bash
python -m modal run research/local-extractor/pilot_modal.py --tag e1-NEW
python -m modal run research/local-extractor/probe_modal.py --tag e2-NEW
python -m modal run research/local-extractor/translation_probe.py --tag e3-NEW
python -m modal run research/local-extractor/train4_modal.py --tag e4-NEW
python -m modal run research/local-extractor/translation_probe.py --tag e5-NEW --reuse-translation --translation-tag e3-EXISTING --trained-tag e4-EXISTING
python research/local-extractor/score.py --tag e4-NEW
(cd engine && npm ci --no-audit --no-fund && node --import tsx ../research/local-extractor/validate-results.mts e4-NEW)
```

Choose the stages needed, rather than rerunning everything:
- e1: Qwen2.5-1.5B before/after LoRA plus 3B baseline, then int8 CPU.
- e2: Qwen3-4B-Instruct-2507 and 3B with the same explicit-example prompt, then int8 CPU.
- e3: local OPUS-MT Hebrew->English, then untrained 4B extraction.
- e4: 4B LoRA on the same templates, then FP32 CPU on eight preselected cases.
- e5: existing translations and trained e4 model, no new training/translation.

Models remain in Volume local-extractor/<tag>/{adapter,merged}; no weights in Git.
Record revisions, data hashes, prompt, seed and function settings.
pilot_modal.py, probe_modal.py and train4_modal.py support --cpu-only to reuse
completed GPU work; inspect expected local result files before resuming.

Long runs must be detached with logs and exit state; use Modal --detach or a
host launcher that survives the runner call. Do not leave a >300s command in
remote_exec. On PowerShell, write a .ps1; no variables in remote_exec one-liners.
No modal deploy, endpoints or min_containers. Set a dollar/time ceiling before
starting; inspect each wrapper's timeout/GPU configuration. The original pilot
used a $15 ceiling; historical compute estimate $1–2 was not an invoice.

## Interpret and package results

score.py is the canonical strict scorer: per-language/per-fact precision and
recall, unsupported facts, wrong values (FP+FN), misses, unknown-as-false,
malformed JSON and invented evidence. Empty output is not success on a
positive case. Preserve upstream errors through translation adapters.
validate-results.mts uses the real engine validator; its confidence placeholder
is not learned calibration or permission to admit facts into the live flow.

Report CPU architecture, thread quota, model size, cold load, p50/p95,
peak RSS, token limits and decision parity separately from GPU batches.
Modal four-core x86 measurements are not Oracle/ARM/browser measurements.
Historical cloud comparison covers only the legacy eight-fact subset;
do not label fact precision as a percentage of complete cloud capability.

## Verified pitfalls and next-experiment choices

- Torch dynamic int8 Linear damaged decoder JSON in both tested 1.5B/4B runs.
  Loading successfully is not correctness. Retain an FP32 control and score
  actual quantized output before recommending GGUF or any other artifact.
- Nested sibling imports were not automatically mounted in Modal wrappers.
  train4/translation wrappers explicitly include pilot_modal.py/probe_modal.py.
  retries=0 did not bound import-failing startup attempts; stop only the exact
  failed experiment app: `python -m modal app stop --yes <app-id>`.
- Translation evidence maps to the whole original Hebrew message; it is coarse
  experimental mapping, not span alignment or proof of semantic support.
  Audit negation, questions and revenge idioms; translation improved precision
  more than recall and did not solve unknown-as-false.
- The 4B model reached near-zero template loss but poor Hebrew recall.
  For continued training, diversify paraphrases/negation/unknown contrasts and
  measure against a frozen new set. More epochs alone are not an established fix.
- CPU FP32 e4 parity held in only eight cases; median 31.9s and peak 21.4GiB
  are research measurements, not a usable installer or full local pipeline.
