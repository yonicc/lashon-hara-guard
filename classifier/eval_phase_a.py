"""Bounded diagnostic of the deployed fp32 gate; no deploy, training or wallet calls.
Run: py classifier/eval_phase_a.py
Synthetic labels are provisional. Translated siblings are correlated, not independent samples.
"""
import hashlib
import json
import math
import pathlib
import statistics
import time
import unicodedata

import modal

ROOT = pathlib.Path(__file__).resolve().parent
THRESHOLD = 0.2
MAX_SECONDS = 600
MAX_ROWS = 1000

def norm(text):
    return "".join(c for c in unicodedata.normalize("NFKC", text).lower() if c.isalnum())

def metrics(rows):
    clear = [r for r in rows if r["gold"] != "ambiguous"]
    tp = sum(r["gold"] == "concern" and r["p"] >= THRESHOLD for r in clear)
    fn = sum(r["gold"] == "concern" and r["p"] < THRESHOLD for r in clear)
    fp = sum(r["gold"] == "no_concern" and r["p"] >= THRESHOLD for r in clear)
    tn = sum(r["gold"] == "no_concern" and r["p"] < THRESHOLD for r in clear)
    amb = [r for r in rows if r["gold"] == "ambiguous"]
    return dict(n=len(rows), tp=tp, fn=fn, fp=fp, tn=tn,
                recall=tp/(tp+fn) if tp+fn else None,
                harmless_escalation_rate=fp/(fp+tn) if fp+tn else None,
                precision=tp/(tp+fp) if tp+fp else None,
                ambiguous_n=len(amb),
                ambiguous_escalated=sum(r["p"] >= THRESHOLD for r in amb))

def main():
    start = time.monotonic()
    training = set()
    for filename in ("v1.jsonl", "v2_aug.jsonl"):
        for line in (ROOT/"data"/filename).read_text(encoding="utf-8").splitlines():
            training.add(norm(json.loads(line)["text"]))
    rows = []
    hashes = {}
    overlaps = {}
    for filename in ("phase_a_multilingual_v1.jsonl", "eval_codex_v2.jsonl"):
        path = ROOT/"data"/filename
        hashes[filename] = hashlib.sha256(path.read_bytes()).hexdigest()
        group = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        overlaps[filename] = sum(norm(r["text"]) in training for r in group)
        for r in group:
            r["dataset"] = filename
            r.setdefault("language", "he")
            r["exact_training_overlap"] = norm(r["text"]) in training
        rows += group
    assert 0 < len(rows) <= MAX_ROWS
    # Separate bounded variant; leaves production configuration unchanged.
    gate = modal.Cls.from_name("lhg-gate", "Gate").with_options(
        timeout=120, scaledown_window=2, max_containers=1, retries=0)(quantize=0)
    batches = []
    for i in range(0, len(rows), 32):
        if time.monotonic()-start > MAX_SECONDS:
            raise TimeoutError("Local evaluation time budget exceeded")
        batch = rows[i:i+32]
        t0 = time.monotonic()
        scores = gate.score.remote([r["text"].strip() for r in batch])
        assert len(scores) == len(batch)
        for r, p in zip(batch, scores):
            assert math.isfinite(p) and 0 <= p <= 1
            r["p"] = p
        batches.append(dict(n=len(batch), wall_seconds=time.monotonic()-t0))
        print(f"scored {i+len(batch)}/{len(rows)}", flush=True)
    report = dict(threshold=THRESHOLD, model="deployed lhg-gate/Gate quantize=0 (v2 per deployed config)",
                  data_sha256=hashes, exact_training_overlaps=overlaps,
                  groups={}, batch_timings=batches, elapsed_seconds=time.monotonic()-start,
                  limitations=["Synthetic provisional labels, no human review.",
                    "New set: 20 paired families plus 5 ambiguous families in three languages; translations correlated.",
                    "No population accuracy estimate or end-to-end user alert measurement.",
                    "Existing eval_codex_v2 already used for model selection, included only as regression.",
                    "Exact normalized overlap detection does not exclude semantic near-duplicates.",
                    "RPC batch timings include network and cold start; not single-message server latency.",
                    "No production config, threshold, model or extension changes."])
    for dataset in hashes:
        subset = [r for r in rows if r["dataset"] == dataset and not r["exact_training_overlap"]]
        for lang in sorted(set(r["language"] for r in subset)):
            report["groups"][dataset+":"+lang] = metrics([r for r in subset if r["language"] == lang])
    # Estimate requested-resource compute only, not an invoice or credit balance.
    report["estimated_requested_compute_usd"] = (report["elapsed_seconds"]+2)*(2*0.0000131+2*0.00000222)
    report["pricing_source"] = "https://modal.com/pricing"
    report["cost_note"] = "Requested 2 cores/2 GiB; actual metering may differ. No GPU or generation API used."
    out = ROOT/"results"/"phase_a_multilingual_v1.json"
    out.write_text(json.dumps(dict(report=report, predictions=rows), ensure_ascii=False, indent=2),encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, indent=2),flush=True)

if __name__ == "__main__":
    main()
