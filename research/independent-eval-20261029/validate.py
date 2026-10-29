"""Validate this independent synthetic set without model calls or external data."""
import collections, difflib, hashlib, json, pathlib, re, unicodedata
ROOT = pathlib.Path(r"D:\lhg-independent-eval")
ALIASES = ["purpose","intent","revenge","firsthand","verified","rebuke","rejects","no_alternative","said_in_jest","is_hint","medium_written","same_self_disparagement","unverified_rumor","second_source","future_purpose","requested_disclosure","repeats_prior","subject_self_disclosed"]
V1 = ALIASES[:8]
def read(name):
    def unique(pairs):
        d = {}
        for k,v in pairs:
            assert k not in d, ("duplicate JSON key",k)
            d[k]=v
        return d
    return [json.loads(s, object_pairs_hook=unique) for s in (ROOT/name).read_text(encoding="utf-8").splitlines()]
m=read("messages.jsonl")
g=read("sealed/gold_generator.jsonl")
assert len(m)==len(g)==400
assert len({r["id"] for r in m})==400
assert {r["id"] for r in m}=={r["id"] for r in g}
gm={r["id"]:r for r in g}
langs=collections.Counter()
heads=collections.Counter()
facts={k:collections.Counter() for k in ALIASES}
empty=0
for r in m:
    assert set(r)=={"id","lang","text"}
    assert r["lang"] in ("he","en","mixed")
    assert isinstance(r["text"],str) and r["text"].strip()
    he=bool(re.search(r"[\u0590-\u05ff]",r["text"]))
    en=bool(re.search("[A-Za-z]",r["text"]))
    assert (he,en)=={"he":(True,False),"en":(False,True),"mixed":(True,True)}[r["lang"]],r["id"]
    langs[r["lang"]]+=1
    gold=gm[r["id"]]
    assert set(gold)=={"id","facts_v2","facts_v1","router"}
    assert gold["facts_v1"]=={k:v for k,v in gold["facts_v2"].items() if k in V1}
    for k,v in gold["facts_v2"].items():
        assert k in ALIASES
        assert isinstance(v,list) and len(v)==2 and type(v[0]) is bool
        assert isinstance(v[1],str) and v[1] and v[1] in r["text"],(r["id"],k)
        facts[k][str(v[0]).lower()]+=1
    empty+=not bool(gold["facts_v2"])
    h=gold["router"]["heads"]
    assert len(set(h))==len(h)
    assert set(h)<= {"mem_recent","mem_search","ask_user"}
    heads.update(h or ["none"])
assert langs=={"he":180,"en":160,"mixed":60}
assert all(heads[k]>=60 for k in ["none","mem_recent","mem_search","ask_user"])
assert all(facts[k][v]>=12 for k in ALIASES for v in ("true","false"))
def normalize(s):
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in unicodedata.normalize("NFKC",s)).split())
norm=[normalize(r["text"]) for r in m]
assert len(set(norm))==400,"normalized duplicate"
near=[]
for i,a in enumerate(norm):
    sa=set(a.split())
    for j in range(i):
        b=norm[j]; sb=set(b.split())
        jac=len(sa & sb)/len(sa | sb)
        char=difflib.SequenceMatcher(None,a,b,autojunk=False).ratio() if min(len(a),len(b))/max(len(a),len(b))>=.75 else 0
        if jac>=.65 or char>=.88:
            near.append({"ids":[m[j]["id"],m[i]["id"]],"token_jaccard":round(jac,4),"character_ratio":round(char,4)})
report={"rows":len(m),"languages":dict(langs),"router":dict(heads),"facts":facts,"empty_facts":empty,"near_duplicate_thresholds":{"token_jaccard":.65,"character_sequence_ratio":.88},"near_duplicate_pairs":near,"sha256":{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ["messages.jsonl","sealed/gold_generator.jsonl"]}}
(ROOT/"validation_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(report,ensure_ascii=True,indent=2))
assert not near,"near duplicate candidates require review"

# Preserve all Set A checks and extend the entry point to Set B and A/B overlap.
import runpy
runpy.run_path(str(ROOT/"validation_b.py"), run_name="__main__")
