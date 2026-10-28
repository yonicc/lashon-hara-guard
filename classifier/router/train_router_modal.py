"""Train local context-router candidates on Modal (docs/35). Research only - nothing is deployed.

    py -m modal run classifier/router/train_router_modal.py --data classifier/data/router_v1_synth.jsonl \
        --holdout classifier/data/router_holdout_v1.jsonl --cands e5s,dicta,xlmr,qwen05,e5lr --tag r1

Each candidate runs in its own GPU container (parallel). The container returns raw per-label probabilities
for the DEV split and the holdout; thresholds and metrics live only in classifier/router/evaluate.py.
The holdout is scored, never trained on. Models go to Volume lhg-models under /router/<tag>-<cand>; encoder
candidates are also exported to ONNX there (onnx/model.onnx) for the CPU / transformers.js latency test.
"""
import json
import pathlib
import time

import modal

app = modal.App("lhg-router-train")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.4.1", "transformers==4.46.3", "scikit-learn==1.5.2", "numpy<2",
    "sentencepiece==0.2.0", "protobuf==5.29.3", "onnx==1.16.2",
)
vol = modal.Volume.from_name("lhg-models", create_if_missing=True)
GPU = "A10G"

CANDS = {
    "e5s": {"base": "intfloat/multilingual-e5-small", "lr": 5e-5, "epochs": 6, "bs": 32},
    "dicta": {"base": "dicta-il/dictabert", "lr": 3e-5, "epochs": 4, "bs": 32},
    "xlmr": {"base": "xlm-roberta-base", "lr": 2e-5, "epochs": 5, "bs": 32},
    "qwen05": {"base": "Qwen/Qwen2.5-0.5B-Instruct", "lr": 2e-5, "epochs": 3, "bs": 16, "decoder": True},
    "e5lr": {"base": "intfloat/multilingual-e5-small", "frozen": True},
}


def _cpu_latency(fn, texts):
    import numpy as np
    ts = []
    for t in texts:
        t0 = time.perf_counter(); fn(t); ts.append((time.perf_counter() - t0) * 1000)
    ts = ts[3:]  # warm-up
    return {"p50_ms": round(float(np.percentile(ts, 50)), 1), "p95_ms": round(float(np.percentile(ts, 95)), 1)}


