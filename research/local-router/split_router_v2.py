"""Family split for router v2. Text+family disjoint across splits."""
import collections, hashlib, json, pathlib, random, re
ROOT = pathlib.Path(__file__).parent
NORM = lambda s: re.sub(r"\s+", " ", s).strip().casefold()
def sha256_bytes(b): return hashlib.sha256(b).hexdigest()
def main(seed=20261029):
    src = ROOT / "router_train_v2.jsonl"
    rows = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert all("family" in r for r in rows), "all router rows must have family"
    by_fam = collections.defaultdict(list)
    for r in rows: by_fam[r["family"]].append(r)
    families = sorted(by_fam.keys())
    rng = random.Random(seed + 777)
    rng.shuffle(families)
    n = len(families)
    n_train = max(1, n - 20)
    n_dev = 10
    n_hold = n - n_train - n_dev
    if n_hold < 0:
        n_dev = max(0, n - n_train)
        n_hold = 0
    fam_train = set(families[:n_train])
    fam_dev = set(families[n_train:n_train+n_dev])
    fam_hold = set(families[n_train+n_dev:])
    assert not (fam_train & fam_dev) and not (fam_train & fam_hold) and not (fam_dev & fam_hold)
    specs = [("router_train_v2", fam_train), ("router_dev_v2", fam_dev), ("router_holdout_v2", fam_hold)]
    out = {}
    for name, fams in specs:
        out_rows=[]
        for f in sorted(fams):
            for r in by_fam[f]:
                rr=dict(r); rr["split"]=name.split("_")[1] if "_" in name else name
                out_rows.append(rr)
        out_rows.sort(key=lambda r: r["id"])
        norms=[NORM(r["message"]) for r in out_rows]
        assert len(norms)==len(set(norms))
        path = ROOT / f"{name}.jsonl"
        if out_rows:
            path.write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in out_rows), encoding="utf-8")
            print(json.dumps({name: len(out_rows), "families": len(fams), "sha256": sha256_bytes(path.read_bytes())}, ensure_ascii=False))
            out[name]=path
        else:
            if path.exists(): path.unlink()
            print(json.dumps({name: 0, "families": 0, "note": "empty"}, ensure_ascii=False))
    norms_all=[]
    for name,_ in specs:
        p=ROOT / f"{name}.jsonl"
        if p.exists():
            norms_all.append(set(NORM(json.loads(l)["message"]) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()))
    for i in range(len(norms_all)):
        for j in range(i+1,len(norms_all)):
            assert not (norms_all[i] & norms_all[j]), "router text overlap across splits"
    manifest={"version":2,"seed":seed,"input":"router_train_v2.jsonl","families_total":n,"splits":{n:{"families":len(f), "rows": len([r for fam in f for r in by_fam[fam]])} for n,f in [("train",fam_train),("dev",fam_dev),("holdout",fam_hold)]},"provenance":"synthetic_template_v2, family-grouped, mixed+combo heads","review_status":"synthetic, human_review_pending, agent_reviewed false","note":"router v2 is template seed only; production needs thousands via EN->DictaLM->audit pipeline (40.next.2)","hashes":{n: sha256_bytes((ROOT/f"{n}.jsonl").read_bytes()) for n in ["router_train_v2","router_dev_v2","router_holdout_v2"] if (ROOT/f"{n}.jsonl").exists()}}
    (ROOT/"manifest_router_v2.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__=="__main__": main()
