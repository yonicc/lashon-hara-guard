"""Train the modern 4B candidate on the SAME 842 templates. All evaluation remains diagnostic."""
import json
import pathlib
import sys
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from pilot_modal import gpu_run,cpu_run
from probe_modal import instruction,MODEL
app=modal.App("lhg-extractor-4b-lora")
vol=modal.Volume.from_name("lhg-models")
image=modal.Image.debian_slim(python_version="3.11").pip_install(
 "torch==2.6.0","transformers==4.55.4","peft==0.17.1","accelerate==1.10.1","numpy==1.26.4"
).env({"HF_HOME":"/models/extractor-hf-cache","TOKENIZERS_PARALLELISM":"false"}).add_local_file(
 ROOT/"pilot_modal.py","/root/pilot_modal.py").add_local_file(ROOT/"probe_modal.py","/root/probe_modal.py")

@app.function(image=image,gpu="A10G",cpu=4,memory=16384,timeout=2400,retries=0,
              max_containers=1,volumes={"/models":vol})
def train4(train,rows,contract,tag,system):
    return gpu_run.local(train,rows,contract,tag,base=MODEL,big=None,instruction=system,
                         train_batch=2,prefix="qwen3-4b",function_timeout_s=2400)

@app.function(image=image,cpu=(4,4),memory=32768,timeout=1800,retries=0,
              max_containers=1,volumes={"/models":vol})
def cpu4(rows,contract,tag,system):
    return cpu_run.local(rows,contract,tag,quantize=False,instruction=system)

@app.local_entrypoint()
def main(tag: str="e4-20261028",cpu_only: bool=False):
    import hashlib
    load=lambda n:[json.loads(s) for s in (ROOT/n).read_text(encoding="utf-8").splitlines()]
    train=load("train.jsonl")
    rows=load("legacy.jsonl")+load("fresh.jsonl")+load("confirmation.jsonl")
    contract=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
    folder=ROOT/"results";folder.mkdir(exist_ok=True);system=instruction(contract)
    manifest={"tag":tag,"evaluation_status":"Development diagnostics; e2 results already inspected.",
      "sha256":{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in
       ["contract.json","train.jsonl","legacy.jsonl","fresh.jsonl","confirmation.jsonl"]}}
    (folder/f"{tag}-manifest.json").write_text(json.dumps(manifest,indent=1),encoding="utf-8")
    if not cpu_only:
        r=train4.remote(train,rows,contract,tag,system)
        r["evaluation_rows"]=rows
        (folder/f"{tag}-gpu.json").write_text(json.dumps(r,ensure_ascii=False,indent=1),encoding="utf-8")
    ids=[f"confirm-{i}-{lang}" for i,lang in [
      (1,"he"),(1,"en"),(4,"he"),(4,"en"),(7,"he"),(7,"en"),(11,"he"),(11,"en")]]
    subset=[next(r for r in rows if r["id"]==id_) for id_ in ids]
    cpu=cpu4.remote(subset,contract,tag,system)
    (folder/f"{tag}-cpu.json").write_text(json.dumps(cpu,ensure_ascii=False,indent=1),encoding="utf-8")
    print("COMPLETE",tag,flush=True)
