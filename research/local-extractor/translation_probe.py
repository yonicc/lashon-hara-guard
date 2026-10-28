"""User-requested language adapter: local Hebrew->English MT, then English extraction.
Whole-message evidence mapping is deliberately coarse and is NOT deployable alignment.
"""
import hashlib
import json
import pathlib
import sys
import time
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from probe_modal import instruction,MODEL
from pilot_modal import evaluate
app=modal.App("lhg-extractor-translation-probe")
vol=modal.Volume.from_name("lhg-models")
image=modal.Image.debian_slim(python_version="3.11").pip_install(
 "torch==2.6.0","transformers==4.55.4","accelerate==1.10.1","numpy==1.26.4",
 "sentencepiece==0.2.0","sacremoses==0.1.1"
).env({"HF_HOME":"/models/extractor-hf-cache","TOKENIZERS_PARALLELISM":"false"}).add_local_file(
 ROOT/"pilot_modal.py","/root/pilot_modal.py").add_local_file(
 ROOT/"score.py","/root/score.py").add_local_file(ROOT/"contract.json","/root/contract.json").add_local_file(
 ROOT/"probe_modal.py","/root/probe_modal.py")
TRANSLATOR="Helsinki-NLP/opus-mt-tc-big-he-en"

@app.function(image=image,cpu=(4,4),memory=4096,timeout=1800,retries=0,
              max_containers=1,volumes={"/models":vol})
def translate(rows):
    import platform
    import resource
    import torch
    from transformers import AutoTokenizer,AutoModelForSeq2SeqLM
    from huggingface_hub import model_info
    torch.set_num_threads(4);torch.set_num_interop_threads(1)
    start=time.time();rev=model_info(TRANSLATOR).sha
    tok=AutoTokenizer.from_pretrained(TRANSLATOR,revision=rev)
    model=AutoModelForSeq2SeqLM.from_pretrained(TRANSLATOR,revision=rev).eval()
    cold=time.time()-start;out=[]
    for r in rows:
        t=time.perf_counter()
        inputs=tok(r["text"],return_tensors="pt")
        if inputs.input_ids.shape[1]>512:raise ValueError("Translator input too long, refusing truncation")
        with torch.inference_mode():
            generated=model.generate(**inputs,do_sample=False,num_beams=4,max_new_tokens=256)
        out.append({**r,"original_text":r["text"],"text":tok.decode(generated[0],skip_special_tokens=True),
                    "translation_ms":(time.perf_counter()-t)*1000})
        if len(out)%20==0:print("translated",len(out),flush=True)
    vol.commit()
    return {"rows":out,"revision":rev,"translator":TRANSLATOR,"cold_s":cold,"threads":4,
      "machine":platform.machine(),"max_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
      "function_seconds":time.time()-start}

@app.function(image=image,gpu="A10G",cpu=4,memory=16384,timeout=1800,retries=0,
              max_containers=1,volumes={"/models":vol})
def extract(translated,contract,system,trained_tag=None,run_label=None):
    import torch
    from transformers import AutoTokenizer,AutoModelForCausalLM
    from huggingface_hub import model_info
    from score import decode
    vol.reload();start=time.time()
    source=f"/models/local-extractor/{trained_tag}/merged" if trained_tag else MODEL
    rev=None if trained_tag else model_info(MODEL).sha
    tok=AutoTokenizer.from_pretrained(source,revision=rev)
    model=AutoModelForCausalLM.from_pretrained(source,revision=rev,torch_dtype=torch.bfloat16).cuda().eval()
    raw=evaluate(model,tok,translated,contract,"cuda",instruction=system)
    mapped=[]
    for r,p in zip(translated,raw):
        accepted,errs=decode(p["raw"],r["text"])
        mapped.append({**p,"english_raw":p["raw"],"upstream_errors":errs,
          "raw":json.dumps({k:[v[0],r["original_text"]] for k,v in accepted.items()},ensure_ascii=False),
          "evidence_mapping":"whole original message; coarse, not semantic verification"})
    label=run_label or ("qwen3-4b-lora-via-english" if trained_tag else "qwen3-4b-via-english")
    return {"runs":{label:mapped},"revisions":{source:rev},"trained_tag":trained_tag,
      "gpu_function_seconds":time.time()-start,"prompt":system}

@app.local_entrypoint()
def main(tag: str="e3-20261028",reuse_translation: bool=False,translation_tag: str="",
         trained_tag: str="",candidate_label: str=""):
    load=lambda n:[json.loads(s) for s in (ROOT/n).read_text(encoding="utf-8").splitlines()]
    rows=[r for r in load("legacy.jsonl")+load("fresh.jsonl")+load("confirmation.jsonl") if r["language"]=="he"]
    contract=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
    folder=ROOT/"results";folder.mkdir(exist_ok=True)
    if (folder/f"{tag}-gpu.json").exists():raise ValueError("Refuse result overwrite")
    if not reuse_translation:
        t=translate.remote(rows)
        (folder/f"{tag}-translations.json").write_text(json.dumps(t,ensure_ascii=False,indent=1),encoding="utf-8")
    else:t=json.loads((folder/f"{translation_tag or tag}-translations.json").read_text(encoding="utf-8"))
    r=extract.remote(t["rows"],contract,instruction(contract),trained_tag or None,candidate_label or None);r["tag"]=tag
    r["translation_tag"]=translation_tag or tag
    r["evaluation_rows"]=rows
    (folder/f"{tag}-gpu.json").write_text(json.dumps(r,ensure_ascii=False,indent=1),encoding="utf-8")
    print("COMPLETE",tag,flush=True)
