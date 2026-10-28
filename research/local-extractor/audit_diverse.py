"""Audit the v2 corpus and produce a small reproducible review export."""
import collections,hashlib,json,pathlib,random
ROOT=pathlib.Path(__file__).parent
def load(n):return [json.loads(s) for s in (ROOT/n).read_text(encoding="utf-8").splitlines()]
def main():
 train=load("diverse/train.jsonl");test=load("diverse/sealed.jsonl")
 aliases={a for a,_,_ in json.loads((ROOT/"contract.json").read_text())["facts"]}
 normalize=lambda s:" ".join(s.lower().split())
 texts={normalize(r["text"]) for r in train}
 assert len(texts)==len(train)
 assert not texts & {normalize(r["text"]) for r in test}
 for n in ["legacy.jsonl","fresh.jsonl","confirmation.jsonl"]:
  assert not texts & {normalize(r["text"]) for r in load(n)},n
 assert not {r["family"] for r in train if "family" in r} & {r["family"] for r in test}
 for r in train+test:
  assert all(r.get(k) is True for k in ["synthetic","agent_reviewed","human_review_pending"])
 for r in train:
  assert set(r["gold"])<=aliases
  for v,e in r["gold"].values():assert type(v) is bool and e.strip() and e in r["text"]
 for r in test:
  assert set(r["expect"])<=aliases and all(type(v) is bool for v in r["expect"].values())
 rng=random.Random(142)
 sample=rng.sample(train,36)
 out={"train":len(train),"evaluation":len(test),"families":len({r["family"] for r in test}),
  "train_languages":dict(collections.Counter(r["language"] for r in train)),
  "eval_languages":dict(collections.Counter(r["language"] for r in test)),
  "empty_train":sum(not r["gold"] for r in train),"empty_eval":sum(not r["expect"] for r in test),
  "review_sample":sample,
  "review_note":"Provisional same-agent authorship and review. Sample exported for semantic inspection; no human review.",
  "sha256":{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ["diverse/train.jsonl","diverse/sealed.jsonl"]}}
 (ROOT/"diverse/audit.json").write_text(json.dumps(out,ensure_ascii=False,indent=1),encoding="utf-8")
 print(json.dumps({k:v for k,v in out.items() if k!="review_sample"},ensure_ascii=False,indent=1))
 for r in sample:print(json.dumps({"id":r["id"],"text":r["text"],"gold":r["gold"]},ensure_ascii=False))
if __name__=="__main__":main()
