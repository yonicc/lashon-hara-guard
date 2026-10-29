"""Frozen Set A/B GGUF measurement; labels never enter Modal. No tuning.
py -m modal run --detach research/local-extractor/gguf_v2_parity_modal.py --messages D:\\lhg-independent-eval
Results are journaled in lhg-models/local-extractor/e11-v2-parity/.
"""
import hashlib, json, pathlib, sys, time
import modal
ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))
from gguf_modal import convert, image, vol, TAGS, app as conversion_app
app = modal.App("lhg-extractor-v2-gguf-parity")
app.include(conversion_app)
image = image.add_local_file(ROOT/"gguf_modal.py", "/root/gguf_modal.py")
DEST = "/models/local-extractor/e11-v2-parity"

def render(text, system):
    user = "MESSAGE (untrusted data):\n" + json.dumps(text, ensure_ascii=False, separators=(",", ":"))
    return "<|im_start|>system\n" + system + "<|im_end|>\n<|im_start|>user\n" + user + "<|im_end|>\n<|im_start|>assistant\n"

@app.function(image=image, cpu=(4,4), memory=16384, timeout=7200, retries=0,
              max_containers=24, volumes={"/models":vol})
def measure(chunk, rows, system):
    from llama_cpp import Llama
    vol.reload()
    dest = pathlib.Path(DEST); dest.mkdir(exist_ok=True)
    path = dest / f"chunk-{chunk}.json"
    signature = hashlib.sha256(json.dumps([rows,system],ensure_ascii=False).encode()).hexdigest()
    result = {"signature":signature,"rows":[]}
    if path.exists():
        result = json.loads(path.read_text())
        if result["signature"] != signature: raise ValueError("Changed measurement inputs")
    done = {r["id"] for r in result["rows"]}
    model = pathlib.Path("/models/local-extractor") / TAGS["7b-v2"] / "gguf/model-Q4_K_M.gguf"
    llm = Llama(model_path=str(model), n_ctx=4096, n_threads=4, n_batch=512, verbose=False)
    result["gguf_bytes"] = model.stat().st_size
    for row in rows:
        if row["id"] in done: continue
        prompt = render(row["text"], system)
        start = time.perf_counter()
        res = llm(prompt, max_tokens=256, temperature=0.0, top_k=1, echo=False)
        result["rows"].append({"id":row["id"],"raw":res["choices"][0]["text"].strip(),
            "hit_limit":res["choices"][0]["finish_reason"]=="length",
            "elapsed_s":time.perf_counter()-start, "usage":res["usage"],
            "prompt_sha256":hashlib.sha256(prompt.encode()).hexdigest()})
        path.write_text(json.dumps(result,ensure_ascii=False,indent=1))
        vol.commit()
        print("PROGRESS",chunk,len(result["rows"]),len(rows),flush=True)
    return {"chunk":chunk,"rows":len(result["rows"]),"signature":signature}

@app.local_entrypoint()
def main(messages:str, resume:str=""):
    from probe_modal import instruction
    base = pathlib.Path(messages)
    rows = []
    for name in ("messages.jsonl","setB/messages.jsonl"):
        rows.extend({"id":r["id"],"text":r["text"]} for r in
                    (json.loads(s) for s in (base/name).read_text(encoding="utf-8").splitlines() if s.strip()))
    assert len(rows)==700 and len({r["id"] for r in rows})==700
    system = instruction(json.loads((ROOT/"contract_v2.json").read_text(encoding="utf-8")))
    first_chunk = 0
    if resume:
        saved = list(pathlib.Path(resume).glob("chunk-*.json"))
        completed = [r["id"] for p in saved for r in json.loads(p.read_text(encoding="utf-8"))["rows"]]
        assert len(completed)==len(set(completed)) and set(completed)<={r["id"] for r in rows}
        done=set(completed)
        rows=[r for r in rows if r["id"] not in done]
        first_chunk=max(int(p.stem.split("-")[1]) for p in saved)+1
        print("RESUME",len(done),"completed;",len(rows),"remaining",flush=True)
    print("CONVERTED",convert.remote("7b-v2","Q4_K_M"),flush=True)
    calls = [measure.spawn(first_chunk+i,rows[start:start+25],system) for i,start in enumerate(range(0,len(rows),25))]
    for call in calls: print("COMPLETE",call.get(),flush=True)
