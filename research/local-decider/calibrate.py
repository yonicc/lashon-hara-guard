"""Choose thresholds on development ONLY; then report frozen Set B, no retuning."""
import json,pathlib,sys,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/"classifier"))
from gate_route import uses_second_model,combine
bench=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
ref=json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
labels={r["id"]:r for r in map(json.loads,(root/"classifier/data/decider_setB_concern_v1.jsonl").read_text(encoding="utf-8").splitlines())}
def routed(i,source):
 he=source["v2"]["p"][i];ml=source["v4-xlmr-ml"]["p"][i]
 return combine(he,ml if uses_second_model(bench["rows"][i]["text"]) else None)
dev=[(r["gold"],routed(i,bench["runs"])) for i,r in enumerate(bench["rows"]) if r["dataset"]=="dev" and r["gold"]!="ambiguous"]
values=sorted(set(p for _,p in dev))
grid=[0.]+[(a+b)/2 for a,b in zip(values,values[1:])]+[1.]
def metrics(rows,t):
 tp=sum(g=="concern" and p>=t for g,p in rows);fp=sum(g=="no_concern" and p>=t for g,p in rows)
 fn=sum(g=="concern" and p<t for g,p in rows);tn=sum(g=="no_concern" and p<t for g,p in rows)
 return dict(tp=tp,fp=fp,fn=fn,tn=tn,precision=tp/(tp+fp) if tp+fp else None,recall=tp/(tp+fn) if tp+fn else None,fnr=fn/(tp+fn) if tp+fn else None)
# Development objective: >=95% warning precision, >=20 predicted;
# low band <=1% missed concern. This low band remains UNSURE at runtime.
eligible=[t for t in grid if metrics(dev,t)["precision"] is not None and metrics(dev,t)["precision"]>=.95 and metrics(dev,t)["tp"]+metrics(dev,t)["fp"]>=20]
assert eligible,"No supported warning band; do not ship"
high=min(eligible)
low=max((t for t in grid if t<high and metrics(dev,t)["fnr"]<=.01),default=0.)
policy=root/"extension/decider-policy.mjs"
assert not policy.exists(),"Thresholds already frozen"
policy.write_bytes(("export const T_LOW="+str(low)+";\nexport const T_HIGH="+str(high)+";\nexport function meaningBand(p){\n if(!Number.isFinite(p)||p<0||p>1)throw Error('invalid-meaning-score');\n return p>=T_HIGH?'warn':p<T_LOW?'low':'unsure';\n}\n").encode())
report={"calibration":"development only; warning P>=0.95 with >=20 predictions; low FNR<=0.01; low remains unsure. The initial 0.98 objective had no eligible band and was revised using development data only.","thresholds":{"low":low,"high":high},"dev":{"low":metrics(dev,low),"high":metrics(dev,high)},"setB":{},"parity":{},"latency":{k:{x:v for x,v in r.items() if x not in ("p","times")} for k,r in bench["runs"].items()}}
for ds in ("dev","setB"):
 indices=[i for i,r in enumerate(bench["rows"]) if r["dataset"]==ds]
 ps=[routed(i,bench["runs"]) for i in indices];py=[routed(i,ref["reference"]) for i in indices]
 report["parity"][ds]={"n":len(indices),"warning_flips":sum((p>=high)!=(q>=high) for p,q in zip(ps,py)),"low_flips":sum((p<low)!=(q<low) for p,q in zip(ps,py))}
 if ds=="setB":
  rows=[(labels[bench["rows"][i]["id"]]["gold"],routed(i,bench["runs"])) for i in indices if labels[bench["rows"][i]["id"]]["gold"]!="ambiguous"]
  report["setB"]={"n":len(rows),"ambiguous":len(indices)-len(rows),"high":metrics(rows,high),"low":metrics(rows,low),"note":"287 concern, 2 no_concern, 11 ambiguous; agent-only labels. Precision/false positives have only two negative controls, not population estimates."}
out=root/"research/local-decider/report.json";out.write_bytes((json.dumps(report,indent=2)+"\n").encode())
print(json.dumps(report,indent=2))
