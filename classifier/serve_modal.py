"""Serve the gate classifier on Modal (CPU) and evaluate it on an independent set.

    py -m modal deploy classifier/serve_modal.py          # web endpoint
    py -m modal run classifier/serve_modal.py --data classifier/data/eval_codex_v1.jsonl

The endpoint answers POST {"text": "..."} -> {"p": <probability of concern>, "ms": ...}
and requires header x-gate-key == secret GATE_KEY (Modal secret "lhg-gate").
It is a GATE only: the proxy escalates to muse-spark when p >= threshold, and
on any gate failure or timeout it escalates too, so the gate can only save a
call, never hide a message.
"""
# No `from __future__ import annotations`: modal.parameter() needs real (not string) annotations.
import json
import os
import pathlib
import time

import modal
from fastapi import Header, HTTPException

# v2 + fp32 chosen 2026-10-26 on the fresh Codex eval (eval_codex_v2): recall 0.992,
# harmless escalated 3.9%; int8 kept the recall but escalated 7.1% of harmless.
MODEL_RUN = os.environ.get("LHG_GATE_RUN", "v2")
app = modal.App("lhg-gate")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch==2.4.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("transformers==4.46.3", "numpy<2", "fastapi[standard]==0.115.6")
    .env({"LHG_GATE_RUN": MODEL_RUN})
)
vol = modal.Volume.from_name("lhg-models")


@app.cls(image=image, volumes={"/models": vol}, cpu=2.0, memory=2048,
         secrets=[modal.Secret.from_name("lhg-gate")], scaledown_window=300)
class Gate:
    quantize: int = modal.parameter(default=0)

    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        path = f"/models/{os.environ.get('LHG_GATE_RUN', MODEL_RUN)}"
        torch.set_num_threads(2)
        self.tok = AutoTokenizer.from_pretrained(path)
        model = AutoModelForSequenceClassification.from_pretrained(path).eval()
        if self.quantize:
            model = torch.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
        self.model = model
        self.torch = torch

    def _score(self, texts: list[str]) -> list[float]:
        with self.torch.no_grad():
            enc = self.tok(texts, padding=True, truncation=True, max_length=96, return_tensors="pt")
            return self.torch.softmax(self.model(**enc).logits, -1)[:, 1].tolist()

    @modal.method()
    def score(self, texts: list[str]) -> list[float]:
        return self._score(texts)

    @modal.fastapi_endpoint(method="POST")
    def check(self, body: dict, x_gate_key: str = Header(default="")):
        import hmac

        if not hmac.compare_digest(x_gate_key or "", os.environ.get("GATE_KEY", "") or "\0"):
            raise HTTPException(status_code=401, detail="unauthorized")
        text = body.get("text") if isinstance(body, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise HTTPException(status_code=400, detail="text required (max 2000 chars)")
        t0 = time.time()
        p = self._score([text.strip()])[0]
        return {"p": round(p, 4), "ms": round((time.time() - t0) * 1000, 1),
                "run": os.environ.get("LHG_GATE_RUN", MODEL_RUN)}


@app.local_entrypoint()
def main(data: str, threshold: float = 0.2):
    rows = [json.loads(line) for line in open(data, encoding="utf-8")]
    texts = [r["text"] for r in rows]
    report = {}
    for q in (0, 1):
        gate = Gate(quantize=q)
        t0 = time.time()
        probs = []
        for i in range(0, len(texts), 32):
            probs += gate.score.remote(texts[i:i + 32])
        report["int8" if q else "fp32"] = {"seconds": round(time.time() - t0, 1),
                                          **_metrics(rows, probs, threshold)}
        if q:
            report["misses_int8"] = [
                {"text": r["text"], "gold": r["gold"], "p": round(p, 3), "why": r.get("why", "")}
                for r, p in zip(rows, probs)
                if r["gold"] != "ambiguous" and (p >= threshold) != (r["gold"] == "concern")]
            report["ambiguous_escalated"] = round(
                sum(1 for r, p in zip(rows, probs) if r["gold"] == "ambiguous" and p >= threshold)
                / max(1, sum(1 for r in rows if r["gold"] == "ambiguous")), 3)
    out = pathlib.Path(data).parent.parent / "results" / (pathlib.Path(data).stem + "_eval.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if not k.startswith("misses")}, ensure_ascii=False, indent=1))
    print("full report ->", out)


def _metrics(rows, probs, t):
    tp = fp = fn = tn = 0
    for r, p in zip(rows, probs):
        if r["gold"] == "ambiguous":
            continue
        pos, pred = r["gold"] == "concern", p >= t
        tp += pos and pred; fn += pos and not pred; fp += (not pos) and pred; tn += (not pos) and not pred
    return {"n": tp + fp + fn + tn, "concern_recall": round(tp / max(1, tp + fn), 3),
            "precision": round(tp / max(1, tp + fp), 3),
            "harmless_escalated": round(fp / max(1, fp + tn), 3)}
