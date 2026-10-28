"""Build classifier/data/router_holdout_v1.jsonl from holdout_v1.src.txt (no network).

    py -I classifier/router/build_holdout.py
"""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
CODE = {"R": "need_recent_history", "P": "need_participants", "L": "need_relationship",
        "E": "need_event", "U": "need_purpose", "K": "need_prior_knowledge"}


def main():
    src = (ROOT / "holdout_v1.src.txt").read_text(encoding="utf-8")
    rows, seen = [], set()
    for line in src.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        fam, lang, labels, concern, text = line.split("|", 4)
        assert lang in ("he", "en", "mixed"), line
        assert concern in ("0", "1"), line
        assert labels == "-" or all(c in CODE for c in labels), line
        assert text not in seen, "duplicate: " + text
        seen.add(text)
        rows.append({"id": f"ho1-{fam}-{lang}-{hashlib.sha256(text.encode()).hexdigest()[:6]}", "text": text,
                     "language": lang, "labels": [] if labels == "-" else sorted(CODE[c] for c in labels),
                     "concern": concern == "1", "family": "ho1-" + fam, "split": "holdout",
                     "source": "synthetic:agent-authored (Claude; independent of the Qwen generator)",
                     "synthetic": True, "review_status": "agent_reviewed;human_review_pending"})
    out = ROOT.parent / "data" / "router_holdout_v1.jsonl"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    per = {l: sum(r["language"] == l for r in rows) for l in ("he", "en", "mixed")}
    lab = {c: sum(c in r["labels"] for r in rows) for c in CODE.values()}
    print(json.dumps({"rows": len(rows), "families": len({r["family"] for r in rows}), "per_lang": per,
                      "none": sum(not r["labels"] for r in rows), "per_label": lab,
                      "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}, indent=1))


if __name__ == "__main__":
    main()
