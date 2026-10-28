"""Deterministic synthetic router training scenarios, expanded round.

The router never rules and never returns 'permitted'. A label only says which
LOCAL context to collect before the normal /check. Heads (owner scope):
  none       -> the message alone is enough (docs/32 group A)
  mem_recent -> needs the latest messages of THIS conversation (group B)
  mem_search -> needs older stored context / prior knowledge (group C prior/event)
  ask_user   -> needs relationship/purpose that only the user can confirm (group C)
Group D (external/expert evidence) is NOT a fetch head: it stays unknown and
must surface a structured rabbi-referral question, not a local retrieval.

Synthetic, agent-authored, agent_reviewed, human_review_pending.
"""
import hashlib
import json
import pathlib
import random

ROOT = pathlib.Path(__file__).parent

# lang -> head -> list of (message, evidence_planted_or_none)
# ask_user rows also carry a candidate clarifying question (he) for the user.
SCEN = {
"he": {
  "none": [
    "הוא פשוט לא מקצועי ואין לו מושג מה הוא עושה",
    "היא תמיד מגיעה מאוחר ומשאירה את כולם לחכות",
    "המורה הזה לא יודע ללמד בכלל",
    "הספק הזה גונב, אל תזמינו ממנו",
    "הוא אדם לא הגון ואי אפשר לסמוך עליו",
    "העבודה שלה גרועה ולא שווה כלום",
  ],
  "mem_recent": [
    "כמו שאמרתי קודם, זה שוב קרה",
    "הוא עשה את זה שוב, בדיוק כמו אתמול",
    "אז מה דעתך עליה עכשיו אחרי מה שראית?",
    "בדיוק כמו שסיפרתי לך, הוא שוב איחר",
    "זו כבר הפעם השלישית שהיא עושה את זה",
    "ראית? שוב אותו דבר כמו שדיברנו",
  ],
  "mem_search": [
    "כמו שכבר דיברנו לפני כמה שבועות, ההתנהלות של הוועד בעייתית",
    "זה בדיוק מה שפורסם באותו אירוע בחודש שעבר",
    "כבר כתבנו על זה בקבוצה לפני זמן מה",
    "זה ממשיך את הסיפור ההוא מהנסיעה",
    "כמו שהוזכר בדיון הקודם עליו, הוא שוב התנהג ככה",
    "זה חוזר על מה שהוא אמר לכולם אז",
  ],
  "ask_user": [
    "כדאי שתדע עליו משהו לפני שאתם נכנסים לשותפות",
    "תיזהר ממנו, אני מכיר אותו מהעבר",
    "אני חושב שאתה צריך לדעת איך הוא מתנהג עם עובדים",
    "יש משהו שכדאי לך לשמוע לפני שאתה מסכים להצעה שלה",
    "אני מעדכן אותך כדי שתוכל להתייחס לזה בישיבה",
    "אולי כדאי שתבדוק איתו לפני שאתה סומך עליו עם הפרויקט",
  ],
},
"en": {
  "none": [
    "He simply is not professional and has no idea what he is doing",
    "She always arrives late and keeps everyone waiting",
    "This teacher cannot teach at all",
    "This supplier is a thief, do not order from him",
    "He is a dishonest person and cannot be trusted",
    "Her work is terrible and worth nothing",
  ],
  "mem_recent": [
    "As I said before, it happened again",
    "He did it again, just like yesterday",
    "So what do you think of her now after what you saw?",
    "Just like I told you, he was late again",
    "This is already the third time she does this",
    "See? Same thing again like we discussed",
  ],
  "mem_search": [
    "As we discussed a few weeks ago, the committee's conduct is problematic",
    "This is exactly what was published at that event last month",
    "We already wrote about this in the group a while ago",
    "This continues that story from the trip",
    "As mentioned in the earlier discussion about him, he acted like this again",
    "This repeats what he told everyone back then",
  ],
  "ask_user": [
    "You should know something about him before you go into partnership",
    "Be careful with him, I know him from before",
    "I think you need to know how he treats employees",
    "There is something you should hear before you accept her offer",
    "I am updating you so you can address it at the meeting",
    "Maybe you should check with him before you trust him with the project",
  ],
},
}

