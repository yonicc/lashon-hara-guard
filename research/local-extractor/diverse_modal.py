"""Bounded improved-data comparison. Heavy compute runs ONLY in Modal."""
import hashlib,json,pathlib,sys,time
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from pilot_modal import gpu_run,evaluate
from probe_modal import instruction
MODELS={"4b":"Qwen/Qwen3-4B-Instruct-2507","7b":"Qwen/Qwen2.5-7B-Instruct"}
app=modal.App("lhg-extractor-diverse-v2")
vol=modal.Volume.from_name("lhg-models")
image=modal.Image.debian_slim(python_version="3.11").pip_install(
 "torch==2.6.0","transformers==4.55.4","peft==0.17.1","accelerate==1.10.1","numpy==1.26.4"
).env({"HF_HOME":"/models/extractor-hf-cache","TOKENIZERS_PARALLELISM":"false"}).add_local_file(
 ROOT/"pilot_modal.py","/root/pilot_modal.py").add_local_file(ROOT/"probe_modal.py","/root/probe_modal.py")

@app.function(image=image,gpu="A10G",cpu=4,memory=24576,timeout=4800,retries=0,
              max_containers=1,volumes={"/models":vol})
def experiment(train,rows,contract,tag,candidate,system):
    started=time.time()
    # Same LoRA settings as the pilot; change training data, not epochs.
    result=gpu_run.local(train,rows,contract,tag,base=MODELS[candidate],big=None,
       instruction=system,train_batch=2 if candidate=="4b" else 1,
       prefix="diverse-"+candidate,function_timeout_s=4800,max_train_tokens=1024,checkpoint_every=100)
    result["evaluation_rows"]=rows
    result["candidate"]=candidate
    result["prompt"]=system
    if candidate=="4b":
        import torch
        from transformers import AutoModelForCausalLM,AutoTokenizer
        old=pathlib.Path("/models/local-extractor/e4-20261028/merged")
        if not old.exists():raise FileNotFoundError("Original pilot artifact missing")
        tok=AutoTokenizer.from_pretrained(old)
        model=AutoModelForCausalLM.from_pretrained(old,torch_dtype=torch.bfloat16).cuda().eval()
        result["runs"]["pilot4b-original-data"]=evaluate(model,tok,rows,contract,"cuda",instruction=system)
    result["total_gpu_function_seconds"]=time.time()-started
    (pathlib.Path("/models/local-extractor")/tag/"comparison.json").write_text(
        json.dumps(result,ensure_ascii=False,indent=1))
    vol.commit()
    # JSON across RPC keeps the management client independent of Torch classes.
    return json.dumps(result,ensure_ascii=False)

@app.local_entrypoint()
def main(tag:str="e6-diverse-4b-20261028",candidate:str="4b"):
    if candidate not in MODELS:raise ValueError(candidate)
    def load(path):return [json.loads(s) for s in (ROOT/path).read_text(encoding="utf-8").splitlines()]
    train=load("diverse/train.jsonl")
    rows=load("legacy.jsonl")+load("fresh.jsonl")+load("confirmation.jsonl")+load("diverse/sealed.jsonl")
    contract=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
    system=instruction(contract)
    output=ROOT/"results";output.mkdir(exist_ok=True)
    destination=output/f"{tag}-gpu.json"
    if destination.exists():raise ValueError("Refuse result overwrite")
    if (output/f"{tag}-manifest.json").exists():
        raise ValueError("Tag already reserved; use a fresh tag or retrieve saved results")
    files=["contract.json","diverse/train.jsonl","diverse/sealed.jsonl","pilot_modal.py","diverse_modal.py"]
    manifest={"tag":tag,"model":MODELS[candidate],"budget_ceiling_usd":15,
       "scope":"eight candidate facts, synthetic only; no deployment; no local heavy work",
       "sha256":{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in files}}
    (output/f"{tag}-manifest.json").write_text(json.dumps(manifest,indent=2))
    result=json.loads(experiment.remote(train,rows,contract,tag,candidate,system))
    destination.write_text(json.dumps(result,ensure_ascii=False,indent=1),encoding="utf-8")
    print("COMPLETE",tag,flush=True)
