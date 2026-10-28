"""Score several gate runs from the lhg-models Volume on the same rows; never deploy.

    py -m modal run classifier/eval_candidates.py --runs v2,v4-dicta-ml --out classifier/results/v4_comparison.json

The first run is the baseline. Scoring mirrors serve_modal.Gate._score
(strip, max_length 96, softmax[:,1]) on CPU, so numbers match serving.
Ambiguous rows are excluded from binary rates. A candidate is only
"regression_passed" if, at the threshold, no dataset/language slice has
more concern misses than the baseline AND the fresh holdout does not
lose recall. Promotion still needs Oracle parity/latency checks.
"""
import hashlib
import json
import pathlib
import re
import time

import modal

THRESHOLD = 0.2
FILES = ("eval_codex_v2.jsonl", "phase_a_multilingual_v1.jsonl",
         "multilingual_expansion_v1.jsonl", "holdout_agent_v1.jsonl")
TRAIN_FILES = ("v1.jsonl", "v2_aug.jsonl", "v3_translated.jsonl")

app = modal.App("lhg-gate-eval-candidates")
image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("torch==2.4.1", index_url="https://download.pytorch.org/whl/cpu")
         .pip_install("transformers==4.46.3", "numpy<2", "sentencepiece==0.2.0", "protobuf==5.29.3"))
vol = modal.Volume.from_name("lhg-models")


@app.function(image=image, volumes={"/models": vol}, cpu=4.0, memory=4096, timeout=1200, max_containers=4)
def score(run: str, texts: list[str]) -> dict:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.set_num_threads(4)
    tok = AutoTokenizer.from_pretrained(f"/models/{run}")
    model = AutoModelForSequenceClassification.from_pretrained(f"/models/{run}").eval()
    ps, t0 = [], time.time()
    with torch.no_grad():
        for i in range(0, len(texts), 32):
            enc = tok([t.strip() for t in texts[i:i + 32]], padding=True, truncation=True,
                      max_length=96, return_tensors="pt")
            ps += torch.softmax(model(**enc).logits, -1)[:, 1].tolist()
    t1 = time.time()
    with torch.no_grad():
        for t in texts[:40]:
            model(**tok(t.strip(), return_tensors="pt", truncation=True, max_length=96))
    single_ms = (time.time() - t1) * 1000 / min(40, len(texts))
    return {"p": ps, "batch_seconds": t1 - t0, "single_ms_4cpu": single_ms}


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", s)).strip().lower()


def metrics(rows, key):
    clear = [r for r in rows if r["gold"] != "ambiguous"]
    fn = sum(r["gold"] == "concern" and r[key] < THRESHOLD for r in clear)
    tp = sum(r["gold"] == "concern" and r[key] >= THRESHOLD for r in clear)
    fp = sum(r["gold"] == "no_concern" and r[key] >= THRESHOLD for r in clear)
    tn = sum(r["gold"] == "no_concern" and r[key] < THRESHOLD for r in clear)
    return {"concern": tp + fn, "misses": fn, "harmless": fp + tn, "escalated": fp,
            "ambiguous_escalated": sum(r[key] >= THRESHOLD for r in rows if r["gold"] == "ambiguous")}


@app.local_entrypoint()
def main(runs: str, out: str):
    root = pathlib.Path(__file__).resolve().parent
    runs_l = [r.strip() for r in runs.split(",") if r.strip()]
    training, hashes = set(), {}
    for name in TRAIN_FILES:
        p = root / "data" / name
        if p.exists():
            hashes[name] = hashlib.sha256(p.read_bytes()).hexdigest()
            training.update(norm(json.loads(l)["text"]) for l in p.read_text(encoding="utf-8").splitlines())
    rows = []
    for name in FILES:
        p = root / "data" / name
        hashes[name] = hashlib.sha256(p.read_bytes()).hexdigest()
        for l in p.read_text(encoding="utf-8").splitlines():
            r = json.loads(l)
            r["dataset"], r["language"] = name, r.get("language", "he")
            r["training_overlap"] = norm(r["text"]) in training
            rows.append(r)
    texts = [r["text"] for r in rows]
    results = list(score.starmap([(run, texts) for run in runs_l]))
    report = {"threshold": THRESHOLD, "runs": runs_l, "sha256": hashes, "timing": {}, "slices": {}}
    for run, res in zip(runs_l, results):
        for r, p in zip(rows, res["p"]):
            r[run] = round(p, 4)
        report["timing"][run] = {k: round(v, 2) for k, v in res.items() if k != "p"}
    slices = sorted({(r["dataset"], r["language"]) for r in rows})
    for ds, lang in slices:
        sub = [r for r in rows if r["dataset"] == ds and r["language"] == lang and not r["training_overlap"]]
        report["slices"][f"{ds}:{lang}"] = {run: metrics(sub, run) for run in runs_l}
    base = runs_l[0]
    report["verdict"] = {}
    for run in runs_l[1:]:
        worse = [k for k, v in report["slices"].items() if v[run]["misses"] > v[base]["misses"]]
        report["verdict"][run] = {"slices_with_more_misses": worse, "regression_passed": not worse}
    report["overlap_excluded"] = sum(r["training_overlap"] for r in rows)
    pathlib.Path(out).write_text(json.dumps({"report": report, "predictions": rows}, ensure_ascii=False, indent=1),
                                 encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, indent=1))
