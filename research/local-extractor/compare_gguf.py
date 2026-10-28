"""Offline: GGUF CPU run vs its bf16 GPU reference on the same rows (decisions, per-set metrics, latency).
python research/local-extractor/compare_gguf.py e9-gguf-7b-Q4_K_M e8-natural-7b-20261028:natural-7b-lora
"""
import json,pathlib,sys
from score import decode,summary
R=pathlib.Path(__file__).parent/"results"
tag,ref=sys.argv[1],sys.argv[2];rtag,rrun=ref.split(":")
g=json.loads((R/f"{tag}-gpu.json").read_text(encoding="utf-8"));run=next(iter(g["runs"].values()))
rows=g["evaluation_rows"];ids={r["id"] for r in rows}
gr=json.loads((R/f"{rtag}-gpu.json").read_text(encoding="utf-8"))
refrun=[x for x in gr["runs"][rrun] if x["id"] in ids]
a=summary(rows,run);b=summary(rows,refrun)
by={r["id"]:r for r in rows};rr={x["id"]:x for x in refrun}
val=lambda d:{k:v[0] for k,v in d.items()}
changed=[x["id"] for x in run if val(decode(x["raw"],by[x["id"]]["text"])[0])!=val(decode(rr[x["id"]]["raw"],by[x["id"]]["text"])[0])]
lat=sorted(x["batch_elapsed_s"] for x in run)
out={"tag":tag,"reference":ref,"cpu":g["cpu"],"gguf_gib":round(g["cpu"]["gguf_bytes"]/2**30,2),
 "changed_rows_vs_bf16":len(changed),"rows":len(run),"p50_s":round(lat[len(lat)//2],1),"p95_s":round(lat[int(.95*len(lat))-1],1),
 "mean_generated_tokens":round(sum(x["generated_tokens"] for x in run)/len(run),1),
 "mean_prompt_tokens":round(sum(x["prompt_tokens"] for x in run)/len(run),1)}
for k in["all","set:legacy_eval","set:sealed_v3","set:sealed_v3;language:he"]:
    out[k]={"gguf":[a["groups"][k]["precision"],a["groups"][k]["recall"]],"bf16":[b["groups"][k]["precision"],b["groups"][k]["recall"]]}
(R/f"{tag}-compare.json").write_text(json.dumps(out,indent=1),encoding="utf-8")
print(json.dumps(out))
