"""Validate synthetic expansion and export a human review queue. No network/model calls."""
import collections
import csv
import hashlib
import json
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "multilingual_expansion_v1.jsonl"

def norm(text):
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())

def main():
    rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines()]
    ids, texts, families = set(), set(), collections.defaultdict(list)
    for r in rows:
        assert r["id"] not in ids, ("duplicate id", r["id"])
        ids.add(r["id"])
        n = norm(r["text"])
        assert n and n not in texts, ("duplicate/empty text", r["id"])
        texts.add(n)
        assert r["gold"] in {"concern", "no_concern", "ambiguous"}
        assert r["language"] in {"he", "en", "mixed"}
        assert r["review_status"] == "human_review_pending"
        assert r["split"] == "development_candidate"
        assert r["source"].startswith("assistant-authored synthetic")
        assert "\ufffd" not in r["text"]
        families[r["family"]].append(r)
    for family, group in families.items():
        assert len({r["split"] for r in group}) == 1, family
        labels = {r["gold"] for r in group}
        assert labels in ({"concern", "no_concern"}, {"ambiguous"}), family
        for label in labels:
            assert sorted(r["language"] for r in group if r["gold"] == label) == ["en", "he", "mixed"], family
    overlaps = {}
    for name in ("v1.jsonl", "v2_aug.jsonl", "eval_codex_v2.jsonl", "phase_a_multilingual_v1.jsonl"):
        path = ROOT / "data" / name
        existing = {norm(json.loads(line)["text"]) for line in path.read_text(encoding="utf-8").splitlines()}
        overlaps[name] = sorted(r["id"] for r in rows if norm(r["text"]) in existing)
    assert not any(overlaps.values()), overlaps
    out = ROOT / "results"
    out.mkdir(exist_ok=True)
    fields = ["id", "family", "language", "category", "text", "gold", "why",
              "reviewer_label", "reviewer", "review_notes"]
    with (out / "multilingual_expansion_v1_review.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    report = dict(rows=len(rows), families=len(families),
                  language_counts=dict(collections.Counter(r["language"] for r in rows)),
                  label_counts=dict(collections.Counter(r["gold"] for r in rows)),
                  category_counts=dict(sorted(collections.Counter(r["category"] for r in rows).items())),
                  exact_overlaps=overlaps, data_sha256=hashlib.sha256(DATA.read_bytes()).hexdigest(),
                  review_status="human_review_pending", split="development_candidate",
                  limitations=["Synthetic labels, not expert or human reviewed.",
                               "Translations and contrast pairs are correlated.",
                               "Exact normalization does not rule out semantic overlap.",
                               "No training, final holdout assignment, scoring or production changes."])
    (out / "multilingual_expansion_v1_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, indent=2))

if __name__ == "__main__":
    main()
