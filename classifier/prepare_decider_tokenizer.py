"""Create a separate browser artifact; preserve original Python tokenizer bytes.
HF tokenizers uses Unicode regex word classes; JS /u rejects escaped quotes and
its ASCII-only \\w differs. Translate those semantics, then require token parity.
"""
import argparse,json,pathlib,shutil,hashlib
def regex_value(v):
 word=r"\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200c\u200d"
 return v.replace('\\"','"').replace(r"[^\w\s]","[^"+word+r"\s]").replace(r"\w","["+word+"]")
def convert(value):
 if isinstance(value,list):return [convert(v) for v in value]
 if isinstance(value,dict):
  return {k:(regex_value(v) if k=="Regex" and isinstance(v,str) else convert(v)) for k,v in value.items()}
 return value
def main():
 ap=argparse.ArgumentParser();ap.add_argument("source");ap.add_argument("dest");a=ap.parse_args()
 source,dest=pathlib.Path(a.source),pathlib.Path(a.dest)
 assert not dest.exists(),"Never overwrite an artifact"
 for run in ("v2","v4-xlmr-ml"):
  for f in ("config.json","tokenizer.json","tokenizer_config.json","parity.json","onnx/model_quantized.onnx"):
   out=dest/run/f;out.parent.mkdir(parents=True,exist_ok=True)
   if f=="tokenizer.json":
    out.write_bytes((json.dumps(convert(json.loads((source/run/f).read_text(encoding="utf-8"))),ensure_ascii=False)+"\n").encode())
   else:shutil.copyfile(source/run/f,out)
 print(json.dumps({str(p.relative_to(dest)):hashlib.sha256(p.read_bytes()).hexdigest() for p in dest.rglob("*") if p.is_file()},indent=2))
if __name__=="__main__":main()
