"""Export the existing gate weights for an independently calibrated local DECIDER.
No gate deployment, training or threshold changes. CPU-only bounded export.
"""
import hashlib
import json
import pathlib
import modal

app = modal.App("lhg-decider-export")
image = (modal.Image.debian_slim(python_version="3.11")
 .pip_install("torch==2.4.1", index_url="https://download.pytorch.org/whl/cpu")
 .pip_install("transformers==4.46.3", "numpy<2", "onnx==1.16.2",
              "onnxruntime==1.20.1", "sentencepiece==0.2.0", "protobuf==5.29.3"))
vol = modal.Volume.from_name("lhg-models")

@app.function(image=image, volumes={"/models":vol}, cpu=4, memory=8192,
              timeout=1800, max_containers=1, retries=0)
def export():
 import torch
 from transformers import AutoTokenizer, AutoModelForSequenceClassification
 from onnxruntime.quantization import QuantType, quantize_dynamic
 torch.set_num_threads(4)
 report={}
 for run in ("v2","v4-xlmr-ml"):
  source=pathlib.Path("/models")/run
  out=pathlib.Path("/models/decider/d2")/run
  out.mkdir(parents=True,exist_ok=True)
  tok=AutoTokenizer.from_pretrained(source)
  model=AutoModelForSequenceClassification.from_pretrained(source).eval()
  tok.save_pretrained(out);model.config.save_pretrained(out)
  (out/"onnx").mkdir(exist_ok=True)
  fp=out/"onnx/model.onnx"
  if not fp.exists():
   enc=tok("שלום world",return_tensors="pt")
   # Tokenizer dict order is not forward's argument order (BERT puts token_type_ids second).
   names=["input_ids","attention_mask"]+(["token_type_ids"] if "token_type_ids" in enc else [])
   torch.onnx.export(model,tuple(enc[n] for n in names),str(fp),input_names=names,
     output_names=["logits"],dynamic_axes={**{n:{0:"batch",1:"sequence"} for n in names},"logits":{0:"batch"}},
     opset_version=14)
  compressed=out/"onnx/model_quantized.onnx"
  if not compressed.exists():
   quantize_dynamic(str(fp),str(compressed),weight_type=QuantType.QInt8,op_types_to_quantize=["Gather"])
  samples=["שלום", "שָׁלוֹם, יוסי!", "é é café", "ﬁ ﬃ Ａ", "אבי is so helpful... sure.", "שלום\u200f world", "A\tB\nC", "🙂 נהדר", "x"*200, "  "]
  rows=[]
  with torch.no_grad():
   for text in samples:
    enc=tok(text.strip(),truncation=True,max_length=96,return_tensors="pt")
    rows.append({"text":text,"ids":enc["input_ids"][0].tolist(),
                 "p":torch.softmax(model(**enc).logits,-1)[0,1].item()})
  (out/"parity.json").write_text(json.dumps(rows,ensure_ascii=False),encoding="utf-8")
  report[run]={"files":{str(p.relative_to(out)):{"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in out.rglob("*") if p.is_file()}}
  vol.commit()
 return report

@app.local_entrypoint()
def main(out:str):
 report=export.remote()
 pathlib.Path(out).write_text(json.dumps(report,indent=2),encoding="utf-8")
 print(json.dumps(report))
