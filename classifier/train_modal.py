"""Fine-tune a small Hebrew encoder as the fast gate classifier, on Modal.

The gate is RECALL-first: a false positive only costs one muse-spark call,
a false negative lets a disparaging message pass unchecked. So besides the
usual metrics we report, per threshold, concern recall and how many harmless
messages would still be escalated ("pass rate").

    py -m modal run classifier/train_modal.py --data classifier/data/v1.jsonl --run v1

Data: synthetic rows from gen_dataset.py. Rows the generator called harmless but
the blind verifier called concern are dropped (the riskiest label noise).
The trained model is saved to the Modal Volume ``lhg-models`` under /<run>.
"""
from __future__ import annotations

import json
import pathlib

import modal

app = modal.App("lhg-gate-train")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.4.1", "transformers==4.46.3", "scikit-learn==1.5.2", "numpy<2",
)
vol = modal.Volume.from_name("lhg-models", create_if_missing=True)


@app.function(gpu="T4", image=image, volumes={"/models": vol}, timeout=1800)
def train(rows: list[dict], base_model: str, epochs: int, run: str, seed: int = 13) -> dict:
    import random
    import time

    import numpy as np
    import torch
    from sklearn.metrics import f1_score, precision_score, recall_score
    from torch.utils.data import DataLoader
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    # Stratified split by category so every category appears in the test set.
    by_cat: dict[str, list[dict]] = {}
    for r in rows:
        by_cat.setdefault(r["category"], []).append(r)
    tr, te = [], []
    for cat_rows in by_cat.values():
        random.shuffle(cat_rows)
        k = max(1, int(len(cat_rows) * 0.2))
        te += cat_rows[:k]; tr += cat_rows[k:]
    random.shuffle(tr)

    tok = AutoTokenizer.from_pretrained(base_model)
    model = AutoModelForSequenceClassification.from_pretrained(base_model, num_labels=2).cuda()

    def batches(data, bs, shuffle):
        idx = list(range(len(data)))
        if shuffle:
            random.shuffle(idx)
        for i in range(0, len(idx), bs):
            chunk = [data[j] for j in idx[i:i + bs]]
            enc = tok([r["text"] for r in chunk], padding=True, truncation=True, max_length=96, return_tensors="pt")
            yield {k: v.cuda() for k, v in enc.items()}, torch.tensor([r["label"] for r in chunk]).cuda(), chunk

    opt = torch.optim.AdamW(model.parameters(), lr=3e-5, weight_decay=0.01)
    steps = epochs * ((len(tr) + 15) // 16)
    sched = get_linear_schedule_with_warmup(opt, int(0.1 * steps), steps)
    t0 = time.time()
    model.train()
    for ep in range(epochs):
        total = 0.0
        for enc, y, _ in batches(tr, 16, True):
            out = model(**enc, labels=y)
            out.loss.backward()
            opt.step(); sched.step(); opt.zero_grad()
            total += out.loss.item()
        print(f"epoch {ep + 1}/{epochs} loss {total:.2f}", flush=True)
    train_s = time.time() - t0

    model.eval()
    probs, ys, metas = [], [], []
    with torch.no_grad():
        for enc, y, chunk in batches(te, 64, False):
            p = torch.softmax(model(**enc).logits, -1)[:, 1].cpu().numpy()
            probs += p.tolist(); ys += y.cpu().tolist(); metas += chunk
    probs_a, ys_a = np.array(probs), np.array(ys)

    thresholds = {}
    for t in (0.1, 0.2, 0.3, 0.5, 0.7):
        pred = (probs_a >= t).astype(int)
        neg = ys_a == 0
        thresholds[str(t)] = {
            "concern_recall": round(float(recall_score(ys_a, pred)), 3),
            "precision": round(float(precision_score(ys_a, pred, zero_division=0)), 3),
            "f1": round(float(f1_score(ys_a, pred)), 3),
            "harmless_escalated": round(float(pred[neg].mean()) if neg.any() else 0.0, 3),
        }
    per_cat = {}
    for m, p in zip(metas, probs):
        c = per_cat.setdefault(m["category"], {"n": 0, "hit@0.3": 0})
        c["n"] += 1
        c["hit@0.3"] += int((p >= 0.3) == bool(m["label"]))
    misses = sorted(
        ({"text": m["text"], "category": m["category"], "label": m["label"], "p": round(p, 3)}
         for m, p in zip(metas, probs) if (p >= 0.3) != bool(m["label"])),
        key=lambda x: x["category"])[:40]

    # Latency on CPU is what serving will see: measure it here too.
    cpu_model = model.to("cpu")
    sample = [m["text"] for m in metas[:20]]
    with torch.no_grad():
        t1 = time.time()
        for s in sample:
            cpu_model(**tok(s, return_tensors="pt", truncation=True, max_length=96))
        cpu_ms = (time.time() - t1) * 1000 / len(sample)

    out_dir = pathlib.Path("/models") / run
    out_dir.mkdir(parents=True, exist_ok=True)
    cpu_model.save_pretrained(out_dir); tok.save_pretrained(out_dir)
    vol.commit()
    return {"run": run, "base_model": base_model, "train_rows": len(tr), "test_rows": len(te),
            "epochs": epochs, "train_seconds": round(train_s), "cpu_ms_per_message": round(cpu_ms, 1),
            "thresholds": thresholds, "per_category": per_cat, "misses": misses}


@app.local_entrypoint()
def main(data: str, run: str = "v1", base_model: str = "dicta-il/dictabert", epochs: int = 4):
    rows = [json.loads(line) for line in open(data, encoding="utf-8")]
    kept = [r for r in rows if not (r["label"] == 0 and r.get("verify") == "concern")]
    print(f"rows {len(rows)}, kept {len(kept)} (dropped harmless-labelled rows the verifier flagged)")
    res = train.remote(kept, base_model, epochs, run)
    out = pathlib.Path(data).parent.parent / "results" / f"{run}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: res[k] for k in res if k not in ("misses", "per_category")}, ensure_ascii=False, indent=1))
    print("full results ->", out)
