"""CPU reference probabilities/tokens; export only, never calibrate on eval."""
import hashlib,json,pathlib,modal
from export_decider import image,vol
image=image.add_local_python_source("export_decider")
app=modal.App("lhg-decider-reference")
@app.function(image=image,volumes={"/models":vol},cpu=4,memory=8192,timeout=1200,max_containers=1,retries=0)
def score(rows):
 import torch
 from transformers import AutoTokenizer,AutoModelForSequenceClassification
 torch.set_num_threads(4)
 result={}
 for run in ("v2","v4-xlmr-ml"):
  tok=AutoTokenizer.from_pretrained("/models/"+run)
  model=AutoModelForSequenceClassification.from_pretrained("/models/"+run).eval()
  ps=[];ids=[]
  with torch.no_grad():
   for r in rows:
    enc=tok(r["text"].strip(),truncation=True,max_length=96,return_tensors="pt")
    ids.append(enc["input_ids"][0].tolist())
    ps.append(torch.softmax(model(**enc).logits,-1)[0,1].item())
  result[run]={"p":ps,"ids":ids}
 return result
@app.local_entrypoint()
def main(out:str):
 root=pathlib.Path(__file__).resolve().parents[1]
 rows=[];hashes={}
 for label,name in (("dev","classifier/data/multilingual_expansion_v1.jsonl"),("setB","research/independent-eval-20261029/setB/messages.jsonl")):
  f=root/name;hashes[name]=hashlib.sha256(f.read_bytes()).hexdigest()
  for line in f.read_text(encoding="utf-8").splitlines():
   r=json.loads(line);rows.append({**r,"dataset":label})
 reference=score.remote(rows)
 pathlib.Path(out).write_text(json.dumps({"hashes":hashes,"rows":rows,"reference":reference},ensure_ascii=False),encoding="utf-8")
 print("Wrote",len(rows),"reference rows")