@app.function(gpu=GPU, image=image, volumes={"/models": vol}, timeout=3600, cpu=4)
def run_candidate(name: str, cfg: dict, train: list, dev: list, hold: list, labels: list, tag: str) -> dict:
    import random

    import numpy as np
    import torch
    from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer, \
        get_linear_schedule_with_warmup

    random.seed(13); np.random.seed(13); torch.manual_seed(13)
    run = f"{tag}-{name}"
    tok = AutoTokenizer.from_pretrained(cfg["base"])
    Y = lambda rows: torch.tensor([[float(l in r["labels"]) for l in labels] for r in rows])  # noqa: E731
    texts_lat = [r["text"] for r in hold[:43]]
    t0 = time.time()

    if cfg.get("frozen"):
        from sklearn.linear_model import LogisticRegression
        enc = AutoModel.from_pretrained(cfg["base"]).cuda().eval()

        def embed(rows, dev_="cuda"):
            out = []
            with torch.no_grad():
                for i in range(0, len(rows), 128):
                    b = tok(["query: " + r["text"] for r in rows[i:i + 128]], padding=True, truncation=True,
                            max_length=96, return_tensors="pt").to(dev_)
                    h = enc(**b).last_hidden_state
                    m = b["attention_mask"].unsqueeze(-1).float()
                    e = (h * m).sum(1) / m.sum(1)
                    out.append(torch.nn.functional.normalize(e, dim=-1).cpu())
            return torch.cat(out).numpy()
        Xtr, ytr = embed(train), Y(train).numpy()
        heads = [LogisticRegression(C=4.0, max_iter=2000, class_weight="balanced").fit(Xtr, ytr[:, j])
                 for j in range(len(labels))]
        predict = lambda rows: np.stack([h.predict_proba(embed(rows))[:, 1] for h in heads], 1)  # noqa: E731
        train_s = time.time() - t0
        dprobs, hprobs = predict(dev), predict(hold)
        enc = enc.cpu(); torch.set_num_threads(2)
        lat = _cpu_latency(lambda t: [h.predict_proba(embed([{"text": t}], "cpu")) for h in heads[:1]], texts_lat)
        params = sum(p.numel() for p in enc.parameters())
    else:
        model = AutoModelForSequenceClassification.from_pretrained(
            cfg["base"], num_labels=len(labels), problem_type="multi_label_classification")
        if cfg.get("decoder"):
            if tok.pad_token is None:
                tok.pad_token = tok.eos_token
            model.config.pad_token_id = tok.pad_token_id
        model = model.cuda()
        bs = cfg["bs"]
        opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=0.01)
        steps = cfg["epochs"] * ((len(train) + bs - 1) // bs)
        sched = get_linear_schedule_with_warmup(opt, int(0.1 * steps), steps)
        Ytr = Y(train)
        model.train()
        for ep in range(cfg["epochs"]):
            idx = list(range(len(train))); random.shuffle(idx); total = 0.0
            for i in range(0, len(idx), bs):
                ch = idx[i:i + bs]
                b = tok([train[k]["text"] for k in ch], padding=True, truncation=True, max_length=96,
                        return_tensors="pt").to("cuda")
                with torch.autocast("cuda", dtype=torch.bfloat16, enabled=bool(cfg.get("decoder"))):
                    out = model(**b, labels=Ytr[ch].cuda())
                out.loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step(); sched.step(); opt.zero_grad(); total += out.loss.item()
            print(f"{run} epoch {ep + 1}/{cfg['epochs']} loss {total:.2f}", flush=True)
        train_s = time.time() - t0
        model.eval()

        def predict(rows, dev_="cuda"):
            ps = []
            with torch.no_grad():
                for i in range(0, len(rows), 64):
                    b = tok([r["text"] for r in rows[i:i + 64]], padding=True, truncation=True, max_length=96,
                            return_tensors="pt").to(dev_)
                    ps.append(torch.sigmoid(model(**b).logits.float()).cpu())
            return torch.cat(ps).numpy()
        dprobs, hprobs = predict(dev), predict(hold)
        model = model.float().cpu(); torch.set_num_threads(2)
        lat = _cpu_latency(lambda t: predict([{"text": t}], "cpu"), texts_lat)
        params = sum(p.numel() for p in model.parameters())
        outd = pathlib.Path("/models/router") / run
        outd.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(outd); tok.save_pretrained(outd)
        (outd / "router_labels.json").write_text(json.dumps(labels))
        if not cfg.get("decoder"):
            (outd / "onnx").mkdir(exist_ok=True)
            d = tok(["שלום world"], return_tensors="pt")
            torch.onnx.export(model, (d["input_ids"], d["attention_mask"]), str(outd / "onnx" / "model.onnx"),
                              input_names=["input_ids", "attention_mask"], output_names=["logits"],
                              dynamic_axes={"input_ids": {0: "b", 1: "s"}, "attention_mask": {0: "b", 1: "s"},
                                            "logits": {0: "b"}}, opset_version=14)
        vol.commit()
    return {"run": run, "base_model": cfg["base"], "cfg": cfg, "gpu": GPU, "train_rows": len(train),
            "train_seconds": round(train_s), "container_seconds": round(time.time() - t0), "params": params,
            "container_cpu2_latency": lat,
            "dev": {"ids": [r["id"] for r in dev], "probs": np.round(dprobs, 4).tolist()},
            "holdout": {"ids": [r["id"] for r in hold], "probs": np.round(hprobs, 4).tolist()}}


@app.local_entrypoint()
def main(data: str, holdout: str, cands: str = "e5s,e5lr", tag: str = "r1"):
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from evaluate import LABELS, heads_of  # one home for the 6 -> 3 head mapping (labels.json "heads")

    labels = LABELS
    rows = [json.loads(l) for l in open(data, encoding="utf-8") if l.strip()]
    slim = lambda r: {"id": r["id"], "text": r["text"], "labels": heads_of(r["labels"])}  # noqa: E731
    train = [slim(r) for r in rows if r["split"] == "train"]
    dev = [slim(r) for r in rows if r["split"] == "dev"]
    hold = [slim(json.loads(l)) for l in open(holdout, encoding="utf-8") if l.strip()]
    names = [c.strip() for c in cands.split(",") if c.strip()]
    print(f"train {len(train)} dev {len(dev)} holdout {len(hold)} cands {names}")
    outdir = pathlib.Path(data).resolve().parent.parent / "results" / "router"
    outdir.mkdir(parents=True, exist_ok=True)
    calls = [run_candidate.spawn(n, CANDS[n], train, dev, hold, labels, tag) for n in names]
    for n, c in zip(names, calls):
        try:
            res = c.get()
        except Exception as e:  # one failed candidate must not lose the others
            print(f"{n} FAILED: {e!r}"); continue
        (outdir / f"{res['run']}.probs.json").write_text(json.dumps(res), encoding="utf-8")
        print(n, {k: res[k] for k in ("train_seconds", "container_seconds", "params", "container_cpu2_latency")})