# Clarifying questions the router may propose for ask_user (he). Group D adds a
# rabbi-referral flag: the local pipeline cannot resolve it, so it asks the user
# and, where the fact needs an expert ruling, prepares a structured referral.
ASK_QUESTIONS = {
  "relationship": "מה הקשר בינך לבין האדם שעליו מדובר, והאם יש לך צורך אמיתי לדעת את זה?",
  "purpose": "מה המטרה של הדיווח הזה — האם יש כאן תועלת ממשית, כמו הגנה או מניעת נזק?",
}
RABBI_REFERRAL_NOTE = (
  "שאלה זו תלויה בראיה חיצונית או בהכרעה הלכתית מוסמכת; "
  "המערכת לא תכריע, אלא תרכז את הפרטים ותציע להפנות לרב."
)

def save(name, rows):
    (ROOT / name).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument("--emit-splits", action="store_true")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    rows = []
    seen = set()
    # Expand each head with mixed variants + paraphrases
    # Keep original SCEN as base; add mixed language by code-mixing some
    for lang, heads in SCEN.items():
        for head, msgs in heads.items():
            for i, msg in enumerate(msgs):
                if msg in seen:
                    continue
                seen.add(msg)
                family = f"rt-{lang}-{head}-{i}"
                row = dict(
                    id=f"router2-{lang}-{head}-{i}",
                    family=family,
                    language=lang,
                    message=msg,
                    need=head,
                    heads={h: (h == head) for h in ("mem_recent", "mem_search", "ask_user")},
                    provenance="synthetic_template_v2",
                    synthetic=True, agent_reviewed=False, human_review_pending=True,
                    split="train",
                )
                if head == "ask_user":
                    row["propose_question"] = ASK_QUESTIONS["purpose" if rng.random() < 0.5 else "relationship"]
                    row["group_d_referral"] = RABBI_REFERRAL_NOTE
                rows.append(row)
    # Synthesize mixed + combo heads (router can need multiple heads simultaneously)
    # e.g., needs both mem_recent and ask_user when recent context + purpose
    mixed_add = []
    # mixed language variants: take he+en pair, code-mix
    for lang in ("he","en"):
        for head in ("none","mem_recent","mem_search","ask_user"):
            msgs = SCEN[lang][head]
            for i, msg in enumerate(msgs[:3]):
                # simple mixed by prefixing with opposite language cue
                if lang == "he":
                    mixed_msg = msg + " - I need to know for next step"
                else:
                    mixed_msg = msg + " - צריך להחליט מה לעשות"
                if mixed_msg in seen:
                    continue
                seen.add(mixed_msg)
                family = f"rt-mixed-{head}-{i}"
                row = dict(
                    id=f"router2-mixed-{head}-{i}",
                    family=family,
                    language="mixed",
                    message=mixed_msg,
                    need=head,
                    heads={h: (h == head) for h in ("mem_recent", "mem_search", "ask_user")},
                    provenance="synthetic_template_v2_mixed",
                    synthetic=True, agent_reviewed=False, human_review_pending=True,
                    split="train",
                )
                if head == "ask_user":
                    row["propose_question"] = ASK_QUESTIONS["relationship"]
                    row["group_d_referral"] = RABBI_REFERRAL_NOTE
                mixed_add.append(row)
    rows.extend(mixed_add)
    # combo rows: need two heads simultaneously (mem_recent+ask_user etc)
    combos = [
        ("mem_recent","ask_user", "כמו שאמרתי קודם, זה שוב קרה - כדאי שתדע לפני השותפות", "As I said before, it happened again — you should know before partnership"),
    ]
    for i, (h1,h2,he_msg,en_msg) in enumerate(combos):
        for lang, msg in (("he", he_msg), ("en", en_msg)):
            if msg in seen: continue
            seen.add(msg)
            family = f"rt-{lang}-combo-{h1}_{h2}-{i}"
            heads_dict = {h: (h in (h1,h2)) for h in ("mem_recent","mem_search","ask_user")}
            row = dict(id=f"router2-{lang}-combo-{h1}_{h2}-{i}", family=family, language=lang, message=msg, need=f"{h1}+{h2}", heads=heads_dict, provenance="synthetic_template_v2_combo", synthetic=True, agent_reviewed=False, human_review_pending=True, split="train", propose_question=ASK_QUESTIONS["purpose"], group_d_referral=RABBI_REFERRAL_NOTE)
            rows.append(row)
    rng.shuffle(rows)
    save("router_train_v2.jsonl", rows)
    print(json.dumps({"router_train_v2": len(rows),
      "sha256": hashlib.sha256((ROOT / "router_train_v2.jsonl").read_bytes()).hexdigest(), "seed": args.seed}))
    if args.emit_splits:
        from split_router_v2 import main as split_main
        split_main(seed=args.seed)

if __name__ == "__main__":
    main()
