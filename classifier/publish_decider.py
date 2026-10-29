"""Publish only the validated browser artifact; no training or gate deployment."""
import json,pathlib,modal
from export_decider import image,vol
app=modal.App("lhg-decider-publish")
image=(image.pip_install("huggingface_hub==0.36.0")
 .add_local_python_source("export_decider","prepare_decider_tokenizer"))
@app.function(image=image,volumes={"/models":vol},cpu=2,memory=4096,timeout=1200,retries=0,
 secrets=[modal.Secret.from_name("lhg-hf-upload")])
def publish(expected,report):
 import hashlib,os,shutil
 import zipfile
 from huggingface_hub import HfApi
 from prepare_decider_tokenizer import convert
 dest=pathlib.Path("/tmp/decider")
 dest.mkdir()
 for file,hash in expected.items():
  src=pathlib.Path("/models/decider/d2")/file
  out=dest/file;out.parent.mkdir(parents=True,exist_ok=True)
  if file.endswith("/tokenizer.json"):
   out.write_bytes((json.dumps(convert(json.loads(src.read_text())),ensure_ascii=False)+"\n").encode())
  else:shutil.copyfile(src,out)
  assert hashlib.sha256(out.read_bytes()).hexdigest()==hash,file
 (dest/"calibration.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
 (dest/"README.md").write_text("""# LHG local meaning decider d2

Reuses LHG gate v2 (DictaBERT) and v4-xlmr-ml (XLM-R base) trained weights,
but has a separate browser artifact and development-only calibration.
Gate deployment/threshold are unchanged. Synthetic training/evaluation,
agent labels, no human review; no religious or legal ruling.
Hebrew-only uses v2; ASCII Latin text uses max(v2, v4-xlmr-ml).
v2 fp32, XLM-R embedding-table int8 only. Tokenizer regex port checked
against Python. Explicit SHA-256 import, cached-only inference.
Low scores remain unsure; this model cannot approve a message or fill facts.
Independent Set B warning recall is 60/287 (20.9%); only two negative controls:
0 false warnings does NOT establish population precision.
See calibration.json for thresholds, development/independent metrics and parity.
Base models: https://huggingface.co/dicta-il/dictabert and
https://huggingface.co/FacebookAI/xlm-roberta-base .
Download lhg-decider-d2.zip, extract, then import the extracted folder in
LHG extension options (Local meaning signal). About 1.3 GB uncompressed.
""",encoding="utf-8")
 archive=pathlib.Path("/tmp/lhg-decider-d2.zip")
 with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED,compresslevel=1) as z:
  for p in dest.rglob("*"):
   if p.is_file():z.write(p,"lhg-decider-d2/"+str(p.relative_to(dest)))
 shutil.move(str(archive),dest/"lhg-decider-d2.zip")
 api=HfApi(token=os.environ["HF_TOKEN"])
 repo="yonicc/lhg-local-decider"
 api.create_repo(repo,private=False,exist_ok=True)
 info=api.upload_folder(repo_id=repo,folder_path=str(dest),commit_message="Release d2 browser decider artifact; separately calibrated from gate")
 return {"repo":repo,"revision":info.oid}
@app.local_entrypoint()
def main(manifest:str,out:str):
 expected=json.loads(pathlib.Path(manifest).read_text())
 report=json.loads((pathlib.Path(__file__).resolve().parents[1]/"research/local-decider/report.json").read_text(encoding="utf-8"))
 result=publish.remote(expected,report)
 pathlib.Path(out).write_text(json.dumps(result))
 print(json.dumps(result))
