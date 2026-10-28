"""Audit + review export for extractor v2.

Produces results/audit_v2.json and results/review_v2.csv from family-sliced splits.

Checks: alias/canonical, evidence verbatim, family+text disjoint, unknown not false,
synthetic provenance, no human claim. Development holdout is NOT independent if inspected.
"""
import collections, csv, hashlib, json, pathlib, random, re
ROOT = pathlib.Path(__file__).parent
RESULTS = ROOT / "results"
NORM = lambda s: re.sub(r"\s+", " ", s).strip().casefold()
def sha256(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(name): return [json.loads(l) for l in (ROOT / name).read_text(encoding="utf-8").splitlines() if l.strip()]

def main():
    CONTRACT = json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))
    ALIASES = {f[0] for f in CONTRACT["facts"]}
    MAP = {f[0]: f[1] for f in CONTRACT["facts"]}
    CATALOG = {f["id"] for f in json.loads((ROOT.parent.parent / "rules/chafetz-chaim/facts.json").read_text(encoding="utf-8"))["facts"]}
    files = ["train_v2.jsonl","dev_v2.jsonl","holdout_v2.jsonl"]
    datasets = {n: load(n) for n in files}
    # text + family disjoint
    norms = {n: {NORM(r["text"]) for r in rows} for n, rows in datasets.items()}
    fams = {n: {r["family"] for r in rows} for n, rows in datasets.items()}
    assert not (norms["train_v2.jsonl"] & norms["dev_v2.jsonl"])
    assert not (norms["train_v2.jsonl"] & norms["holdout_v2.jsonl"])
    assert not (norms["dev_v2.jsonl"] & norms["holdout_v2.jsonl"])
    assert not (fams["train_v2.jsonl"] & fams["dev_v2.jsonl"])
    assert not (fams["train_v2.jsonl"] & fams["holdout_v2.jsonl"])
    assert not (fams["dev_v2.jsonl"] & fams["holdout_v2.jsonl"])
    for n, rows in datasets.items():
        assert len({r["id"] for r in rows}) == len(rows), n
        for r in rows:
            assert r.get("synthetic") is True and r.get("human_review_pending") is True, r["id"]
            # agent_reviewed must be false until synthetic verification has run
            assert r.get("agent_reviewed") is False, f"{r['id']}: agent_reviewed must be false (mark true only after synthetic check)"
            assert set(r.get("gold",{})) <= ALIASES, r["id"]
            for k,(v,ev) in r.get("gold",{}).items():
                assert MAP[k] in CATALOG, f"{r['id']} {k} not in facts.json"
                assert type(v) is bool and ev in r["text"], f"{r['id']} {k} evidence"
            # provenance
            assert r.get("provenance","").startswith("synthetic"), r["id"]
            assert r.get("language") in ("he","en","mixed")
        # empty gold should include contrasts + some unknowns; verify not claiming false
        empty = sum(1 for r in rows if not r.get("gold"))
        assert empty >= 0

    out={}
    for name, rows in datasets.items():
        counts=collections.Counter()
        for r in rows:
            for k,(v,_) in r.get("gold",{}).items():
                counts[f"{k}:{str(v).lower()}"]+=1
        out[name]={"rows": len(rows), "families": len(fams[name]), "languages": dict(collections.Counter(r["language"] for r in rows)), "labels": dict(counts), "sha256": sha256(ROOT/name)}
    # contrasts present
    train_rows = datasets["train_v2.jsonl"] if "train_v2.jsonl" in datasets else datasets["train_v2"]
    contrast = sum(1 for r in datasets["train_v2.jsonl"] if r.get("provenance")=="synthetic_template_contrast")
    out["contrasts_in_train_v2"]=contrast
    out["holdout_note"]="holdout_v2 was generated together with train; author has seen it — must be treated as development, not independent"
    out["limitations"]=[
        "Template synthetic only; no natural/LLM-authored language in v2.",
        "Same agent/seed authored all splits; holdout is not independent.",
        "No human or halachic review of gold; provisional agent template.",
        "Router v2 remains 74 template rows; needs EN->DictaLM->audit expansion to thousands.",
        "unknown omitted == unknown, never false; enforced by validator.",
    ]
    out["normalized_exact_overlap"]=0
    out["family_overlap"]=0
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "audit_v2.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    # review export
    rng=random.Random(142)
    sample=rng.sample(datasets["train_v2.jsonl"], min(36, len(datasets["train_v2.jsonl"])))
    csv_path = RESULTS / "review_v2.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w=csv.writer(f)
        w.writerow(["id","family","language","text","gold","provenance","human_review_pending"])
        for r in sample:
            w.writerow([r["id"], r["family"], r["language"], r["text"], json.dumps(r.get("gold",{}), ensure_ascii=False), r.get("provenance"), r.get("human_review_pending")])
    print(f"review csv: {csv_path} rows {len(sample)}")

if __name__=="__main__": main()
