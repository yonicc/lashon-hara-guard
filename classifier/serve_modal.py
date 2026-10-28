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
# Multilingual 2nd model for Latin-script text, max of both (gate_route.py, docs/31).
# Empty = Hebrew-only gate (rollback: deploy with LHG_GATE_RUN_ML=).
MODEL_RUN_ML = os.environ.get("LHG_GATE_RUN_ML", "v4-xlmr-ml")
app = modal.App("lhg-gate")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch==2.4.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("transformers==4.46.3", "numpy<2", "fastapi[standard]==0.115.6")
    .env({"LHG_GATE_RUN": MODEL_RUN, "LHG_GATE_RUN_ML": MODEL_RUN_ML})
    .add_local_python_source("gate_route")
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
        self.run_ml = os.environ.get("LHG_GATE_RUN_ML", "")
        self.ml = None
        if self.run_ml:
            ml_path = f"/models/{self.run_ml}"
            self.ml = (AutoTokenizer.from_pretrained(ml_path),
                       AutoModelForSequenceClassification.from_pretrained(ml_path).eval())

    def _probs(self, tok, model, texts: list[str]) -> list[float]:
        enc = tok(texts, padding=True, truncation=True, max_length=96, return_tensors="pt")
        return self.torch.softmax(model(**enc).logits, -1)[:, 1].tolist()

    def _score_routed(self, texts: list[str]):
        """[(p, used_ml)] - routing/combination live only in gate_route.py."""
        from gate_route import combine, uses_second_model

        with self.torch.no_grad():
            ps = self._probs(self.tok, self.model, texts)
            idx = [i for i, t in enumerate(texts) if self.ml and uses_second_model(t)]
            ml_ps = dict(zip(idx, self._probs(*self.ml, [texts[i] for i in idx]))) if idx else {}
        return [(combine(p, ml_ps.get(i)), i in ml_ps) for i, p in enumerate(ps)]

    def _score(self, texts: list[str]) -> list[float]:
        return [p for p, _ in self._score_routed(texts)]

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
        from gate_route import run_label

        p, used_ml = self._score_routed([text.strip()])[0]
        return {"p": round(p, 4), "ms": round((time.time() - t0) * 1000, 1),
                "run": run_label(os.environ.get("LHG_GATE_RUN", MODEL_RUN), self.run_ml, used_ml)}


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
