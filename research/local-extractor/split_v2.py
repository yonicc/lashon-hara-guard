"""Join the full v2 sources into train/dev/holdout files. Pure function of its inputs; rerun-safe.

Inputs (never the outputs):
  all_v2.jsonl                 make_data_v2.py, split already fixed per semantic unit
  diverse/natural_v2.jsonl     gen_natural_modal.py --contract-file contract_v2.json (optional)
Outputs: train_v2.jsonl, dev_v2.jsonl, holdout_v2.jsonl, manifest_v2.json
  py split_v2.py            write outputs
  py split_v2.py --check    recompute in memory; exit 1 unless every output is byte-identical on disk
Natural rows: family = hash of the English source message; he/en/mixed renderings share it and are
assigned together by sha256(family) (80/10/10), so a translation never crosses splits.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SOURCES = {"templates": "all_v2.jsonl", "natural": "diverse/natural_v2.jsonl"}
OUT = {"train": "train_v2.jsonl", "dev": "dev_v2.jsonl", "holdout": "holdout_v2.jsonl"}
SEED = 20261029
NAT_RULE = "sha256(family) % 100: <80 train, <90 dev, else holdout"
WRAPPERS = {"אני רק מצטט", "i am just quoting", "i am asking not stating", "אני שואל לא קובע",
            "it would be hypothetical", "זה היה היפותטי בלבד"}


def norm(t):
    return re.sub(r"\W+", " ", t.casefold()).strip()


def sentences(t):
    return {norm(s) for s in re.split(r'[.?!"]+', t) if len(norm(s).split()) >= 3} - {norm(w) for w in WRAPPERS}


def nat_split(family):
    b = int(hashlib.sha256(family.encode()).hexdigest(), 16) % 100
    return "train" if b < 80 else "dev" if b < 90 else "holdout"


def load(path):
    return [json.loads(l) for l in (ROOT / path).read_text(encoding="utf-8").splitlines() if l.strip()]


def build():
    rows = load(SOURCES["templates"])
    used = {"templates": SOURCES["templates"]}
    nat = []
    if (ROOT / SOURCES["natural"]).exists():
        used["natural"] = SOURCES["natural"]
        for r in load(SOURCES["natural"]):
            nat.append(dict(r, contract="contract_v2.json",
                     provenance="natural_llm_blind_verified", synthetic=True, agent_reviewed=False,
                     human_review_pending=True,
                     verification="Qwen2.5-32B blind re-extraction agreed exactly on EN and on DictaLM-HE (LLM, not human)"))
    rows += assign_natural(rows, nat)
    parts = {s: [r for r in rows if r["split"] == s] for s in OUT}
    assert sum(map(len, parts.values())) == len(rows), "row with unknown split"
    files = {s: "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in parts[s]).encode("utf-8") for s in OUT}
    return rows, parts, files, used


def assign_natural(templates, nat):
    """Natural families that share a normalized evidence span form one semantic source (union-find).
    A component touching template rows follows their (fixed) split; otherwise sha256 of its smallest family.
    A component that touches templates of two splits is dropped (counted in the manifest)."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x

    span_owner = {}
    for r in templates + nat:
        for _, ev in r["gold"].values():
            k = norm(ev)
            if k in span_owner:
                a, b = find(span_owner[k]), find(r["family"])
                if a != b: parent[max(a, b)] = min(a, b)
            else:
                span_owner[k] = r["family"]; find(r["family"])
    comp_tsplit = collections.defaultdict(set)
    for r in templates:
        comp_tsplit[find(r["family"])].add(r["split"])
    out, dropped = [], set()
    for r in nat:
        c = find(r["family"])
        ts = comp_tsplit.get(c, set())
        if len(ts) > 1:
            dropped.add(r["family"]); continue
        out.append(dict(r, split=next(iter(ts)) if ts else nat_split(c), evidence_component=c))
    DROPPED[:] = sorted(dropped)
    return out


DROPPED = []


