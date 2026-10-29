"""Independent-set inference for extractor candidates (no training). Heavy compute ONLY in Modal.

    py -m modal run --detach research/local-extractor/indep_eval_modal.py --messages <dir> --out <dir>

Runs the merged checkpoints already in Volume lhg-models on the independent set's texts only (labels never
leave the host), each model with the instruction of the contract it was trained on:
  current  = e8-natural-7b-20261028 (8 facts, contract.json; the shipped GGUF was quantized from it)
  e10v2    = e10-v2-7b-20261029-supervisor (18 facts, contract_v2.json)
Output: <out>/<model>.raw.jsonl with {id, raw, hit_limit}. Score with indep_eval_score.py.
"""
import json, pathlib, sys
import modal
ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))
from probe_modal import instruction
app = modal.App("lhg-extractor-indep-eval")
vol = modal.Volume.from_name("lhg-models")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.6.0", "transformers==4.55.4", "peft==0.17.1", "accelerate==1.10.1", "numpy==1.26.4", "sentencepiece==0.2.0"
).env({"HF_HOME": "/models/extractor-hf-cache", "TOKENIZERS_PARALLELISM": "false"}).add_local_file(
    ROOT / "pilot_modal.py", "/root/pilot_modal.py").add_local_file(ROOT / "probe_modal.py", "/root/probe_modal.py")
MODELS = {"current": ("e8-natural-7b-20261028", "contract.json"),
          "e10v2": ("e10-v2-7b-20261029-supervisor", "contract_v2.json")}


@app.function(image=image, gpu="A10G", cpu=4, memory=32768, timeout=3600, retries=0, max_containers=2,
              volumes={"/models": vol})
def infer(tag, rows, contract, system):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from pilot_modal import evaluate
    src = pathlib.Path("/models/local-extractor") / tag / "merged"
    tok = AutoTokenizer.from_pretrained(src)
    model = AutoModelForCausalLM.from_pretrained(src, torch_dtype=torch.bfloat16).cuda().eval()
    out = evaluate(model, tok, rows, contract, "cuda", instruction=system)
    return json.dumps([{"id": r["id"], "raw": r["raw"], "hit_limit": r["hit_limit"]} for r in out], ensure_ascii=False)


@app.local_entrypoint()
def main(messages: str, out: str):
    rows = []
    for name in ("messages.jsonl", "setB/messages.jsonl"):
        for s in (pathlib.Path(messages) / name).read_text(encoding="utf-8").splitlines():
            if s.strip():
                r = json.loads(s); rows.append({"id": r["id"], "text": r["text"]})
    dest = pathlib.Path(out); dest.mkdir(parents=True, exist_ok=True)
    calls = {}
    for key, (tag, cfile) in MODELS.items():
        contract = json.loads((ROOT / cfile).read_text(encoding="utf-8"))
        calls[key] = infer.spawn(tag, rows, contract, instruction(contract))
    for key, call in calls.items():
        data = json.loads(call.get())
        (dest / f"{key}.raw.jsonl").write_text("\n".join(json.dumps(d, ensure_ascii=False) for d in data) + "\n", encoding="utf-8")
        print("DONE", key, len(data), flush=True)
