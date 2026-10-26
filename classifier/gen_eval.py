"""Generate an INDEPENDENT evaluation set for the gate classifier.

Fairness is the whole point, so everything differs from gen_dataset.py:
another vendor/model (Codex gpt-6.1-sol by default), English instructions,
no category list, mixed batches where the model invents the situation AND
labels each message itself, and an explicit "ambiguous" label for messages
whose meaning depends on missing context. Rows from this file are never used
for training.

    py -I classifier/gen_eval.py --out classifier/data/eval_codex_v1.jsonl
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_dataset import call, json_array, norm  # noqa: E402  (one transport, one parser)

SCENES = [
    "a WhatsApp group of parents from a 3rd-grade class planning an end-of-year party",
    "coworkers in a small software startup complaining about a late release",
    "an extended family group chat before a holiday dinner",
    "neighbours in an apartment building discussing a noisy renovation",
    "friends from a yeshiva or university study group before an exam",
    "a synagogue committee organising volunteers",
    "two close friends texting late at night about their day",
    "a youth movement counsellors' group after a weekend trip",
    "a sports team group after losing a match",
    "siblings coordinating care for an elderly parent",
    "a book club discussing last week's meeting",
    "a wedding planning group with the couple's friends",
    "colleagues at a hospital ward after a hard shift",
    "a group of reservists after a long stint",
    "a buy-and-sell group of a small town",
    "a married couple texting about their in-laws' visit",
    "teachers' room group chat at a high school",
    "a cycling club planning a weekend ride",
    "a group of new immigrants helping each other with bureaucracy",
    "cousins planning a surprise party for their grandmother",
]

SYSTEM = (
    "You create evaluation data for a Hebrew tool that gently warns a user before they send a message "
    "that speaks negatively about other people (Jewish concept: lashon hara / rechilut). "
    "Write realistic, synthetic, everyday Israeli Hebrew chat messages. Invent all names and events.\n"
    "Label each message:\n"
    "- \"concern\": a reasonable reader could take it as disparaging, mocking, shaming or spreading negative "
    "information about an identifiable person or group, including sarcasm, backhanded praise, hints that "
    "identify someone, and telling the recipient what someone else said or did against them.\n"
    "- \"no_concern\": nothing negative about an identifiable other person (logistics, sincere praise, thanks, "
    "self-criticism, criticism of an idea/product/film without targeting a person, feelings).\n"
    "- \"ambiguous\": the meaning really depends on context the reader does not have.\n"
    "Return JSON only: an array of objects {\"text\": string, \"label\": string, \"why\": short English reason}."
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-call", type=int, default=15)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--agent-kind", default="codex")
    ap.add_argument("--model", default="gpt-6.1-sol")
    ap.add_argument("--account", default="VIYY")
    ap.add_argument("--seed", type=int, default=101)
    a = ap.parse_args()
    base, token = os.environ["LHG_BRAIN_BASE_URL"], os.environ["LHG_BRAIN_TOKEN"]
    rng = random.Random(a.seed)

    def one(scene: str):
        mix = rng.choice(["roughly half concern", "mostly harmless with a few concerns",
                          "mostly concern with some harmless", "many subtle or borderline cases"])
        user = (f"Setting: {scene}.\nWrite {a.per_call} different messages people in this setting might send, "
                f"{mix}. Vary length (2 to 40 words), tone, slang and emoji. Include subtle cases, "
                "not only obvious insults. JSON only.")
        # brain-mcp's v1 codex branch drops system_prompt (2026-10-26), so the
        # instructions must travel inside the user turn for codex.
        if a.agent_kind == "codex":
            user, system = SYSTEM + "\n\n" + user, ""
        else:
            system = SYSTEM
        reply = call(base, token, a.account, a.model, "", system, user, timeout=280.0, agent_kind=a.agent_kind)
        out = []
        for o in json_array(reply):
            if isinstance(o, dict) and isinstance(o.get("text"), str) and o.get("label") in ("concern", "no_concern", "ambiguous"):
                out.append({"text": o["text"].strip(), "gold": o["label"], "why": str(o.get("why", ""))[:200],
                            "scene": scene, "source": f"{a.agent_kind}:{a.model}"})
        return out

    rows, seen, failed = [], set(), 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for fut in cf.as_completed([ex.submit(one, s) for s in SCENES]):
            try:
                for r in fut.result():
                    k = norm(r["text"])
                    if k and k not in seen:
                        seen.add(k); rows.append(r)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("batch failed:", str(e)[:200], flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    from collections import Counter
    print(f"wrote {len(rows)} rows {dict(Counter(r['gold'] for r in rows))} in {time.time() - t0:.0f}s, "
          f"failed batches {failed} -> {a.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