def leakage(parts):
    fam = {s: {r["family"] for r in p} for s, p in parts.items()}
    units = {s: {u for r in p for u in r.get("semantic_units", [])} for s, p in parts.items()}
    texts = {s: {norm(r["text"]) for r in p} for s, p in parts.items()}
    spans = {s: {norm(v[1]) for r in p for v in r["gold"].values()} for s, p in parts.items()}
    sents = {s: set().union(*[sentences(r["text"]) for r in p]) for s, p in parts.items()}
    out = {}
    for a, b in (("train", "dev"), ("train", "holdout"), ("dev", "holdout")):
        out[f"{a}|{b}"] = {"family_overlap": len(fam[a] & fam[b]), "semantic_unit_overlap": len(units[a] & units[b]),
                           "normalized_text_overlap": len(texts[a] & texts[b]),
                           "evidence_span_overlap": len(spans[a] & spans[b]),
                           "shared_sentences_ge3_words": sorted(sents[a] & sents[b])[:20],
                           "shared_sentence_count": len(sents[a] & sents[b])}
    return out


def coverage(p):
    c = collections.Counter()
    for r in p:
        for k, (v, _) in r["gold"].items():
            c[f"{k}:{str(v).lower()}"] += 1
    return dict(sorted(c.items()))


def manifest(rows, parts, files, used):
    leak = leakage(parts)
    m = {"version": "v2.1", "seed": SEED, "contract": "contract_v2.json",
         "contract_sha256": hashlib.sha256((ROOT / "contract_v2.json").read_bytes()).hexdigest(),
         "sources": {k: {"path": v, "sha256": hashlib.sha256((ROOT / v).read_bytes()).hexdigest(),
                         "rows": sum(1 for _ in (ROOT / v).read_text(encoding="utf-8").splitlines())} for k, v in used.items()},
         "generators": {"templates": "make_data_v2.py --seed 20261029",
                        "natural": "gen_natural_modal.py --out diverse/natural_v2.jsonl --n 6000 --seed 20261030 --contract-file contract_v2.json"},
         "split_rule": {"templates": "per semantic unit: fact variants v0,v1->train, v2->dev, v3->holdout; backgrounds split-scoped",
                        "natural": "families sharing a normalized evidence span are one component; a component touching "
                                   "template rows follows their split, else " + NAT_RULE + " of its smallest family",
                        "natural_families_dropped_cross_split_templates": DROPPED},
         "splits": {s: {"path": OUT[s], "sha256": hashlib.sha256(files[s]).hexdigest(), "rows": len(parts[s]),
                        "families": len({r["family"] for r in parts[s]}),
                        "by_provenance": dict(collections.Counter(r["provenance"] for r in parts[s])),
                        "by_language": dict(collections.Counter(r["language"] for r in parts[s])),
                        "empty_gold_rows": sum(not r["gold"] for r in parts[s]),
                        "coverage": coverage(parts[s])} for s in OUT},
         "leakage": leak,
         "review_status": {"synthetic": True, "agent_reviewed": False, "human_review_pending": True,
                           "note": "No human has reviewed any row. Natural rows passed an automatic LLM blind-agreement filter only."},
         "evaluation_status": "dev and holdout are DEVELOPMENT sets: produced by the same author/pipeline that tuned the data; "
                              "not an independent benchmark."}
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    rows, parts, files, used = build()
    m = manifest(rows, parts, files, used)
    mbytes = (json.dumps(m, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    bad = [k for k, v in m["leakage"].items() if v["family_overlap"] or v["semantic_unit_overlap"]
           or v["normalized_text_overlap"] or v["evidence_span_overlap"]]
    if a.check:
        diff = [OUT[s] for s in OUT if (ROOT / OUT[s]).read_bytes() != files[s]]
        if (ROOT / "manifest_v2.json").read_bytes() != mbytes:
            diff.append("manifest_v2.json")
        print(json.dumps({"rerun_identical": not diff, "differs": diff, "leak_pairs": bad,
                          "rows": {s: len(parts[s]) for s in OUT}}))
        raise SystemExit(1 if diff or bad else 0)
    if bad:
        raise SystemExit(f"LEAK {bad}")
    for s in OUT:
        (ROOT / OUT[s]).write_bytes(files[s])
    (ROOT / "manifest_v2.json").write_bytes(mbytes)
    print(json.dumps({"rows": {s: len(parts[s]) for s in OUT}, "sha256": {s: m["splits"][s]["sha256"] for s in OUT}}))


if __name__ == "__main__":
    main()
