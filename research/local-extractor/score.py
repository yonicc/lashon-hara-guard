"""Strict offline scoring. Wrong values count as both FP and FN; unknown is not false."""
import collections
import json
import math
import pathlib

ROOT=pathlib.Path(__file__).parent
CONTRACT=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
IDS={a:b for a,b,_ in CONTRACT["facts"]}

def decode(raw,text):
    errors=[]
    def unique(pairs):
        obj={}
        for k,v in pairs:
            if k in obj: raise ValueError("duplicate JSON key")
            obj[k]=v
        return obj
    try: obj=json.loads(raw,object_pairs_hook=unique)
    except (ValueError,TypeError): return {},["invalid_json"]
    if not isinstance(obj,dict): return {},["not_object"]
    accepted={}
    for k,v in obj.items():
        if k not in IDS: errors.append("unknown_key");continue
        if not isinstance(v,list) or len(v)!=2 or type(v[0]) is not bool or not isinstance(v[1],str):
            errors.append("invalid_pair");continue
        if not v[1].strip() or v[1] not in text: errors.append("evidence_not_verbatim");continue
        accepted[k]=v
    return accepted,errors

def _metrics(gold,pred,ok):
    tp=sum(k in gold and v[0] is gold[k] for k,v in pred.items())
    wrong=sum(k in gold and v[0] is not gold[k] for k,v in pred.items())
    unsupported=sum(k not in gold and k not in ok for k in pred)
    missed=sum(k not in pred for k in gold)
    return dict(tp=tp,wrong=wrong,unsupported=unsupported,missed=missed,
        fp=wrong+unsupported,fn=wrong+missed)

def summary(rows,predictions):
    by_id={r["id"]:r for r in predictions}
    if len(by_id)!=len(predictions): raise ValueError("duplicate prediction ids")
    if set(by_id)!={r["id"] for r in rows}: raise ValueError("missing/extra predictions")
    groups=collections.defaultdict(collections.Counter)
    errors=collections.Counter()
    detail=[];engine=[]
    for row in rows:
        raw=by_id[row["id"]]
        pred,errs=decode(raw["raw"],row["text"])
        errs.extend(raw.get("upstream_errors",[]))
        errors.update(errs)
        gold=row["expect"];ok=set(row.get("ok",[]))
        m=_metrics(gold,pred,ok)
        unknown_false=sum(k not in gold and k not in ok and v[0] is False for k,v in pred.items())
        for group in ["all","language:"+row["language"],"set:"+row["split"],
                      "set:"+row["split"]+";language:"+row["language"]]:
            groups[group].update(m)
            groups[group]["rows"]+=1
            groups[group]["exact"]+=not (m["fp"]+m["fn"] or errs)
            groups[group]["unknown_as_false"]+=unknown_false
            groups[group]["format_error_rows"]+=bool(errs)
            groups[group]["hit_token_limit"]+=bool(raw.get("hit_limit"))
        for k in IDS:
            groups["fact:"+k].update(_metrics({k:gold[k]} if k in gold else {},
                                            {k:pred[k]} if k in pred else {},{k} if k in ok else set()))
        detail.append({"id":row["id"],**m,"errors":errs,"accepted":pred})
        engine.append({"id":row["id"],"text":row["text"],"proposedFacts":[
          {"id":IDS[k],"value":v[0],"evidenceExcerpt":v[1],"provenance":"model_extraction",
           "confidence":0.6} for k,v in pred.items()]})
    output={}
    for k,c in groups.items():
        d=dict(c);d["precision"]=round(c["tp"]/(c["tp"]+c["fp"]),4) if c["tp"]+c["fp"] else None
        d["recall"]=round(c["tp"]/(c["tp"]+c["fn"]),4) if c["tp"]+c["fn"] else None
        output[k]=d
    return {"groups":output,"validation_errors":dict(errors),"rows":detail,"engine_inputs":engine}

def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument("--tag",default="e1-20261028");a=p.parse_args()
    load=lambda n:[json.loads(s) for s in (ROOT/n).read_text(encoding="utf-8").splitlines()]
    rows=load("legacy.jsonl")+load("fresh.jsonl")
    if a.tag.startswith("e2"):rows+=load("confirmation.jsonl")
    folder=ROOT/"results"
    gpu=json.loads((folder/f"{a.tag}-gpu.json").read_text(encoding="utf-8"))
    if "evaluation_rows" in gpu:rows=gpu["evaluation_rows"]
    out={name:summary(rows,r) for name,r in gpu["runs"].items()}
    historical={}
    for name in ["v2_prompt","v2_prompt_rerun"]:
        path=ROOT.parents[1]/"classifier/results"/f"fact_extraction_{name}.json"
        old=json.loads(path.read_text(encoding="utf-8"))
        counts=collections.Counter()
        for id_ in IDS.values():
            c=old["per_id"].get(id_,{})
            counts.update(tp=c.get("tp",0),fp=c.get("fp_unsupported",0)+c.get("wrong_value",0),
                          fn=c.get("fn",0)+c.get("wrong_value",0))
        historical[name]={**dict(counts),"precision":counts["tp"]/(counts["tp"]+counts["fp"]),
          "recall":counts["tp"]/(counts["tp"]+counts["fn"]),
          "source":str(path.relative_to(ROOT.parents[1])).replace(chr(92),"/"),
          "caveat":"Historical cloud run, same legacy rows/eight ids; broader prompt; no new cloud call."}
    out["historical_cloud_eight_ids"]=historical
    cpu_path=folder/f"{a.tag}-cpu.json"
    if cpu_path.exists():
        cpu=json.loads(cpu_path.read_text(encoding="utf-8"));preds=cpu["rows"]
        sub=[next(r for r in rows if r["id"]==v["id"]) for v in preds]
        runtime_name="cpu-fp32" if "no quantization" in cpu["runtime"] else "cpu-int8"
        out[runtime_name]=summary(sub,preds)
        reference=next(k for k in ["qwen3-4b-lora","qwen3-4b-prompt2","qwen15-lora"] if k in gpu["runs"])
        ref={r["id"]:r for r in gpu["runs"][reference]}
        changes=[]
        for row,r in zip(sub,preds):
            before,_=decode(ref[r["id"]]["raw"],row["text"]);after,_=decode(r["raw"],row["text"])
            val=lambda d:{k:v[0] for k,v in d.items()}
            if val(before)!=val(after): changes.append(r["id"])
        lat=sorted(r["batch_elapsed_s"]*1000 for r in preds)
        out["cpu_measurement"]={k:v for k,v in cpu.items() if k!="rows"}
        out["cpu_measurement"].update(p50_ms=lat[len(lat)//2],p95_ms=lat[math.ceil(.95*len(lat))-1],
           changed_rows_vs_gpu=changes,rows=len(preds),generated_tokens=sum(r["generated_tokens"] for r in preds))
    (folder/f"{a.tag}-scored.json").write_text(json.dumps(out,ensure_ascii=False,indent=1),encoding="utf-8")
    for name,r in out.items():
        print(name,json.dumps(r.get("groups",{}).get("all",r),ensure_ascii=False))
if __name__=="__main__":main()
