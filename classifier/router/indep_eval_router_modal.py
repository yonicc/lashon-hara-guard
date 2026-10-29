"""Independent-set inference for saved router runs (no training). Texts only leave the host.

    py -m modal run classifier/router/indep_eval_router_modal.py --messages <dir> --out <file>

Loads fine-tuned runs from Volume lhg-models /router/<run> (same tokenisation as train_router_modal.predict:
max_length 96, sigmoid). The frozen-encoder e5lr runs are not persisted (sklearn heads), so they cannot be re-run.
Scoring/thresholds: indep_eval_score.py with each run's frozen DEV thresholds from its summary file.
"""
import json, pathlib
import modal
app = modal.App("lhg-router-indep-eval")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.4.1", "transformers==4.46.3", "numpy<2", "sentencepiece==0.2.0", "protobuf==5.29.3")
vol = modal.Volume.from_name("lhg-models")
RUNS = ["r2-e5s", "r2-xlmr", "r3-20261029-supervisor-e5s", "r3-20261029-supervisor-xlmr"]


@app.function(gpu="A10G", image=image, volumes={"/models": vol}, timeout=1800, cpu=4)
def probs(run, texts):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    d = pathlib.Path("/models/router") / run
    tok = AutoTokenizer.from_pretrained(d); model = AutoModelForSequenceClassification.from_pretrained(d).cuda().eval()
    labels = json.loads((d / "router_labels.json").read_text())
    out = []
    with torch.no_grad():
        for i in range(0, len(texts), 64):
            b = tok(texts[i:i + 64], padding=True, truncation=True, max_length=96, return_tensors="pt").to("cuda")
            out += torch.sigmoid(model(**b).logits.float()).cpu().numpy().round(4).tolist()
    return {"run": run, "labels": labels, "probs": out}


@app.local_entrypoint()
def main(messages: str, out: str):
    rows = []
    for name in ("messages.jsonl", "setB/messages.jsonl"):
        for s in (pathlib.Path(messages) / name).read_text(encoding="utf-8").splitlines():
            if s.strip(): rows.append(json.loads(s))
    texts = [r["text"] for r in rows]
    res = {r["run"]: {"labels": r["labels"], "probs": dict(zip([x["id"] for x in rows], r["probs"]))}
           for r in probs.starmap([(run, texts) for run in RUNS])}
    pathlib.Path(out).write_text(json.dumps(res), encoding="utf-8")
    print("DONE", list(res))
