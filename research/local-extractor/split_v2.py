"""Family-stratified split for extractor v2. No translation leakage.

Groups paraphrases/translations of the same fact combination into one family
so no train/dev/holdout split shares a family. Produces manifest + hashes.

All synthetic, human_review_pending. Holdout is independent only if created
before any tuning; if you have already inspected it, it is development diagnostics.
"""
import collections
import hashlib
import json
import pathlib
import random
import re

ROOT = pathlib.Path(__file__).parent
NORM = lambda s: re.sub(r"\s+", " ", s).strip().casefold()

def sha256_bytes(b): return hashlib.sha256(b).hexdigest()

def main(seed=20261029, input_file="train_v2.jsonl", train_ratio=0.85, dev_ratio=0.07):
    src = ROOT / input_file
    rows = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert all("family" in r for r in rows), "all rows must have family"
    # group by family
    by_fam = collections.defaultdict(list)
    for r in rows:
        by_fam[r["family"]].append(r)
    families = sorted(by_fam.keys())
    rng = random.Random(seed + 999)
    rng.shuffle(families)
    n = len(families)
    n_train = int(n * train_ratio)
    n_dev = int(n * dev_ratio)
    n_hold = n - n_train - n_dev
    # ensure holdout gets at least contrasts and a share of each language
    fam_train = set(families[:n_train])
    fam_dev = set(families[n_train:n_train+n_dev])
    fam_hold = set(families[n_train+n_dev:])
    # re-balance so holdout is not empty of languages
    # if holdout empty language, steal one family per missing lang
    def langs_of(fams): 
        s=set()
        for f in fams:
            for r in by_fam[f]: s.add(r["language"])
        return s
    # trivial deterministic adjust: move one family per missing language from train
    for desired in ("he","en","mixed"):
        if desired not in langs_of(fam_hold):
            cand = [f for f in fam_train if desired in langs_of({f})]
            if cand:
                fam_train.remove(cand[0]); fam_hold.add(cand[0])
    splits = {"train": fam_train, "dev": fam_dev, "holdout": fam_hold}
    out_paths = {}
    for split_name, fams in splits.items():
        out_rows = []
        for f in sorted(fams):
            for r in by_fam[f]:
                rr = dict(r)
                rr["split"] = split_name
                out_rows.append(rr)
        # deterministic order
        out_rows.sort(key=lambda r: r["id"])
        # dedup normalized text not expected to overlap, but enforce
        norms = [NORM(r["text"]) for r in out_rows]
        assert len(norms) == len(set(norms)), f"duplicate normalized text in {split_name}"
        path = ROOT / f"{split_name}_v2.jsonl"
        path.write_text("".join(json.dumps(r, ensure_ascii=False)+"\n" for r in out_rows), encoding="utf-8")
        out_paths[split_name] = str(path)
        print(json.dumps({split_name: len(out_rows), "families": len(fams), "sha256": sha256_bytes(path.read_bytes())}, ensure_ascii=False))

    # cross-split family disjoint
    assert not (fam_train & fam_dev) and not (fam_train & fam_hold) and not (fam_dev & fam_hold), "family overlap"

    # cross-split normalized text disjoint
    def load_norms(p):
        return {NORM(json.loads(l)["text"]) for l in open(ROOT/p, encoding="utf-8")}
    assert not (load_norms("train_v2.jsonl") & load_norms("dev_v2.jsonl") if (ROOT/"dev_v2.jsonl").exists() else set())
    # more explicit across the three
    norm_train = {NORM(r["text"]) for r in [json.loads(l) for l in open(ROOT/"train_v2.jsonl", encoding="utf-8")] } if False else set()
    # just check fresh split files
    norms_by_split = {}
    for name in ("train_v2", "dev_v2", "holdout_v2"):
        pp = ROOT / f"{name}.jsonl"
        if pp.exists():
            norms_by_split[name] = {NORM(json.loads(l)["text"]) for l in pp.read_text(encoding="utf-8").splitlines() if l.strip()}
    keys = list(norms_by_split)
    for i in range(len(keys)):
        for j in range(i+1, len(keys)):
            assert not (norms_by_split[keys[i]] & norms_by_split[keys[j]]), f"text overlap {keys[i]} & {keys[j]}"

    # manifest
    manifest = {
        "version": 2,
        "seed": seed,
        "input": input_file,
        "splits": {k: {"families": len(v), "path": out_paths.get(k, k)} for k, v in splits.items()},
        "provenance": "synthetic_templates_v2, family-grouped; contrast empty-gold; unknown omitted",
        "review_status": "synthetic, human_review_pending (agent_reviewed false until synthetic verification runs)",
        "note": "holdout is independent only if never inspected for tuning; otherwise development diagnostics",
    }
    # add file hashes
    for name in ("train_v2", "dev_v2", "holdout_v2"):
        pp = ROOT / f"{name}.jsonl"
        if pp.exists():
            manifest.setdefault("hashes", {})[name] = sha256_bytes(pp.read_bytes())
    (ROOT / "manifest_v2.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
