"""Measurement only. Reuse the frozen independent scorer; never fit anything here."""
import argparse, ast, collections, hashlib, json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
EVAL = ROOT / "research/independent-eval-20261029"
def load(path):
    return [json.loads(s) for s in path.read_text(encoding="utf-8").splitlines() if s.strip()]
tree = ast.parse((EVAL/"score_all.py").read_text(encoding="utf-8"))
function = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=="decode")
namespace = {"json":json}
exec(compile(ast.Module(body=[function],type_ignores=[]),str(EVAL/"score_all.py"),"exec"),namespace)
decode = namespace["decode"]
parser = argparse.ArgumentParser()
parser.add_argument("--chunks",type=pathlib.Path,required=True)
args = parser.parse_args()
contract = json.loads((ROOT/"research/local-extractor/contract_v2.json").read_text(encoding="utf-8"))
keys = [f[0] for f in contract["facts"]]
old = keys[:8]
messages = load(EVAL/"setA_messages.jsonl")+load(EVAL/"setB/messages.jsonl")
texts = {r["id"]:r["text"] for r in messages}
bf = {r["id"]:r for r in load(EVAL/"results/e10v2.raw.jsonl")}
files = sorted(args.chunks.glob("chunk-*.json"), key=lambda p:int(p.stem.split("-")[1]))
gg={}; first_chunk={}; duplicates=[]
for path in files:
    for row in json.loads(path.read_text(encoding="utf-8"))["rows"]:
        i=row["id"]
        if i in gg:
            # A stopped function can publish its final commit after a resume snapshot.
            # Accept only byte-identical outputs/prompts/stop reasons, never select by gold.
            assert all(row[k]==gg[i][k] for k in ("raw","prompt_sha256","hit_limit")), "Conflicting repeated measurement"
            duplicates.append({"id":i,"first_chunk":first_chunk[i],"repeat_chunk":path.name,"repeat":row})
        else:
            gg[i]=row; first_chunk[i]=path.name
raw = list(gg.values())
assert len(raw)==700 and len({r["id"] for r in raw})==700
assert set(gg)==set(bf)==set(texts)
# Compare every measured prompt byte with the actual built extension render().
script = """const fs=require('node:fs'),crypto=require('node:crypto');
require('./extension/ollama-client.js');require('./extension/ollama-engine.bundle.js');
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(Object.fromEntries(rows.map(r=>[r.id,crypto.createHash('sha256')
.update(globalThis.LHG_OLLAMA_ENGINE.render(globalThis.LHG_OLLAMA_CLIENT.DEFAULT_MODEL,r.text)).digest('hex')]))));"""
prompts = json.loads(subprocess.check_output(["node","-e",script],input=json.dumps(messages,ensure_ascii=False).encode(),cwd=ROOT))
assert all(r["prompt_sha256"]==prompts[r["id"]] for r in raw), "Runtime prompt mismatch"
def metric(rows,pred,scope):
    counts = collections.Counter(); errors = collections.Counter(); decisions={}
    for g in rows:
        p,e=decode(pred[g["id"]]["raw"],texts[g["id"]],keys)
        p={k:v[0] for k,v in p.items() if k in scope}
        gold={k:v[0] for k,v in g["facts_v2"].items() if k in scope}
        decisions[g["id"]]=p
        counts["format_error_rows"]+=bool(e)
        counts["hit_limit"]+=bool(pred[g["id"]].get("hit_limit"))
        errors.update(e)
        for k in p.keys()|gold.keys():
            if k in p and k in gold: counts["tp" if p[k]==gold[k] else "wrong"]+=1
            else: counts["unsupported" if k in p else "missed"]+=1
    tp=counts["tp"]; fp=counts["wrong"]+counts["unsupported"]; fn=counts["wrong"]+counts["missed"]
    return {"precision":tp/(tp+fp) if tp+fp else 0,"recall":tp/(tp+fn) if tp+fn else 0,
            **dict(counts),"errors":dict(errors)},decisions
def pinned_hash(path):
    committed=subprocess.check_output(["git","show","HEAD:"+path.relative_to(ROOT).as_posix()],cwd=ROOT)
    assert load(path)==[json.loads(s) for s in committed.decode("utf-8").splitlines() if s.strip()]
    return hashlib.sha256(committed).hexdigest()
report={"prompt_parity_rows":700,"checkpoint":"e10-v2-7b-20261029-supervisor",
        "duplicate_measurements":duplicates,
        "input_commit":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT).decode().strip(),
        "quant":"Q4_K_M","sets":{},"gate_pass":True,"failures":[],
        "git_bytes_sha256":{p.relative_to(EVAL).as_posix():pinned_hash(p)
                  for p in [EVAL/"setA_messages.jsonl",EVAL/"setB/messages.jsonl",
                            EVAL/"gold/setA_gold_generator.jsonl",EVAL/"gold/setB_gold_final.jsonl",EVAL/"results/e10v2.raw.jsonl"]}}
for name,file in [("A","setA_gold_generator.jsonl"),("B","setB_gold_final.jsonl")]:
    rows=load(EVAL/"gold"/file); report["sets"][name]={}
    for scope_name,scope in [("8",old),("18",keys)]:
        a,ad=metric(rows,gg,scope); b,bd=metric(rows,bf,scope)
        flips=[i for i in ad if ad[i]!=bd[i]]
        result={"rows":len(rows),"gguf":a,"bf16":b,"decision_flips":len(flips),"flip_ids":flips,
                "delta_precision":a["precision"]-b["precision"],"delta_recall":a["recall"]-b["recall"]}
        report["sets"][name][scope_name]=result
        for metric_name in ["precision","recall"]:
            if result["delta_"+metric_name]<-0.02: report["failures"].append(f"{name}/{scope_name}: {metric_name} drop >0.02")
        if a["format_error_rows"]>b["format_error_rows"]: report["failures"].append(f"{name}/{scope_name}: format errors increased")
        if a["hit_limit"]>b["hit_limit"]: report["failures"].append(f"{name}/{scope_name}: token-limit hits increased")
report["gate_pass"]=not report["failures"]
out=ROOT/"research/local-extractor/results"
(out/"e11-v2-parity.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8",newline="\n")
(out/"e11-v2-parity.raw.jsonl").write_text("\n".join(json.dumps(r,ensure_ascii=False) for r in raw)+"\n",encoding="utf-8",newline="\n")
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(0 if report["gate_pass"] else 2)
