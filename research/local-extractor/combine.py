"""Offline: combine two scored runs' predictions (no GPU). Union = keep a fact either model proposed
(conflicting values -> dropped); agree = keep only facts both proposed with the same value.
python research/local-extractor/combine.py --a e8-natural-7b-20261028:natural-7b-lora --b e8-natural-dicta-20261028:natural-dicta-lora
"""
import argparse,json,pathlib
from score import decode,summary
ROOT=pathlib.Path(__file__).parent
def load(spec):
    tag,run=spec.split(":")
    gpu=json.loads((ROOT/"results"/f"{tag}-gpu.json").read_text(encoding="utf-8"))
    return gpu["evaluation_rows"],{r["id"]:r for r in gpu["runs"][run]}
def main():
    p=argparse.ArgumentParser();p.add_argument("--a");p.add_argument("--b");p.add_argument("--out",default="e8-combined")
    a=p.parse_args()
    rows,ra=load(a.a);_,rb=load(a.b)
    out={}
    for mode in("union","agree"):
        preds=[]
        for row in rows:
            fa,_=decode(ra[row["id"]]["raw"],row["text"]);fb,_=decode(rb[row["id"]]["raw"],row["text"])
            if mode=="union":
                m={k:v for k,v in {**fb,**fa}.items() if not(k in fa and k in fb and fa[k][0]!=fb[k][0])}
            else:
                m={k:v for k,v in fa.items() if k in fb and fb[k][0]==v[0]}
            preds.append({**ra[row["id"]],"raw":json.dumps(m,ensure_ascii=False)})
        out[mode]=summary(rows,preds)
    (ROOT/"results"/f"{a.out}-scored.json").write_text(json.dumps(out,ensure_ascii=False,indent=1),encoding="utf-8")
    for mode,r in out.items():
        for k in["all","set:legacy_eval","set:sealed_v3","set:sealed_v3;language:he"]:
            d=r["groups"][k];print(mode,k,d["precision"],d["recall"],"tp",d["tp"],"fp",d["fp"],"fn",d["fn"])
if __name__=="__main__":main()
