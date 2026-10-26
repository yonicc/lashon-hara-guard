"""Reference scores from the deployed Modal gate, to check the Oracle copy matches.

    py classifier/oracle/modal_ref.py classifier/data/eval_codex_v2.jsonl out.jsonl

Writes one {"i", "p"} line per input row (fp32 model, the same one the endpoint serves).
"""
import json
import sys

import modal


def main(data: str, out: str) -> None:
    texts = [json.loads(line)["text"].strip() for line in open(data, encoding="utf-8")]
    gate = modal.Cls.from_name("lhg-gate", "Gate")()
    probs: list[float] = []
    for i in range(0, len(texts), 32):
        probs += gate.score.remote(texts[i:i + 32])
    with open(out, "w", encoding="utf-8") as f:
        for i, p in enumerate(probs):
            f.write(json.dumps({"i": i, "p": p}) + "\n")
    print(f"{len(probs)} scores -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
