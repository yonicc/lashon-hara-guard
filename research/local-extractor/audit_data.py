"""Offline integrity checks; no claim of human/halachic label approval."""
import collections
import hashlib
import json
import pathlib
import re
ROOT=pathlib.Path(__file__).parent
def load(n):return [json.loads(s) for s in (ROOT/n).read_text(encoding="utf-8").splitlines()]
def main():
    datasets={n:load(n) for n in ["train.jsonl","legacy.jsonl","fresh.jsonl","confirmation.jsonl"]}
    norm=lambda s:re.sub(r"\s+"," ",s).casefold().strip()
    sets={n:{norm(r["text"]) for r in rows} for n,rows in datasets.items()}
    assert not sets["train.jsonl"] & (sets["legacy.jsonl"]|sets["fresh.jsonl"]|sets["confirmation.jsonl"])
    assert not sets["confirmation.jsonl"] & (sets["legacy.jsonl"]|sets["fresh.jsonl"])
    for rows in datasets.values():
        assert len({r["id"] for r in rows})==len(rows)
        for r in rows:
            assert all(r[k] is True for k in ["synthetic","agent_reviewed","human_review_pending"])
    for r in datasets["train.jsonl"]:
        for k,(value,evidence) in r["gold"].items():
            assert type(value) is bool and evidence in r["text"]
    families=collections.Counter(r["family"] for r in datasets["fresh.jsonl"])
    assert len(families)==24 and set(families.values())=={3}
    confirmation=collections.Counter(r["family"] for r in datasets["confirmation.jsonl"])
    assert len(confirmation)==16 and set(confirmation.values())=={3}
    out={}
    for name,rows in datasets.items():
        counts=collections.Counter()
        for r in rows:
            d=r.get("expect",r.get("gold"))
            for k,v in d.items():
                if isinstance(v,list):v=v[0]
                counts[f"{k}:{str(v).lower()}"]+=1
        out[name]={"rows":len(rows),"languages":dict(collections.Counter(r["language"] for r in rows)),
          "labels":dict(counts),"sha256":hashlib.sha256((ROOT/name).read_bytes()).hexdigest()}
    out["limitations"]=["Template-generated training; no real messages.",
      "Fresh set: 24 semantic families with three language variants; not 72 independent situations.",
      "Confirmation: 16 families x three languages, authored after e1 review but before e2 predictions.",
      "One agent authored templates and separate fresh cases. No external/human label review.",
      "No normalized exact overlap. This does not prove semantic independence."]
    out["normalized_exact_train_eval_overlap"]=0
    (ROOT/"results").mkdir(exist_ok=True)
    (ROOT/"results/data-audit.json").write_text(json.dumps(out,indent=1),encoding="utf-8")
    print(json.dumps(out))
if __name__=="__main__":main()
