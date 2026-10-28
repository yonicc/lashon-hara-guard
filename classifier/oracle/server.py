"""Gate classifier on the Oracle ARM host - the same HTTP contract as serve_modal.py.

POST / (or /check) {"text": "..."} + header x-gate-key -> {"p", "ms", "run"}.
401 on a wrong key, 400 on missing/oversized text. GET /health -> {"ok": true} (no key,
no model call). Scoring mirrors serve_modal.Gate._score: strip, max_length=96, softmax[:,1].
Language routing (second multilingual model, max of both) lives only in gate_route.py.
One request is scored at a time (a lock), like one Modal container.
The same routes also answer under /lhg-gate/... : the public path on the shared
shiurim.ysho.uk tunnel (cloudflared forwards the path unchanged).
"""
import hmac
import os
import threading
import time

import torch
from fastapi import FastAPI, Header, HTTPException
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from gate_route import combine, run_label, uses_second_model

RUN = os.environ.get("LHG_GATE_RUN", "v2")
RUN_ML = os.environ.get("LHG_GATE_RUN_ML", "")
MODEL_DIR = os.environ.get("LHG_GATE_MODEL_DIR", f"/models/{RUN}")
torch.set_num_threads(int(os.environ.get("LHG_GATE_THREADS", "2")))


def load(path):
    return (AutoTokenizer.from_pretrained(path),
            AutoModelForSequenceClassification.from_pretrained(path).eval())


tok, model = load(MODEL_DIR)
ml = load(f"/models/{RUN_ML}") if RUN_ML else None
lock = threading.Lock()
app = FastAPI()


def _probs(tk, md, texts: list[str]) -> list[float]:
    enc = tk(texts, padding=True, truncation=True, max_length=96, return_tensors="pt")
    return torch.softmax(md(**enc).logits, -1)[:, 1].tolist()


def score(texts: list[str]) -> list[float]:
    with lock, torch.no_grad():
        return _probs(tok, model, texts)


def score_one(text: str):
    """(p, run) for one stripped text, routed by gate_route."""
    with lock, torch.no_grad():
        p = _probs(tok, model, [text])[0]
        used = bool(ml) and uses_second_model(text)
        p_ml = _probs(ml[0], ml[1], [text])[0] if used else None
    return combine(p, p_ml), run_label(RUN, RUN_ML, used)


score_one("warm")  # first call pays one-off allocation costs before we accept traffic
if ml:
    score_one("warm up")


@app.get("/health")
@app.get("/lhg-gate/health")
def health():
    return {"ok": True, "run": run_label(RUN, RUN_ML, bool(ml))}


@app.post("/")
@app.post("/check")
@app.post("/lhg-gate")
@app.post("/lhg-gate/check")
def check(body: dict, x_gate_key: str = Header(default="")):
    if not hmac.compare_digest(x_gate_key or "", os.environ.get("GATE_KEY", "") or "\0"):
        raise HTTPException(status_code=401, detail="unauthorized")
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise HTTPException(status_code=400, detail="text required (max 2000 chars)")
    t0 = time.time()
    p, run = score_one(text.strip())
    return {"p": round(p, 4), "ms": round((time.time() - t0) * 1000, 1), "run": run}
