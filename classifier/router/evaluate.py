"""Score local-router candidates (docs/35). One home for router metrics.

    py -I classifier/router/evaluate.py --data classifier/data/router_v1_synth.jsonl \
        --holdout classifier/data/router_holdout_v1.jsonl --probs classifier/results/router/*.probs.json \
        --out classifier/results/router/summary.json

Thresholds are calibrated per label on DEV only (highest threshold with dev recall >= --target-recall),
then frozen and applied to the holdout. A missed context need is the costly error, so besides per-label
precision/recall we report:
  missed_label_rate  - share of (row, needed label) pairs the router did not request;
  missed_all_rate    - rows that needed context where the router requested NOTHING (worst case);
  needless_rate      - rows that need nothing but got an expansion (cost only, never a hidden message);
  getters_mean       - distinct getters per row incl. the derived get_thread (labels.json).
Baselines: never (no expansion), always (every getter), keywords (hand regex, see caveat in docs/35).
"""
import argparse
import glob
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / "labels.json").read_text(encoding="utf-8"))
FINE = [l["id"] for l in SCHEMA["learned"]]           # data annotations (6)
HEADS = SCHEMA["heads"]                               # what the router decides (3)
LABELS = [h["id"] for h in HEADS]
GETTER = {h["id"]: h["getter"] for h in HEADS}
THREAD_FROM = {"mem_recent", "mem_search"}            # stored lookups need a thread identity
LANGS = ("he", "en", "mixed")

# Hand keyword baseline. CAVEAT: written after the holdout was authored -> optimistic on the holdout.
KW = {
    "need_recent_history": r"שוב|כמו שאמרתי|למעלה|עכשיו\?|בדיוק|ואז|זה הוא|את זה|גם אני|again|like i said|above|exactly|same|then she|not what i meant|my message|\bnow\?",
    "need_participants": r"בינינו|אל תעביר|אל תגיד|אל תספר|בקבוצה|הקבוצה|תעביר|between us|forward|don't tell|don't mention|group|this chat|pass it on",
    "need_relationship": r"הבוס|מנהל|גיס|מורה|מעסיק|שותף|לעבודה|משכיר|דירה|manager|boss|in-law|teacher|employer|partner|hir(e|ing)|lease|landlord",
    "need_event": r"אתמול|באסיפה|בשיעור|בטיול|בחתונה|במשמרת|באירוע|מה שקרה|הסיפור|yesterday|meeting|practice|trip|wedding|shift|event|what happened|the story",
    "need_purpose": r"להזהיר|כדאי שתדע|עצה|לעזור|עוזרים|לפנות|פונים|מתלבט|תלונות|warn|you should know|advice|help|who do i|torn about|complaints|tips",
    "need_prior_knowledge": r"שמעתי|כולם יודעים|כולם כבר|אומרים|שמועה|בעיתון|דיברנו|בפומבי|מסתבר|i heard|everyone knows|already knows|people are saying|rumou?r|news|discussed|publicly|turns out",
}


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def heads_of(fine_labels):
    """6 fine annotations -> the 3 router heads (one home for the mapping)."""
    return [h["id"] for h in HEADS if any(f in fine_labels for f in h["from"])]


def to_heads(p):
    """Probabilities over the 6 fine labels (round 1, teachers) -> 3 heads by max; 3-dim passes through."""
    if len(p) == len(LABELS):
        return p
    return [max(p[FINE.index(f)] for f in h["from"]) for h in HEADS]


def truth(row):
    hs = heads_of(row["labels"])
    return [int(l in hs) for l in LABELS]


def calibrate(probs, ys, target):
    th = {}
    for j, lab in enumerate(LABELS):
        pos = sorted(p[j] for p, y in zip(probs, ys) if y[j])
        if not pos:
            th[lab] = 0.5; continue
        # highest t such that recall >= target: t = the k-th smallest positive score
        k = int((1 - target) * len(pos))
        th[lab] = round(max(0.01, min(0.9, pos[k] - 1e-6)), 4)
    return th


def getters(pred):
    g = {GETTER[l] for l, v in zip(LABELS, pred) if v}
    if any(v for l, v in zip(LABELS, pred) if l in THREAD_FROM):
        g.add("get_thread")
    return g


