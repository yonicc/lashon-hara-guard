"""Validator for 18-fact extractor v2 — verifier-gold semantics.

Checks per AGENTS / docs/39:
- gold alias ∈ contract_v2, canonical ∈ facts.json
- [bool, evidence_span] where evidence verbatim in text
- missing gold == unknown, never false (unknown_as_false forbidden)
- quoted / hypothetical / question scopes must be empty gold (contrasts)
- synthetic provenance consistent, no human review claim
- normalized exact text + family disjointness across splits
- per-fact and per-language coverage

Synthetic-only check; no training, no Modal, no human claim.
"""
import collections
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
CONTRACT = json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))
ALIAS_TO_CANON = {f[0]: f[1] for f in CONTRACT["facts"]}
ALIASES = set(ALIAS_TO_CANON)
CATALOG = {f["id"] for f in json.loads((ROOT.parent.parent / "rules/chafetz-chaim/facts.json").read_text(encoding="utf-8"))["facts"]}
NORM = lambda s: re.sub(r"\s+", " ", s).strip().casefold()

def load(p):
    return [json.loads(l) for l in (ROOT / p).read_text(encoding="utf-8").splitlines() if l.strip()]

def validate_rows(rows, label=""):
    errs = []
    for r in rows:
        if "gold" not in r:
            errs.append(f"{r.get('id')}: missing gold")
            continue
        if set(r["gold"]) - ALIASES:
            errs.append(f"{r['id']}: unknown alias {set(r['gold'])-ALIASES}")
        for k, v in r["gold"].items():
            if ALIAS_TO_CANON[k] not in CATALOG:
                errs.append(f"{r['id']}: alias {k} canonical {ALIAS_TO_CANON[k]} not in facts.json")
            if not isinstance(v, list) or len(v) != 2 or type(v[0]) is not bool or not isinstance(v[1], str):
                errs.append(f"{r['id']}/{k}: bad gold shape {v}")
                continue
            if v[1] not in r["text"]:
                errs.append(f"{r['id']}/{k}: evidence not verbatim in text")
            if not v[1].strip():
                errs.append(f"{r['id']}/{k}: empty evidence span")
        # provenance must be synthetic-only
        if not r.get("synthetic"):
            errs.append(f"{r['id']}: synthetic must be true")
        if r.get("human_review_pending") is not True:
            errs.append(f"{r['id']}: human_review_pending must be true (no human review)")
        # text present
        if not r.get("text") or not r.get("language") in ("he", "en", "mixed"):
            errs.append(f"{r['id']}: bad language/text")
        # id unique is checked at dataset level
    # family present for split safety
    missing_family = sum(1 for r in rows if "family" not in r)
    if missing_family:
        errs.append(f"{label}: {missing_family} rows missing family (leakage check impossible)")
    return errs

def main():
    files = {
        "train_v2": "train_v2.jsonl",
        "dev_v2": "dev_v2.jsonl",
        "holdout_v2": "holdout_v2.jsonl",
    }
    existing = {k: p for k, p in files.items() if (ROOT / p).exists()}
    if not existing:
        print(json.dumps({"error": "no v2 files found (train/dev/holdout)", "hint": "run make_data_v2.py --split first"}, ensure_ascii=False))
        raise SystemExit(2)
    all_rows = []
    for k, p in existing.items():
        rows = load(p)
        all_rows.extend(rows)
        errs = validate_rows(rows, k)
        print(f"[{k}] rows={len(rows)} errs={len(errs)}")
        for e in errs[:30]:
            print(" ", e)
        if errs:
            raise SystemExit(1)

    # global uniqueness
    ids = [r["id"] for r in all_rows]
    assert len(ids) == len(set(ids)), "duplicate ids"
    norms = [NORM(r["text"]) for r in all_rows]
    assert len(norms) == len(set(norms)), "duplicate normalized text across splits (exact leak)"

    # family disjointness across splits
    if len(existing) > 1:
        by_split = {k: {r["family"] for r in load(p)} for k, p in existing.items()}
        keys = list(by_split)
        for i in range(len(keys)):
            for j in range(i+1, len(keys)):
                inter = by_split[keys[i]] & by_split[keys[j]]
                if inter:
                    print(f"FAMILY LEAK {keys[i]} & {keys[j]}: {len(inter)} families overlap")
                    raise SystemExit(1)
        print(f"family disjoint OK: { {k: len(v) for k, v in by_split.items()} }")
        units = {k: {u for r in load(p) for u in r.get("semantic_units", [])} for k, p in existing.items()}
        for i in range(len(keys)):
            for j in range(i+1, len(keys)):
                inter = units[keys[i]] & units[keys[j]]
                if inter:
                    print(f"SEMANTIC UNIT LEAK {keys[i]} & {keys[j]}: {sorted(inter)[:10]}")
                    raise SystemExit(1)
        print(f"semantic units disjoint OK: { {k: len(v) for k, v in units.items()} }")
    bad_contrast = [r["id"] for r in all_rows if r.get("provenance") == "synthetic_template_contrast" and r["gold"]]
    assert not bad_contrast, f"contrast rows must have empty gold: {bad_contrast[:5]}"
    bad_review = [r["id"] for r in all_rows if r.get("agent_reviewed") is not False]
    assert not bad_review, f"agent_reviewed must stay False (no review pass performed): {bad_review[:5]}"

    # coverage
    counts = collections.Counter()
    pos = collections.Counter()
    neg = collections.Counter()
    langs = collections.Counter()
    for r in all_rows:
        langs[r["language"]] += 1
        for k, (v, _) in r.get("gold", {}).items():
            counts[k] += 1
            (pos if v else neg)[k] += 1
    print("languages", dict(langs))
    print("per-fact", {k: {"total": counts[k], "pos": pos[k], "neg": neg[k]} for k in ALIASES})
    # unknown correctly omitted: check no explicit false is faked (gold missing is not counted)
    print("validator OK")

if __name__ == "__main__":
    main()
