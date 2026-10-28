"""Compare an isolated candidate to the live Modal baseline; never deploy."""
import hashlib
import json
import math
import os
import pathlib
import time

import modal

os.environ["LHG_GATE_RUN"] = "v3-multilingual-pilot"
os.environ["LHG_GATE_RUN_ML"] = ""  # reproduce the single-model pilot (routing came later, docs/31)
from serve_modal import app, Gate
from eval_phase_a import metrics, norm

ROOT = pathlib.Path(__file__).resolve().parent
FILES = ("phase_a_multilingual_v1.jsonl", "multilingual_expansion_v1.jsonl", "eval_codex_v2.jsonl")
MAX_SECONDS = 600

def main():
    started = time.monotonic()
    rows, hashes = [], {}
    training = set()
    for name in ("v1.jsonl", "v2_aug.jsonl"):
        p = ROOT/"data"/name
        hashes[name] = hashlib.sha256(p.read_bytes()).hexdigest()
        training.update(norm(json.loads(line)["text"]) for line in p.read_text(encoding="utf-8").splitlines())
    for name in FILES:
        p = ROOT/"data"/name
        hashes[name] = hashlib.sha256(p.read_bytes()).hexdigest()
        for line in p.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            r["dataset"] = name
            r.setdefault("language", "he")
            r["exact_training_overlap"] = norm(r["text"]) in training
            rows.append(r)
    assert len(rows) == 642
    baseline = modal.Cls.from_name("lhg-gate", "Gate").with_options(
        timeout=120, scaledown_window=2, max_containers=1, retries=0)(quantize=0)
    report = {"threshold": 0.2, "candidate": os.environ["LHG_GATE_RUN"],
              "baseline": "deployed lhg-gate/Gate fp32 (v2 per deployment)",
              "sha256": hashes, "results": {}, "timings": {},
              "limitations": ["Synthetic labels lack human review.",
                 "Development/regression comparison, not independently reviewed holdout.",
                 "No production deployment or threshold change.",
                 "RPC batch time is not single-message serving latency."]}
    with app.run():
        candidate = Gate.with_options(timeout=120, scaledown_window=2, max_containers=1, retries=0)(quantize=0)
        for label, gate in (("baseline", baseline), ("candidate", candidate)):
            t0 = time.monotonic()
            for i in range(0, len(rows), 32):
                if time.monotonic()-started > MAX_SECONDS:
                    raise TimeoutError("Evaluation time bound exceeded")
                batch = rows[i:i+32]
                ps = gate.score.remote([r["text"].strip() for r in batch])
                assert len(ps) == len(batch)
                for r, p in zip(batch, ps):
                    assert math.isfinite(p) and 0 <= p <= 1
                    r[label+"_p"] = p
                print(f"{label}: {i+len(batch)}/{len(rows)}", flush=True)
            report["timings"][label] = time.monotonic()-t0
            report["results"][label] = {}
            for name in FILES:
                for lang in sorted({r["language"] for r in rows if r["dataset"] == name}):
                    subset = [dict(r, p=r[label+"_p"]) for r in rows
                              if r["dataset"] == name and r["language"] == lang and not r["exact_training_overlap"]]
                    report["results"][label][name+":"+lang] = metrics(subset)
    failures = []
    for key, base in report["results"]["baseline"].items():
        cand = report["results"]["candidate"][key]
        if cand["fn"] > base["fn"]:
            failures.append(key+": more concern misses")
        if cand["fp"] > base["fp"]:
            failures.append(key+": more harmless escalations")
    report["regression_failures"] = failures
    report["promotion_allowed"] = False
    report["promotion_note"] = ("Regression failed; do not deploy." if failures else
        "Regression passed, but fresh independently reviewed holdout and Oracle latency/parity checks remain required.")
    report["elapsed_seconds"] = time.monotonic()-started
    out = ROOT/"results"/"v3_multilingual_comparison.json"
    out.write_text(json.dumps({"report": report, "predictions": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, indent=2), flush=True)

if __name__ == "__main__":
    main()
