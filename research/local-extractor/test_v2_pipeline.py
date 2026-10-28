"""Offline dry-run of the e10 v2 path (no GPU, no Modal call, no training).

* split_v2.py --check passes (rerun keeps counts and hashes);
* make_data_v2.py --check: template source is deterministic and equals all_v2.jsonl;
* train_v2_modal.eval_rows converts gold -> expect; score.summary under contract_v2 gives a perfect
  score for gold-echo predictions and counts an invented false as unknown_as_false.
    py research/local-extractor/test_v2_pipeline.py
"""
import json, pathlib, subprocess, sys
ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))


def run(*a):
    r = subprocess.run([sys.executable, *a], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, (a, r.stdout, r.stderr)
    return r.stdout


def main():
    print(run("make_data_v2.py", "--check").strip())
    print(run("split_v2.py", "--check").strip())
    import score
    score.IDS = {a: b for a, b, _ in json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))["facts"]}
    from train_v2_modal import eval_rows  # the exact conversion the training wrapper uses
    rows = eval_rows("dev_v2.jsonl", "v2dev") + eval_rows("holdout_v2.jsonl", "v2holdout")
    gold = {json.loads(s)["id"]: json.loads(s)["gold"] for n in ("dev_v2.jsonl", "holdout_v2.jsonl")
            for s in (ROOT / n).read_text(encoding="utf-8").splitlines()}
    perfect = [{"id": r["id"], "raw": json.dumps(gold[r["id"]], ensure_ascii=False)} for r in rows]
    s = score.summary(rows, perfect)["groups"]["all"]
    assert s["fp"] == 0 and s["fn"] == 0 and s["exact"] == s["rows"], s
    bad = [dict(p) for p in perfect]
    r0 = next(r for r in rows if not r["expect"])
    bad[[r["id"] for r in rows].index(r0["id"])]["raw"] = json.dumps({"verified": [False, r0["text"][:10]]}, ensure_ascii=False)
    s2 = score.summary(rows, bad)["groups"]["all"]
    assert s2["unknown_as_false"] == 1 and s2["fp"] == 1, s2
    from probe_modal import instruction
    sysm = instruction(json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8")))
    longest = max(len(json.loads(s)["text"]) + len(json.dumps(json.loads(s)["gold"], ensure_ascii=False))
                  for s in (ROOT / "train_v2.jsonl").read_text(encoding="utf-8").splitlines())
    print(json.dumps({"score_perfect": "ok", "unknown_as_false_detected": "ok", "eval_rows": len(rows),
                      "system_prompt_chars": len(sysm), "longest_train_text_plus_answer_chars": longest}))


if __name__ == "__main__":
    main()
