"""Gate classifier on the Oracle ARM host - the same HTTP contract as serve_modal.py.

POST / (or /check) {"text": "..."} + header x-gate-key -> {"p", "ms", "run"}.
401 on a wrong key, 400 on missing/oversized text. GET /health -> {"ok": true} (no key,
no model call). Scoring mirrors serve_modal.Gate._score: strip, max_length=96, softmax[:,1].
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

RUN = os.environ.get("LHG_GATE_RUN", "v2")
MODEL_DIR = os.environ.get("LHG_GATE_MODEL_DIR", f"/models/{RUN}")
torch.set_num_threads(int(os.environ.get("LHG_GATE_THREADS", "2")))

tok = AutoTokenizer.from_pretrained(MODEL_DIR)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR).eval()
lock = threading.Lock()
app = FastAPI()


def score(texts: list[str]) -> list[float]:
    with lock, torch.no_grad():
        enc = tok(texts, padding=True, truncation=True, max_length=96, return_tensors="pt")
        return torch.softmax(model(**enc).logits, -1)[:, 1].tolist()


score(["warm"])  # first call pays one-off allocation costs before we accept traffic


@app.get("/health")
@app.get("/lhg-gate/health")
def health():
    return {"ok": True, "run": RUN}


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
    p = score([text.strip()])[0]
    return {"p": round(p, 4), "ms": round((time.time() - t0) * 1000, 1), "run": RUN}
