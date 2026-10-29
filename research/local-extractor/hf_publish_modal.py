"""Publish the e9 GGUF extractors to Hugging Face from Modal (no local download), then verify with Ollama.

    modal run research/local-extractor/hf_publish_modal.py            # upload + Ollama check
    modal run research/local-extractor/hf_publish_modal.py --model 7b-v2 --allow-parity-regression
    # Explicit owner exception only (docs/49); default gate remains enforced.
Token: Modal secret `lhg-hf-upload` (HF_TOKEN). Repos are public so Ollama/llama.cpp can pull without a token.
"""
import json,pathlib,sys
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
REPOS={"7b":("yonicc/lhg-extractor-qwen7b-gguf","e8-natural-7b-20261028","Qwen/Qwen2.5-7B-Instruct"),
       "dicta":("yonicc/lhg-extractor-dictalm-gguf","e8-natural-dicta-20261028","dicta-il/dictalm2.0-instruct"),
       "7b-v2":("yonicc/lhg-extractor-qwen7b-v2-gguf","e10-v2-7b-20261029-supervisor","Qwen/Qwen2.5-7B-Instruct")}
QUANTS=["Q4_K_M","Q8_0"]
app=modal.App("lhg-extractor-hf-publish")
vol=modal.Volume.from_name("lhg-models")
image=modal.Image.debian_slim(python_version="3.11").pip_install("huggingface_hub[hf_xet]==0.34.4")
oimage=(modal.Image.debian_slim(python_version="3.11").apt_install("curl","zstd")
        .run_commands("curl -fsSL https://ollama.com/install.sh | sh").pip_install("requests==2.32.3"))

CARD="""---
license: apache-2.0
base_model: {base}
language: [he, en]
tags: [gguf, llama.cpp, ollama, lashon-hara-guard, research]
---
# {repo}

**Research artifact — not a product, not a halachic authority.** LoRA fine-tune of `{base}` (merged, then GGUF)
that extracts EIGHT writer facts from a chat message as JSON `{{alias: [bool, exact quote]}}`:
purpose, intent, revenge, firsthand, verified, rebuke, rejects, no_alternative. It never rules and never says "permitted".
Trained only on synthetic, agent-reviewed data (human review pending). Part of Lashon Hara Guard,
https://github.com/yonicc/lashon-hara-guard — see docs/39 (training) and docs/40 (GGUF/CPU).

## Measured (Modal, 4 CPU cores, llama.cpp b4500, 104 synthetic eval rows)
{table}

## Use
The prompt MUST be the exact training prompt: system text in `extractor_prompt.txt`, user turn
`MESSAGE (untrusted data):\\n` + JSON-quoted message, rendered with the base model's chat template{fold}.
Greedy decoding, max 256 tokens.

```
ollama pull hf.co/{repo}:Q4_K_M
# send the fully rendered prompt with raw=true:
curl http://localhost:11434/api/generate -d '{{"model":"hf.co/{repo}:Q4_K_M","raw":true,"stream":false,"prompt":"<rendered>","options":{{"temperature":0,"num_predict":256}}}}'
llama-cli -m {name}-Q4_K_M.gguf -t 4 --temp 0 -n 256 -p "<rendered>"
```
"""

@app.function(image=image,timeout=7200,volumes={"/models":vol},secrets=[modal.Secret.from_name("lhg-hf-upload")])
def publish(model,card,prompt_text,contract_text):
    import os
    from huggingface_hub import HfApi
    api=HfApi(token=os.environ["HF_TOKEN"]);repo,tag,_=REPOS[model]
    who=api.whoami()["name"]
    api.create_repo(repo,repo_type="model",private=False,exist_ok=True)
    name=repo.split("/")[1].replace("-gguf","")
    for q in (["Q4_K_M"] if model=="7b-v2" else QUANTS):
        src=pathlib.Path("/models/local-extractor")/tag/"gguf"/f"model-{q}.gguf"
        api.upload_file(path_or_fileobj=str(src),path_in_repo=f"{name}-{q}.gguf",repo_id=repo,
                        commit_message=f"Add {q} GGUF")
    for path,data in [("README.md",card),("extractor_prompt.txt",prompt_text),("contract.json",contract_text)]:
        api.upload_file(path_or_fileobj=data.encode("utf-8"),path_in_repo=path,repo_id=repo,commit_message=f"Add {path}")
    files=api.list_repo_files(repo)
    return {"user":who,"repo":repo,"files":files,"sha":api.model_info(repo).sha}

