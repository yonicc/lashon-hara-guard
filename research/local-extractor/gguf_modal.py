"""e9: GGUF quantization + 4-core CPU quality/latency for the e8 extractors. Heavy work ONLY on Modal.

    modal run --detach research/local-extractor/gguf_modal.py --model 7b --quant Q4_K_M
Models: merged e8 weights in Volume lhg-models (/models/local-extractor/<tag>/merged).
Prompt text is rendered with the HF chat template (pilot_modal.prompt, same as GPU eval) and fed to
llama.cpp as a raw completion, greedy, max 256 tokens -> decisions comparable to the GPU run.
Eval rows: legacy (74) + sealed_v3 (30). Results: results/e9-gguf-<model>-<quant>-gpu.json (score.py format).
"""
import json,pathlib,sys,time
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from pilot_modal import prompt
TAGS={"7b":"e8-natural-7b-20261028","dicta":"e8-natural-dicta-20261028"}
LLAMA_TAG="b4500"
app=modal.App("lhg-extractor-gguf")
vol=modal.Volume.from_name("lhg-models")
image=(modal.Image.debian_slim(python_version="3.11").apt_install("git","build-essential","cmake")
  .run_commands(f"git clone --depth 1 --branch {LLAMA_TAG} https://github.com/ggerganov/llama.cpp /llama.cpp",
    "pip install --index-url https://download.pytorch.org/whl/cpu torch==2.4.1",
    "pip install -r /llama.cpp/requirements/requirements-convert_hf_to_gguf.txt",
    "cmake -S /llama.cpp -B /llama.cpp/build -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF && cmake --build /llama.cpp/build --target llama-quantize -j 8")
  .pip_install("transformers==4.47.1","sentencepiece==0.2.0","llama-cpp-python==0.3.7")
  .env({"HF_HOME":"/models/extractor-hf-cache"})
  .add_local_file(ROOT/"pilot_modal.py","/root/pilot_modal.py"))

@app.function(image=image,cpu=8,memory=65536,timeout=3600,retries=0,volumes={"/models":vol})
def convert(model:str,quant:str):
    import subprocess
    src=pathlib.Path("/models/local-extractor")/TAGS[model]/"merged";out=src.parent/"gguf";out.mkdir(exist_ok=True)
    f16=out/"model-f16.gguf";q=out/f"model-{quant}.gguf";t=time.time()
    if not f16.exists():
        # transformers 4.55 saves null hparams (e.g. head_dim) for Mistral/DictaLM; convert_hf_to_gguf b4500
        # writes them as ints -> struct.error. Stage the checkpoint with null keys dropped.
        stage=pathlib.Path("/tmp/stage");stage.mkdir(exist_ok=True)
        for p in src.iterdir():
            if p.name!="config.json":(stage/p.name).symlink_to(p)
        cfg=json.loads((src/"config.json").read_text());dropped=[k for k,v in cfg.items() if v is None]
        (stage/"config.json").write_text(json.dumps({k:v for k,v in cfg.items() if v is not None},indent=1))
        print("dropped null hparams",dropped,flush=True)
        subprocess.run([sys.executable,"/llama.cpp/convert_hf_to_gguf.py",str(stage),"--outtype","f16","--outfile",str(f16)],check=True)
        vol.commit()
    if not q.exists():
        subprocess.run(["/llama.cpp/build/bin/llama-quantize",str(f16),str(q),quant],check=True);vol.commit()
    return {"gguf":str(q),"bytes":q.stat().st_size,"convert_s":round(time.time()-t)}

@app.function(image=image,cpu=(4,4),memory=16384,timeout=10800,retries=0,volumes={"/models":vol})
def cpu_eval(model:str,quant:str,rows,contract,system):
    import resource
    from llama_cpp import Llama
    from transformers import AutoTokenizer
    path=pathlib.Path("/models/local-extractor")/TAGS[model]/"gguf"/f"model-{quant}.gguf"
    tok=AutoTokenizer.from_pretrained(path.parent.parent/"merged")
    t=time.time();llm=Llama(model_path=str(path),n_ctx=2048,n_threads=4,n_batch=512,verbose=False);load_s=time.time()-t
    out=[]
    for i,r in enumerate(rows):
        text=prompt(tok,r["text"],contract,system)
        s=time.perf_counter()
        res=llm(text,max_tokens=256,temperature=0.0,top_k=1,echo=False)  # prefix KV of the shared system prompt is reused
        el=time.perf_counter()-s
        u=res["usage"]
        out.append({"id":r["id"],"raw":res["choices"][0]["text"].strip(),"generated_tokens":u["completion_tokens"],
           "prompt_tokens":u["prompt_tokens"],"batch_size":1,"batch_elapsed_s":el,"token_limit":256,
           "hit_limit":res["choices"][0]["finish_reason"]=="length"})
        print("cpu",i+1,"/",len(rows),round(el,1),"s",flush=True)
    lat=sorted(x["batch_elapsed_s"] for x in out)
    return json.dumps({"runs":{f"gguf-{model}-{quant}":out},"evaluation_rows":rows,
       "cpu":{"threads":4,"modal_cpu":"(4,4)","load_s":round(load_s,1),"gguf_bytes":path.stat().st_size,
              "p50_s":lat[len(lat)//2],"p95_s":lat[int(.95*len(lat))-1],"mean_s":sum(lat)/len(lat),
              "peak_rss_gib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/2**20,"llama_cpp":LLAMA_TAG}})

@app.local_entrypoint()
def main(model:str="7b",quant:str="Q4_K_M"):
    from probe_modal import instruction
    def load(p):return [json.loads(s) for s in (ROOT/p).read_text(encoding="utf-8").splitlines()]
    rows=load("legacy.jsonl")+load("diverse/sealed_v3.jsonl")
    contract=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
    tag=f"e9-gguf-{model}-{quant}";dest=ROOT/"results"/f"{tag}-gpu.json"
    if dest.exists():raise ValueError("Refuse overwrite")
    conv=convert.remote(model,quant);print("CONVERTED",conv,flush=True)
    res=json.loads(cpu_eval.remote(model,quant,rows,contract,instruction(contract)))
    res["convert"]=conv;dest.write_text(json.dumps(res,ensure_ascii=False,indent=1),encoding="utf-8")
    print("COMPLETE",tag,json.dumps(res["cpu"]),flush=True)
