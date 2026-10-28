"""e8: train on diverse v2 + natural v1 (gen_natural_modal.py); compare candidates. Heavy compute ONLY in Modal.

    modal run --detach research/local-extractor/natural_modal.py --candidate 7b --tag e8-natural-7b-20261028
    modal run --detach research/local-extractor/natural_modal.py --candidate dicta --tag e8-natural-dicta-20261028

Same LoRA recipe as e6 (r16, q/k/v/o, 2 epochs, lr 1e-4); only the data and the base model change.
Evaluation adds sealed_v3 (diverse/sealed_v3.jsonl), authored before any e8 data existed.
"""
import hashlib,json,pathlib,random,sys,time
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from pilot_modal import gpu_run
from probe_modal import instruction
MODELS={"7b":"Qwen/Qwen2.5-7B-Instruct","dicta":"dicta-il/dictalm2.0-instruct","4b":"Qwen/Qwen3-4B-Instruct-2507"}
app=modal.App("lhg-extractor-natural-v1")
vol=modal.Volume.from_name("lhg-models")
image=modal.Image.debian_slim(python_version="3.11").pip_install(
 "torch==2.6.0","transformers==4.55.4","peft==0.17.1","accelerate==1.10.1","numpy==1.26.4","sentencepiece==0.2.0"
).env({"HF_HOME":"/models/extractor-hf-cache","TOKENIZERS_PARALLELISM":"false"}).add_local_file(
 ROOT/"pilot_modal.py","/root/pilot_modal.py").add_local_file(ROOT/"probe_modal.py","/root/probe_modal.py")

@app.function(image=image,gpu="H100",cpu=4,memory=32768,timeout=5400,retries=0,max_containers=2,volumes={"/models":vol})
def experiment(train,rows,contract,tag,candidate,system):
    started=time.time()
    result=gpu_run.local(train,rows,contract,tag,base=MODELS[candidate],big=None,instruction=system,
       train_batch=4,prefix="natural-"+candidate,function_timeout_s=5400,max_train_tokens=1024,checkpoint_every=100)
    result["evaluation_rows"]=rows;result["candidate"]=candidate;result["prompt"]=system
    result["total_gpu_function_seconds"]=time.time()-started
    (pathlib.Path("/models/local-extractor")/tag/"comparison.json").write_text(json.dumps(result,ensure_ascii=False,indent=1))
    vol.commit()
    # Return nothing rich: e6 runs finished but the Torch-less client failed to unpickle the RPC result
    # (DeserializationError: 'torch'). The client reads comparison.json from the Volume instead.
    return "DONE"

@app.local_entrypoint()
def main(tag:str,candidate:str="7b",natural:str="diverse/natural_v1.jsonl",cap:int=2400,resume:bool=False):
    if candidate not in MODELS:raise ValueError(candidate)
    def load(path):return [json.loads(s) for s in (ROOT/path).read_text(encoding="utf-8").splitlines()]
    # Hebrew/mixed are the gap: take all of them, fill the cap with English.
    nat=load(natural);random.Random(5).shuffle(nat)
    nat=[r for r in nat if r["language"]!="en"]+[r for r in nat if r["language"]=="en"]
    train=load("diverse/train.jsonl")+nat[:cap];random.Random(6).shuffle(train)
    rows=(load("legacy.jsonl")+load("fresh.jsonl")+load("confirmation.jsonl")+load("diverse/sealed.jsonl")
          +load("diverse/sealed_v3.jsonl"))
    contract=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
    output=ROOT/"results";output.mkdir(exist_ok=True)
    files=["contract.json","diverse/train.jsonl",natural,"diverse/sealed_v3.jsonl","pilot_modal.py","natural_modal.py"]
    manifest={"tag":tag,"model":MODELS[candidate],"train_rows":len(train),"natural_rows":min(cap,len(nat)),
       "scope":"eight candidate facts, synthetic only; no deployment; heavy work only on Modal",
       "sha256":{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in files if p!="natural_modal.py"}}
    mpath=output/f"{tag}-manifest.json"
    if mpath.exists():
        # Resume only with identical inputs; gpu_run also refuses a changed train/eval identity.
        if not resume:raise ValueError("Tag already reserved; use a fresh tag or --resume")
        old=json.loads(mpath.read_text())["sha256"];old.pop("natural_modal.py",None)
        if old!=manifest["sha256"]:raise ValueError("Resume refused: inputs changed")
        print("RESUME",tag,flush=True)
    else:mpath.write_text(json.dumps(manifest,indent=2))
    try:
        experiment.remote(train,rows,contract,tag,candidate,instruction(contract))
    except modal.exception.DeserializationError as exc:
        print("RPC result not decodable locally; reading the Volume artifact:",exc,flush=True)
    raw=b"".join(vol.read_file(f"local-extractor/{tag}/comparison.json"))
    (output/f"{tag}-gpu.json").write_bytes(raw)
    print("COMPLETE",tag,flush=True)
