"""Print markdown tables (per head x language precision/recall, and the summary rates) from evaluate.py output.

    py -I classifier/router/table.py classifier/results/router/summary_r2.json r2-xlmr,qwen72b-teacher
"""
import json
import sys

summary, runs = sys.argv[1], sys.argv[2].split(",")
d = json.loads(open(summary, encoding="utf-8").read())
for run in runs:
    c = d["candidates"][run]
    print(f"\n**{run}** thresholds (dev, recall>={d['target_recall']}): {c.get('thresholds', '-')}\n")
    print("| split | lang | " + " | ".join(f"{l} P/R" for l in d["labels"]) + " | missed heads | no-expansion miss | needless |")
    print("|---|---|" + "---|" * (len(d["labels"]) + 3))
    for split in ("dev", "holdout"):
        for lang in ("all", "he", "en", "mixed"):
            s = c[split].get(lang)
            if not s:
                continue
            cells = []
            for l in d["labels"]:
                p = s["per_label"][l]
                cells.append(f"{p['precision']}/{p['recall']} (n={p['support']})")
            print(f"| {split} | {lang} | " + " | ".join(cells) +
                  f" | {s['missed_label_rate']} | {s['missed_all_rate']} | {s['needless_rate']} |")
