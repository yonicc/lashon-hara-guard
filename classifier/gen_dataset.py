"""Generate a SYNTHETIC, labelled Hebrew dataset for the fast gate classifier.

Two passes through the Brain (POST {base}/api/v1/chat/completions,
agent_kind=meta_api):

  1. generate: per category, ask muse-spark for short WhatsApp-style messages
     that clearly belong to it (label comes from the category).
  2. verify:   a second, independent call labels each message blind
     (concern / no_concern / unsure). Rows where it disagrees with the
     category label are kept but marked ``agree=false`` so training can drop
     or down-weight them.

Synthetic only (AGENTS.md): every name and event is invented by the model.
Env: LHG_BRAIN_BASE_URL (https://br.ysho.uk/dash), LHG_BRAIN_TOKEN, LHG_BRAIN_ACCOUNT.

    py -I classifier/gen_dataset.py --out classifier/data/v1.jsonl
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

# (id, label 1=concern 0=no_concern, mechanism, Hebrew description for the prompt)
CATEGORIES: list[tuple[str, int, str, str]] = [
    ("c_direct", 1, "direct", "גנאי או ביקורת משפילה ישירה על אדם שלישי מזוהה (בשם או בתפקיד), שאינו הנמען"),
    ("c_irony", 1, "irony", "אירוניה או סרקזם על אדם שלישי מזוהה, בלי מילת גנאי מפורשת"),
    ("c_mock_praise", 1, "praise", "שבח מלגלג: מילים חיוביות שמשמעותן בפועל לעג לאדם שלישי"),
    ("c_hint", 1, "hint", "רמז שמזהה אדם בלי לנקוב בשמו (\"ההוא מהקומה השלישית\", \"מי שאחראי על...\") ואומר עליו דבר שלילי"),
    ("c_gossip", 1, "direct", "רכילות: מספר לנמען מה אדם אחר אמר או עשה נגדו"),
    ("c_negative_fact", 1, "direct", "מסירת מידע שלילי או מביך על אדם שלישי (חובות, כישלון, בעיות בבית, ציונים), גם אם הוא נכון"),
    ("c_omission", 1, "omission", "השמטה מכוונת שמרמזת על גנאי (\"על הבישול שלה אני לא אגיד כלום\")"),
    ("c_rhetorical", 1, "mockery", "שאלה רטורית או לעג שמבזים אדם שלישי (\"מישהו באמת מופתע שהוא שוב איחר?\")"),
    ("c_habit", 1, "mockery", "הכללה שלילית על התנהגות קבועה של אדם (\"כרגיל אצלו\", \"היא תמיד...\")"),
    ("c_group", 1, "direct", "גנאי על קבוצה מזוהה של אנשים (צוות, משפחה, שכנים מבניין מסוים)"),
    ("n_logistics", 0, "", "הודעה לוגיסטית ניטרלית: זמנים, מקומות, תיאומים"),
    ("n_sincere_praise", 0, "", "שבח כן וחם על אדם שלישי, בלי שום עוקץ"),
    ("n_thanks", 0, "", "תודה והכרת טובה לאדם או לקבוצה"),
    ("n_self", 0, "", "ביקורת עצמית או תסכול של הכותב מעצמו"),
    ("n_idea_critique", 0, "", "ביקורת עניינית על רעיון, מוצר, סרט, מסעדה או תוכנית, בלי לפגוע באדם"),
    ("n_feelings", 0, "", "שיתוף רגשות בגוף ראשון (עייפות, שמחה, דאגה) בלי לדבר על אדם אחר לרעה"),
    ("n_good_news", 0, "", "בשורה טובה או מזל טוב על אדם שלישי"),
    ("n_neutral_fact", 0, "", "עובדה ניטרלית על אדם שלישי (עבר דירה, התחיל עבודה, נסע)"),
    ("n_humor", 0, "", "הומור קליל שלא צוחק על אדם מסוים"),
    ("n_request", 0, "", "בקשה או שאלה מנומסת לנמען"),
    # v2 (2026-10-26): the independent Codex eval showed v1 missing quiet
    # insinuations and over-flagging sincere "כל הכבוד ל..." praise.
    ("c_insinuation", 1, "hint", "רמיזה שמשאירה את הפרט השלילי לא אמור (\"אתם יודעים למה\", \"זוכרים מה היה בפעם הקודמת\", \"בפרטי אם צריך\")"),
    ("c_logistic_jab", 1, "hint", "עקיצה שמוסתרת בתוך הודעה לוגיסטית ומרמזת על הרגל רע של אדם מזוהה (\"נגיד לו שעה מוקדמת יותר\", \"שאדע כמה מרווח להשאיר\")"),
    ("c_avoid_person", 1, "hint", "העדפה לא לעבוד או להיות עם אדם מזוהה, בניסוח שמרמז על פגם בו"),
    ("c_conditional_praise", 1, "praise", "שבח מותנה שחושף פגם (\"מקסימה כשהמנהלת בסביבה\", \"מצוין כשהוא כבר מגיע\")"),
    ("c_private_exposure", 1, "direct", "חשיפה בקבוצה של דבר שאדם אמר או עשה בפרטי, כדי להציג אותו באור שלילי"),
    ("n_hard_praise", 0, "", "שבח כן לאדם בשמו במבנה שדומה לעקיצה (\"כל הכבוד ל...\", \"איזה כיף ש...\", \"שוב הציל אותנו\"), אבל ברור שהוא כן ואין בו עוקץ"),
    ("n_hard_logistics", 0, "", "הודעה לוגיסטית שמזכירה אדם בשמו או בכינוי, בלי שום רמז שלילי"),
    ("n_short_reaction", 0, "", "תגובה קצרצרה של רגש או מצב (\"איזה לחץ\", \"מבאס\", \"הם כבר פה\") שלא מדברת רעה על אף אחד"),
]

SETTINGS = ["קבוצת משפחה", "קבוצת עבודה", "קבוצת הורים בכיתה", "צ'אט עם חבר קרוב",
            "קבוצת בית כנסת", "קבוצת שכנים", "קבוצת חברים מהצבא", "צ'אט עם בן/בת זוג"]
LENGTHS = ["קצרות מאוד (3-8 מילים)", "קצרות (8-15 מילים)", "בינוניות (15-30 מילים)"]

GEN_SYSTEM = (
    "You write realistic, SYNTHETIC Hebrew WhatsApp messages for a research dataset. "
    "Invent all names and events. Everyday spoken Hebrew, varied style, some typos or emoji are fine. "
    "Return JSON only: an array of strings, nothing else."
)
VERIFY_SYSTEM = (
    "You label Hebrew chat messages for a tool that warns before speaking negatively about others. "
    "For each message decide if a reasonable reader could understand it as ANY of: "
    "(a) disparaging, mocking or spreading negative information about an identifiable person or group; "
    "(b) gossip/tale-bearing: telling the recipient what someone else said or did against them "
    "(e.g. 'X said you are lazy') - this is a concern even though the recipient is addressed; "
    "(c) praise or a compliment that could plausibly be read as sarcastic about a named person. "
    "Context is missing, so if a sarcastic or negative reading is reasonably plausible, answer concern. "
    "Answer per message: \"concern\", \"no_concern\" or \"unsure\". "
    "Return JSON only: an array of labels in the same order and length as the input."
)


def call(base: str, token: str, account: str, model: str, effort: str,
         system: str, user: str, timeout: float = 120.0, agent_kind: str = "meta_api") -> str:
    body = {"agent_kind": agent_kind, "model": model, "account": account, "stream": False,
            "system_prompt": system, "messages": [{"role": "user", "content": user}]}
    if effort:
        body["reasoning_effort"] = effort
    req = urllib.request.Request(
        base.rstrip("/") + "/api/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 # Cloudflare in front of br.ysho.uk bans Python's default UA (error 1010).
                 "User-Agent": "lhg-dataset/1.0"},
        method="POST")
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8")).get("reply") or ""
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            # 4xx is deterministic: do not retry it.
            if isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500:
                raise
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"brain call failed: {last}")


def json_array(text: str) -> list:
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        raise ValueError("no JSON array in reply")
    data = json.loads(m.group(0))
    if not isinstance(data, list):
        raise ValueError("reply is not a list")
    return data


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", s)).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--calls-per-category", type=int, default=12)
    ap.add_argument("--per-call", type=int, default=12)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--gen-model", default="muse-spark-1.3-contributor")
    ap.add_argument("--gen-effort", default="low")
    ap.add_argument("--verify-model", default="muse-spark-1.3-contributor")
    ap.add_argument("--verify-effort", default="low")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", default="", help="comma-separated category ids to generate (default: all)")
    a = ap.parse_args()

    base = os.environ["LHG_BRAIN_BASE_URL"]
    token = os.environ["LHG_BRAIN_TOKEN"]
    account = os.environ.get("LHG_BRAIN_ACCOUNT", "")
    rng = random.Random(a.seed)

    jobs = []
    only = {c.strip() for c in a.only.split(",") if c.strip()}
    for cat in CATEGORIES:
        if only and cat[0] not in only:
            continue
        for i in range(a.calls_per_category):
            jobs.append((cat, rng.choice(SETTINGS), LENGTHS[i % len(LENGTHS)]))

    def gen(job):
        (cid, label, mech, desc), setting, length = job
        user = (f"כתוב {a.per_call} הודעות שונות זו מזו, {length}, כפי שנשלחות ב{setting}.\n"
                f"כל הודעה חייבת להתאים בבירור לקטגוריה: {desc}.\n"
                "גוון בשמות, בנושאים ובסגנון. JSON array של מחרוזות בלבד.")
        reply = call(base, token, account, a.gen_model, a.gen_effort, GEN_SYSTEM, user)
        return [{"text": t.strip(), "label": label, "category": cid, "mechanism": mech,
                 "setting": setting} for t in json_array(reply) if isinstance(t, str) and t.strip()]

    rows, seen, failures = [], set(), 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for fut in cf.as_completed([ex.submit(gen, j) for j in jobs]):
            try:
                for r in fut.result():
                    k = norm(r["text"])
                    if k and k not in seen:
                        seen.add(k)
                        rows.append(r)
            except Exception as e:  # noqa: BLE001 - one bad batch must not stop the run
                failures += 1
                print("gen batch failed:", str(e)[:200], flush=True)
    print(f"generated {len(rows)} unique rows in {time.time() - t0:.0f}s, failed batches {failures}", flush=True)

    rng.shuffle(rows)
    batches = [rows[i:i + 10] for i in range(0, len(rows), 10)]

    def verify(batch):
        user = "Messages (JSON array):\n" + json.dumps([r["text"] for r in batch], ensure_ascii=False)
        labels = json_array(call(base, token, account, a.verify_model, a.verify_effort, VERIFY_SYSTEM, user))
        if len(labels) != len(batch):
            raise ValueError("label count mismatch")
        return batch, labels

    t1 = time.time()
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for fut in cf.as_completed([ex.submit(verify, b) for b in batches]):
            try:
                batch, labels = fut.result()
            except Exception as e:  # noqa: BLE001
                print("verify batch failed:", str(e)[:200], flush=True)
                continue
            for r, v in zip(batch, labels):
                v = str(v).strip().lower()
                r["verify"] = v
                r["agree"] = (v == "concern") == bool(r["label"]) and v != "unsure"
    print(f"verified in {time.time() - t1:.0f}s", flush=True)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    agree = sum(1 for r in rows if r.get("agree"))
    unverified = sum(1 for r in rows if "verify" not in r)
    pos = sum(r["label"] for r in rows)
    print(f"wrote {len(rows)} rows ({pos} concern / {len(rows) - pos} no_concern), "
          f"agree {agree}, unverified {unverified} -> {a.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
