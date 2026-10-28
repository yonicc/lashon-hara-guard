"""Real engine validation in Modal CPU; avoids npm installation on the owner's PC."""
import json,pathlib,subprocess
import modal
ROOT=pathlib.Path(__file__).parent if modal.is_local() else pathlib.Path("/work/research/local-extractor")
ENGINE=ROOT.parents[1]/"engine"
app=modal.App("lhg-extractor-offline-engine-validation")
image=(modal.Image.debian_slim(python_version="3.11").apt_install("nodejs","npm")
 .add_local_file(ENGINE/"package.json","/work/engine/package.json",copy=True)
 .add_local_file(ENGINE/"package-lock.json","/work/engine/package-lock.json",copy=True)
 .run_commands("cd /work/engine && npm ci --no-audit --no-fund")
 .add_local_dir(ENGINE/"src","/work/engine/src")
 .add_local_file(ROOT/"validate-results.mts","/work/research/local-extractor/validate-results.mts"))
@app.function(image=image,cpu=(1,1),memory=1024,timeout=300,retries=0,max_containers=1)
def validate(payloads):
    result={}
    folder=pathlib.Path("/work/research/local-extractor/results");folder.mkdir(exist_ok=True)
    for tag,scored in payloads.items():
        (folder/f"{tag}-scored.json").write_text(json.dumps(scored,ensure_ascii=False))
        p=subprocess.run(["node","--import","tsx","../research/local-extractor/validate-results.mts",tag],
          cwd="/work/engine",capture_output=True,text=True,timeout=60)
        if p.returncode:raise RuntimeError(p.stderr)
        result[tag]=json.loads((folder/f"{tag}-engine-validation.json").read_text())
    return result
@app.local_entrypoint()
def main(warmup:bool=False,tags:str="e6r-diverse-4b-20261028,e6-diverse-7b-20261028,e7-7b-english-20261028"):
    if warmup:
        validate.remote({})
        print("Image warmup only; no result validation yet")
        return
    selected=tags.split(",")
    payloads={t:json.loads((ROOT/"results"/f"{t}-scored.json").read_text()) for t in selected}
    for tag,data in validate.remote(payloads).items():
        (ROOT/"results"/f"{tag}-engine-validation.json").write_text(json.dumps(data,indent=2))
        print(tag,data)
