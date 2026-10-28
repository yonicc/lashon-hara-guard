"""e10: LoRA on the 18-fact v2 data (contract_v2.json). Heavy compute ONLY in Modal. Does not touch v1 files.

    py -m modal run --detach research/local-extractor/train_v2_modal.py --candidate 7b --tag e10-v2-7b-<date>
    py research/local-extractor/score.py --contract contract_v2.json --tag e10-v2-7b-<date>

Same LoRA recipe and shared code as e8 (pilot_modal.gpu_run: r16, q/k/v/o, 2 epochs, lr 1e-4); only the contract
and the data change. Train = train_v2.jsonl (templates + natural v2). Evaluation = dev_v2 + holdout_v2, both
DEVELOPMENT sets (same author/pipeline); the scores are diagnostics, never an independent benchmark.
Refuses to start unless split_v2.py --check passes (data on disk == manifest_v2.json, no cross-split leakage).
"""
import hashlib, json, pathlib, subprocess, sys, time
import modal
ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))
from pilot_modal import gpu_run
from probe_modal import instruction
MODELS = {"7b": "Qwen/Qwen2.5-7B-Instruct", "dicta": "dicta-il/dictalm2.0-instruct", "4b": "Qwen/Qwen3-4B-Instruct-2507"}
app = modal.App("lhg-extractor-v2-18facts")
vol = modal.Volume.from_name("lhg-models")
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.6.0", "transformers==4.55.4", "peft==0.17.1", "accelerate==1.10.1", "numpy==1.26.4", "sentencepiece==0.2.0"
).env({"HF_HOME": "/models/extractor-hf-cache", "TOKENIZERS_PARALLELISM": "false"}).add_local_file(
    ROOT / "pilot_modal.py", "/root/pilot_modal.py").add_local_file(ROOT / "probe_modal.py", "/root/probe_modal.py")
FILES = ["contract_v2.json", "train_v2.jsonl", "dev_v2.jsonl", "holdout_v2.jsonl", "manifest_v2.json"]


@app.function(image=image, gpu="H100", cpu=4, memory=32768, timeout=7200, retries=0, max_containers=2, volumes={"/models": vol})
def experiment(train, rows, contract, tag, candidate, system, max_train_tokens):
    started = time.time()
    result = gpu_run.local(train, rows, contract, tag, base=MODELS[candidate], big=None, instruction=system,
                           train_batch=4, prefix="v2-" + candidate, function_timeout_s=7200,
                           max_train_tokens=max_train_tokens, checkpoint_every=100)
    result["evaluation_rows"] = rows; result["candidate"] = candidate; result["prompt"] = system
    result["total_gpu_function_seconds"] = time.time() - started
    (pathlib.Path("/models/local-extractor") / tag / "comparison.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    vol.commit()
    return "DONE"  # see natural_modal.py: rich RPC results fail to unpickle without torch locally


def eval_rows(name, split):
    out = []
    for s in (ROOT / name).read_text(encoding="utf-8").splitlines():
        r = json.loads(s)
        out.append({"id": r["id"], "text": r["text"], "language": r["language"], "split": split,
                    "expect": {k: v[0] for k, v in r["gold"].items()}, "family": r["family"]})
    return out


@app.local_entrypoint()
def main(tag: str, candidate: str = "7b", max_train_tokens: int = 2048, eval_cap: int = 0, resume: bool = False):
    if candidate not in MODELS: raise ValueError(candidate)
    chk = subprocess.run([sys.executable, str(ROOT / "split_v2.py"), "--check"], capture_output=True, text=True)
    if chk.returncode: raise SystemExit("split_v2.py --check failed; data on disk is not the manifest's:\n" + chk.stdout + chk.stderr)
    load = lambda n: [json.loads(s) for s in (ROOT / n).read_text(encoding="utf-8").splitlines()]
    train = [{"id": r["id"], "text": r["text"], "gold": r["gold"]} for r in load("train_v2.jsonl")]
    rows = eval_rows("dev_v2.jsonl", "v2dev") + eval_rows("holdout_v2.jsonl", "v2holdout")
    if eval_cap: rows = rows[:eval_cap]
    contract = json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))
    out = ROOT / "results"; out.mkdir(exist_ok=True)
    manifest = {"tag": tag, "model": MODELS[candidate], "train_rows": len(train), "eval_rows": len(rows),
                "max_train_tokens": max_train_tokens,
                "evaluation_status": "dev_v2/holdout_v2 are development sets; diagnostics only",
                "scope": "18 candidate facts, synthetic only; no deployment; heavy work only on Modal",
                "sha256": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in FILES}}
    mpath = out / f"{tag}-manifest.json"
    if mpath.exists():
        if not resume: raise ValueError("Tag already reserved; use a fresh tag or --resume")
        if json.loads(mpath.read_text())["sha256"] != manifest["sha256"]: raise ValueError("Resume refused: inputs changed")
        print("RESUME", tag, flush=True)
    else:
        mpath.write_text(json.dumps(manifest, indent=2))
    try:
        experiment.remote(train, rows, contract, tag, candidate, instruction(contract), max_train_tokens)
    except modal.exception.DeserializationError as exc:
        print("RPC result not decodable locally; reading the Volume artifact:", exc, flush=True)
    raw = b"".join(vol.read_file(f"local-extractor/{tag}/comparison.json"))
    (out / f"{tag}-gpu.json").write_bytes(raw)
    print("COMPLETE", tag, flush=True)
