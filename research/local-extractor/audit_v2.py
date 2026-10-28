"""Quality/leakage report and human-review export for the v2 data. Offline, deterministic, no model call.

    py research/local-extractor/audit_v2.py
Writes results/audit_v2.json and results/review_v2.csv (UTF-8 with BOM so Excel shows Hebrew).
The CSV is a stratified sample for a HUMAN reviewer: every split x fact x value, every contrast kind and a
natural-row sample per language. Columns human_verdict/human_note are empty: no human review has happened.
"""
import collections, csv, hashlib, json, pathlib, random

ROOT = pathlib.Path(__file__).parent
SPLITS = {"train": "train_v2.jsonl", "dev": "dev_v2.jsonl", "holdout": "holdout_v2.jsonl"}


def load(p):
    return [json.loads(s) for s in (ROOT / p).read_text(encoding="utf-8").splitlines() if s.strip()]


def main():
    man = json.loads((ROOT / "manifest_v2.json").read_text(encoding="utf-8"))
    data = {s: load(p) for s, p in SPLITS.items()}
    for s, p in SPLITS.items():
        assert hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == man["splits"][s]["sha256"], f"{p} != manifest"
    keys = [f[0] for f in json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))["facts"]]
    rep = {"manifest_version": man["version"], "leakage": man["leakage"], "splits": {}}
    for s, rows in data.items():
        cov = collections.Counter(f"{k}:{str(v[0]).lower()}" for r in rows for k, v in r["gold"].items())
        k_hist = collections.Counter(len(r["gold"]) for r in rows)
        missing = [f"{k}:{v}" for k in keys for v in ("true", "false") if not cov[f"{k}:{v}"]]
        rep["splits"][s] = {"rows": len(rows), "families": len({r["family"] for r in rows}),
                            "by_language": dict(collections.Counter(r["language"] for r in rows)),
                            "by_provenance": dict(collections.Counter(r["provenance"] for r in rows)),
                            "facts_per_row": dict(sorted(k_hist.items())), "min_fact_value_count": min(cov[f"{k}:{v}"] for k in keys for v in ("true", "false")),
                            "missing_fact_values": missing,
                            "natural_fact_values": dict(sorted(collections.Counter(
                                f"{k}:{str(v[0]).lower()}" for r in rows if r["provenance"].startswith("natural")
                                for k, v in r["gold"].items()).items()))}
    gs = ROOT / "results" / "natural_v2-genstats.json"
    if gs.exists():
        g = json.loads(gs.read_text(encoding="utf-8"))
        rep["natural_generation"] = {"stats": g["stats"], "models": g["models"], "seed": g["seed"], "n": g["n"]}
    rep["review_status"] = man["review_status"]
    rng = random.Random(20261029)
    sample = []
    for s, rows in data.items():
        tmpl = [r for r in rows if r["provenance"] == "synthetic_template"]
        for k in keys:
            for v in (True, False):
                pool = [r for r in tmpl if k in r["gold"] and r["gold"][k][0] is v]
                sample += [(s, r) for r in rng.sample(pool, min(1, len(pool)))]
        con = [r for r in rows if r["provenance"] == "synthetic_template_contrast"]
        sample += [(s, r) for r in rng.sample(con, min(6, len(con)))]
        unk = [r for r in tmpl if not r["gold"]]
        sample += [(s, r) for r in rng.sample(unk, min(4, len(unk)))]
        for lang in ("he", "en", "mixed"):
            nat = [r for r in rows if r["provenance"].startswith("natural") and r["language"] == lang]
            sample += [(s, r) for r in rng.sample(nat, min(12 if s == "train" else 6, len(nat)))]
    with open(ROOT / "results" / "review_v2.csv", "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "split", "provenance", "language", "family", "text", "gold_json", "human_verdict", "human_note"])
        for s, r in sample:
            w.writerow([r["id"], s, r["provenance"], r["language"], r["family"], r["text"],
                        json.dumps(r["gold"], ensure_ascii=False), "", ""])
    rep["review_export"] = {"path": "results/review_v2.csv", "rows": len(sample), "status": "human_review_pending"}
    (ROOT / "results" / "audit_v2.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({s: {k: v[k] for k in ("rows", "families", "min_fact_value_count", "missing_fact_values")}
                      for s, v in rep["splits"].items()}, ensure_ascii=False), "review rows", len(sample))


if __name__ == "__main__":
    main()
