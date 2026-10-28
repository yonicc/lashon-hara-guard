"""Does int8 (transformers.js) change the router's DECISIONS? Apply the fp32 run's frozen dev thresholds to the
probabilities measured by research/local-router/bench-router.mjs and score them like evaluate.py does.
With --node-dev (bench-router.mjs output on the DEV split) it also writes <run>-int8.probs.json, so evaluate.py
calibrates thresholds on the artifact that would actually ship (int8 in transformers.js).

    py -I classifier/router/compare_quant.py --summary classifier/results/router/summary_r1.json --run r1-e5s \
        --node classifier/results/router/r1-e5s.node_bench.json --holdout classifier/data/router_holdout_v1.jsonl
"""
import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from evaluate import LABELS, load, score  # noqa: E402  one home for metrics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--node", required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--node-dev", default="")
    a = ap.parse_args()
    cand = json.loads(open(a.summary, encoding="utf-8").read())["candidates"][a.run]
    th = cand["thresholds"]
    node = json.loads(open(a.node, encoding="utf-8").read())
    torch_probs = json.loads(open(pathlib.Path(a.summary).parent / f"{a.run}.probs.json", encoding="utf-8").read())["holdout"]
    hold = load(a.holdout)
    q = dict(zip(node["ids"], node["probs"]))
    t = dict(zip(torch_probs["ids"], torch_probs["probs"]))
    bin_ = lambda p: [int(p[j] >= th[l]) for j, l in enumerate(LABELS)]  # noqa: E731
    pq = [bin_(q[r["id"]]) for r in hold]
    pt = [bin_(t[r["id"]]) for r in hold]
    flips = sum(a_ != b_ for x, y in zip(pq, pt) for a_, b_ in zip(x, y))
    s = score(hold, pq)["all"]
    print(json.dumps({"run": a.run, "runtime": node["runtime"], "label_decision_flips": flips,
                      "decisions": len(hold) * len(LABELS), "int8_holdout": {k: s[k] for k in (
                          "missed_label_rate", "missed_all_rate", "missed_all_concern", "needless_rate", "getters_mean")},
                      "fp32_holdout": {k: cand["holdout"]["all"][k] for k in (
                          "missed_label_rate", "missed_all_rate", "missed_all_concern", "needless_rate", "getters_mean")}}))
    if a.node_dev:
        nd = json.loads(open(a.node_dev, encoding="utf-8").read())
        out = pathlib.Path(a.summary).parent / f"{a.run}-int8.probs.json"
        out.write_text(json.dumps({"run": a.run + "-int8", "base_model": cand["meta"].get("base_model"),
                                   "runtime": node["runtime"], "latency_node": {k: node[k] for k in (
                                       "threads", "load_ms", "p50_ms", "p95_ms", "max_ms")},
                                   "dev": {"ids": nd["ids"], "probs": nd["probs"]},
                                   "holdout": {"ids": node["ids"], "probs": node["probs"]}}), encoding="utf-8")
        print("wrote", out)


if __name__ == "__main__":
    main()