def score(rows, preds):
    def prf(tp, fp, fn):
        return {"precision": round(tp / (tp + fp), 3) if tp + fp else None,
                "recall": round(tp / (tp + fn), 3) if tp + fn else None, "support": tp + fn}

    out = {}
    for scope in ("all",) + LANGS:
        idx = [i for i, r in enumerate(rows) if scope == "all" or r["language"] == scope]
        if not idx:
            continue
        per = {}
        for j, lab in enumerate(LABELS):
            tp = sum(preds[i][j] and truth(rows[i])[j] for i in idx)
            fp = sum(preds[i][j] and not truth(rows[i])[j] for i in idx)
            fn = sum(not preds[i][j] and truth(rows[i])[j] for i in idx)
            per[lab] = prf(tp, fp, fn)
        need = [i for i in idx if any(truth(rows[i]))]
        none = [i for i in idx if not any(truth(rows[i]))]
        pairs = [(i, j) for i in need for j in range(len(LABELS)) if truth(rows[i])[j]]
        conc = [i for i in need if rows[i].get("concern")]
        out[scope] = {
            "rows": len(idx), "per_label": per,
            "missed_label_rate": round(sum(not preds[i][j] for i, j in pairs) / len(pairs), 3) if pairs else None,
            "missed_all_rate": round(sum(not any(preds[i]) for i in need) / len(need), 3) if need else None,
            "missed_all_concern": round(sum(not any(preds[i]) for i in conc) / len(conc), 3) if conc else None,
            "needless_rate": round(sum(any(preds[i]) for i in none) / len(none), 3) if none else None,
            "getters_mean": round(sum(len(getters(preds[i])) for i in idx) / len(idx), 2),
        }
    return out


def baselines(rows):
    return {
        "never": [[0] * len(LABELS) for _ in rows],
        "always": [[1] * len(LABELS) for _ in rows],
        "keywords": [to_heads([int(bool(re.search(KW[l], r["text"], re.I))) for l in FINE]) for r in rows],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--probs", nargs="*", default=[])
    ap.add_argument("--target-recall", type=float, default=0.9)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    data = load(a.data)
    dev = [r for r in data if r["split"] == "dev"]
    hold = load(a.holdout)
    res = {"labels": LABELS, "target_recall": a.target_recall, "dev_rows": len(dev), "holdout_rows": len(hold),
           "candidates": {}}
    for name, p in baselines(dev).items():
        res["candidates"][name] = {"dev": score(dev, p), "holdout": score(hold, baselines(hold)[name])}
    files = [f for pat in a.probs for f in glob.glob(pat)]
    for f in sorted(files):
        pr = json.loads(open(f, encoding="utf-8").read())
        dmap = {i: to_heads(p) for i, p in zip(pr["dev"]["ids"], pr["dev"]["probs"])}
        hmap = {i: to_heads(p) for i, p in zip(pr["holdout"]["ids"], pr["holdout"]["probs"])}
        if any(r["id"] not in dmap for r in dev):
            print(f"skip {pr['run']}: its dev split is a different data version"); continue
        dprobs = [dmap[r["id"]] for r in dev]
        th = calibrate(dprobs, [truth(r) for r in dev], a.target_recall)
        binar = lambda ps: [[int(p[j] >= th[l]) for j, l in enumerate(LABELS)] for p in ps]  # noqa: E731
        res["candidates"][pr["run"]] = {
            "thresholds": th, "meta": {k: v for k, v in pr.items() if k not in ("dev", "holdout")},
            "dev": score(dev, binar(dprobs)), "holdout": score(hold, binar([hmap[r["id"]] for r in hold]))}
    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    hdr = f"{'candidate':28} {'split':8} {'lang':6} missLbl missAll missAllC needless getters"
    print(hdr)
    for name, c in res["candidates"].items():
        for split in ("dev", "holdout"):
            for lang in ("all",) + LANGS:
                s = c[split].get(lang)
                if s:
                    print(f"{name:28} {split:8} {lang:6} {s['missed_label_rate']!s:7} {s['missed_all_rate']!s:7} "
                          f"{s['missed_all_concern']!s:8} {s['needless_rate']!s:8} {s['getters_mean']}")


if __name__ == "__main__":
    main()