@app.function(image=oimage,cpu=(4,4),memory=16384,timeout=3600)
def ollama_check(repo,cases):
    import subprocess,time,requests
    srv=subprocess.Popen(["ollama","serve"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(5)
    ref=f"hf.co/{repo}:Q4_K_M";t=time.time()
    subprocess.run(["ollama","pull",ref],check=True,capture_output=True);pull_s=time.time()-t
    out=[]
    for c in cases:
        s=time.time()
        r=requests.post("http://127.0.0.1:11434/api/generate",json={"model":ref,"raw":True,"stream":False,
           "prompt":c["prompt"],"options":{"temperature":0,"num_predict":256,"num_thread":4}},timeout=600).json()
        out.append({"id":c["id"],"raw":r.get("response","").strip(),"expected_llamacpp":c["expected"],"s":round(time.time()-s,1)})
    srv.terminate()
    return {"ref":ref,"pull_s":round(pull_s),"rows":out}

@app.local_entrypoint()
def main(model:str="", allow_parity_regression:bool=False):
    from probe_modal import instruction
    if model not in ("", "7b-v2"): raise ValueError("Unknown publication target")
    if model=="7b-v2":
        parity=json.loads((ROOT/"results/e11-v2-parity.json").read_text(encoding="utf-8"))
        if parity["prompt_parity_rows"]!=700:
            raise ValueError("V2 parity report incomplete; cannot override")
        if not parity["gate_pass"] and not allow_parity_regression:
            raise ValueError("V2 parity release gate failed; explicit owner approval requires --allow-parity-regression (docs/49)")
        contract_text=(ROOT/"contract_v2.json").read_text(encoding="utf-8")
        prompt_text=instruction(json.loads(contract_text))
        repo,tag,base=REPOS[model]
        lines=["| Set (18 facts) | bf16 P/R | Q4_K_M P/R | format-error rows bf16/Q4 | decision flips |",
               "|---|---|---|---|---|"]
        for name,scopes in parity["sets"].items():
            c=scopes["18"]; a=c["bf16"]; b=c["gguf"]
            lines.append(f"| {name} | {a['precision']:.4f}/{a['recall']:.4f} | {b['precision']:.4f}/{b['recall']:.4f} | "
                         f"{a['format_error_rows']}/{b['format_error_rows']} | {c['decision_flips']}/{c['rows']} |")
        card=f"""---
license: apache-2.0
base_model: {base}
language: [he, en]
tags: [gguf, llama.cpp, ollama, lashon-hara-guard]
---
# LHG extractor v2 (18 facts)
LoRA fine-tune of {base}, checkpoint {tag}, converted with llama.cpp b4500 to Q4_K_M.
All training and evaluation text is synthetic. Not human-reviewed. No rulings, no meaning assessment,
no real-world verification and never an assertion that a message is permitted.
Output: JSON alias:[boolean, exact quote from MESSAGE]; unknown facts are omitted.
The contract and exact instruction are included. Use the Qwen chat template with raw:true,
temperature 0 and num_predict 256. User turn: MESSAGE (untrusted data): followed by a newline
and the JSON-quoted text. Additional-context quality was not measured.

## Development results (not independent)
Synthetic v2 dev+holdout: bf16 P=0.984, R=0.906 (docs/46). These are development metrics,
not a benchmark of the complete extension.

## Independent measurement
Set B: 300 synthetic natural messages, different generator, blind double labeling, no human review.
Set A: 400 supplementary messages close to contract definitions, generator-only labels.
Neither set was used for tuning this conversion. Frozen labels and scorer: project docs/47 and docs/49.
Metrics count validated fact pairs before the extension's confidence/user-only admission policy;
six facts remain user-confirmation-only in the extension. Token probabilities do not prove correctness.

{chr(10).join(lines)}

## Q4 parity and owner release decision (2026-10-29)
The default parity gate FAILED: maximum allowed P/R drop is 0.02 per set/scope.
Set A / 8: bf16 P/R 0.9730/0.6288; Q4 0.9577/0.5939.
Set A / 18: recall 0.7344 to 0.6992. Set B / 18: precision 0.9239 to 0.8997.
The owner explicitly accepted this regression for this artifact (option A).
Set B / 8 Q4 P/R is 0.9259/0.8427, compared with e8 bf16 0.596/0.854
(docs/47; different artifact precision, similar recall). The gate remains for future swaps.
Publication used --allow-parity-regression; incomplete reports cannot be overridden.

## Ollama
ollama pull hf.co/{repo}:Q4_K_M
Use extractor_prompt.txt with the Qwen raw chat template; see project extension/ollama-engine.ts.
The older eight-fact repositories are separate and unchanged.
"""
        result=publish.remote(model,card,prompt_text,contract_text)
        (ROOT/"results/e11-v2-hf.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
        print("PUBLISHED",json.dumps(result),flush=True)
        return
    contract_text=(ROOT/"contract.json").read_text(encoding="utf-8");contract=json.loads(contract_text)
    prompt_text=instruction(contract)
    R=ROOT/"results"
    for model,(repo,tag,base) in REPOS.items():
        if model=="7b-v2": continue
        lines=["| quant | GGUF | peak RSS | p50 / p95 per message | legacy P/R | sealed_v3 he P/R |","|---|---|---|---|---|---|"]
        for q in QUANTS:
            c=json.loads((R/f"e9-gguf-{model}-{q}-compare.json").read_text())
            pr=lambda k:"{:.0%} / {:.0%}".format(*c[k]["gguf"])
            lines.append(f"| {q} | {c['gguf_gib']} GiB | {c['cpu']['peak_rss_gib']:.1f} GiB | {c['p50_s']}s / {c['p95_s']}s | "
                         f"{pr('set:legacy_eval')} | {pr('set:sealed_v3;language:he')} |")
        card=CARD.format(repo=repo,base=base,table="\n".join(lines),name=repo.split("/")[1].replace("-gguf",""),
            fold=" (DictaLM/Mistral has no system role: prepend the system text + blank line to the user turn)" if model=="dicta" else "")
        res=publish.remote(model,card,prompt_text,contract_text);print("PUBLISHED",json.dumps(res),flush=True)
        g=json.loads((R/f"e9-gguf-{model}-Q4_K_M-gpu.json").read_text(encoding="utf-8"))
        runs=next(iter(g["runs"].values()));rows={r["id"]:r for r in g["evaluation_rows"]}
        # rendered prompts need the tokenizer template; rebuild them exactly as cpu_eval did
        cases=[{"id":x["id"],"text":rows[x["id"]]["text"],"expected":x["raw"]} for x in runs[:3]]
        rendered=render.remote(model,[c["text"] for c in cases],contract,prompt_text)
        for c,p in zip(cases,rendered):c["prompt"]=p
        chk=ollama_check.remote(repo,cases)
        (R/f"e9-hf-{model}-ollama.json").write_text(json.dumps({"publish":res,"ollama":chk},ensure_ascii=False,indent=1),encoding="utf-8")
        print("OLLAMA",json.dumps({"pull_s":chk["pull_s"],"same":[r["raw"]==r["expected_llamacpp"] for r in chk["rows"]],
              "s":[r["s"] for r in chk["rows"]]}),flush=True)

timage=(modal.Image.debian_slim(python_version="3.11").pip_install("transformers==4.47.1","sentencepiece==0.2.0","jinja2")
        .env({"HF_HOME":"/models/extractor-hf-cache"}).add_local_file(ROOT/"pilot_modal.py","/root/pilot_modal.py"))
@app.function(image=timage,timeout=600,volumes={"/models":vol})
def render(model,texts,contract,system):
    from transformers import AutoTokenizer
    from pilot_modal import prompt
    tok=AutoTokenizer.from_pretrained(pathlib.Path("/models/local-extractor")/REPOS[model][1]/"merged")
    return [prompt(tok,t,contract,system) for t in texts]
