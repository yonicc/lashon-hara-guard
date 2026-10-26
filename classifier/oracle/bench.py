"""In-process latency benchmark for the gate model (run inside the gate image).

    python bench.py <data.jsonl> <modal_ref.jsonl> <threads> <out.json>

For batch 1 and batch 8: per-call latency p50/p95 and checks per second, plus agreement
with the Modal reference at threshold 0.2 and the largest absolute probability gap.
"""
import json
import os
import statistics
import sys
import time

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def main(data, ref, threads, out):
    torch.set_num_threads(threads)
    path = os.environ.get("LHG_GATE_MODEL_DIR", "/models/v2")
    tok = AutoTokenizer.from_pretrained(path)
    model = AutoModelForSequenceClassification.from_pretrained(path).eval()
    texts = [json.loads(l)["text"].strip() for l in open(data, encoding="utf-8")]
    ref_p = [json.loads(l)["p"] for l in open(ref, encoding="utf-8")]

    def score(batch):
        with torch.no_grad():
            enc = tok(batch, padding=True, truncation=True, max_length=96, return_tensors="pt")
            return torch.softmax(model(**enc).logits, -1)[:, 1].tolist()

    for _ in range(3):
        score(texts[:8])
    report = {"threads": threads, "n": len(texts)}
    for bs in (1, 8):
        lat, probs = [], []
        t_all = time.perf_counter()
        for i in range(0, len(texts), bs):
            t0 = time.perf_counter()
            probs += score(texts[i:i + bs])
            lat.append((time.perf_counter() - t0) * 1000)
        wall = time.perf_counter() - t_all
        agree = sum((p >= 0.2) == (r >= 0.2) for p, r in zip(probs, ref_p))
        report[f"batch{bs}"] = {
            "p50_ms": round(statistics.median(lat), 1), "p95_ms": round(pct(lat, 0.95), 1),
            "checks_per_s": round(len(texts) / wall, 1),
            "agree_at_0.2": f"{agree}/{len(texts)}",
            "max_abs_diff": round(max(abs(p - r) for p, r in zip(probs, ref_p)), 5)}
    json.dump(report, open(out, "w"), indent=1)
    print(json.dumps(report))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4])
