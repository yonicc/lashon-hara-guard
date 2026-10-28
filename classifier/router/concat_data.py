"""Join router data files into ONE training file for train_router_modal.py (--data takes a single path).

    py -I classifier/router/concat_data.py --out classifier/data/router_v3_train.jsonl \
        classifier/data/router_v2_synth.jsonl classifier/data/router_v3_aug_relabeled.jsonl

Refuses a family that appears in two inputs (a family never straddles splits), a duplicate id or
normalized text, and any overlap with the holdout. Output is byte-deterministic (inputs in given order, LF).
"""
import argparse, hashlib, json, re


def norm(t):
    return re.sub(r"\W+", " ", t.lower()).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--holdout", default="classifier/data/router_holdout_v1.jsonl")
    a = ap.parse_args()
    fam_src, ids, texts, rows = {}, set(), set(), []
    for path in a.inputs:
        for line in open(path, encoding="utf-8"):
            if not line.strip():
                continue
            r = json.loads(line)
            if fam_src.setdefault(r["family"], path) != path:
                raise SystemExit(f"family {r['family']} in {fam_src[r['family']]} and {path}")
            if r["id"] in ids or norm(r["text"]) in texts:
                raise SystemExit(f"duplicate id/text {r['id']}")
            ids.add(r["id"]); texts.add(norm(r["text"])); rows.append(line.rstrip("\r\n"))
    hold = {norm(json.loads(l)["text"]) for l in open(a.holdout, encoding="utf-8") if l.strip()}
    if hold & texts:
        raise SystemExit(f"{len(hold & texts)} holdout texts in training data")
    data = ("\n".join(rows) + "\n").encode("utf-8")
    open(a.out, "wb").write(data)
    print(json.dumps({"out": a.out, "rows": len(rows), "families": len(fam_src), "sha256": hashlib.sha256(data).hexdigest()}))


if __name__ == "__main__":
    main()
