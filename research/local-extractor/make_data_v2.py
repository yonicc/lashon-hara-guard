"""Deterministic synthetic training templates, expanded round.

Covers the original 8 toelet/speaker facts plus extractable message.* and
context.* facts that are decidable from the message and the near conversation
(docs/32 groups A/B). External/expert facts (group D) are intentionally NOT
templated: no local text establishes them, so they must stay unknown and route
to ask_user / a rabbi referral. Never used as an independent benchmark.
"""
import hashlib
import json
import pathlib
import random

ROOT = pathlib.Path(__file__).parent
CONTRACT = json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))
KEYS = [f[0] for f in CONTRACT["facts"]]
NFACTS = len(KEYS)

# Each row: one fact -> [explicit true phrase, explicit false phrase, unknown phrase].
# Missing != false. Unknown phrase states the fact cannot be determined (omitted from gold).
PHRASES = {
"he": [
 # --- original 8 (toelet/speaker) ---
 ["המטרה שלי להזהיר כדי להגן עליכם", "אני מספר רק כדי לפרוק תסכול", "אינני יודע מה המטרה שלי"],            # purpose
 ["אני רוצה לבייש אותו", "אני לא רוצה לפגוע בו", "אולי ארצה לפגוע בו"],                                    # intent
 ["אני פועל מתוך נקמה", "אין לי שום רצון לנקום בו", "אני לא בטוח אם זו נקמה"],                            # revenge
 ["ראיתי בעצמי את האירוע", "לא הייתי שם ורק שמעתי על האירוע", "אינני זוכר אם הייתי שם"],                  # firsthand
 ["בדקתי ואימתתי את פרטי הדיווח", "לא בדקתי את נכונות הדיווח", "אולי אבדוק את הדיווח מחר"],               # verified
 ["כבר דיברתי איתו על ההתנהגות הזאת", "טרם דיברתי איתו על ההתנהגות הזאת", "ייתכן שאדבר איתו על כך"],        # rebuke
 ["הוא לא יקבל תוכחה", "הוא מוכן לקבל תוכחה", "אינני יודע אם יקבל תוכחה"],                                  # rejects
 ["אין שום דרך אחרת לטפל בזה", "יש דרך אחרת לטפל בזה", "אולי יש דרך אחרת לטפל בזה"],                      # no_alternative
 # --- message.* extractable ---
 ["אמרתי את זה סתם בצחוק", "אמרתי את זה ברצינות מלאה", "אולי אמרתי את זה בצחוק"],                          # said_in_jest
 ["רק רמזתי על זה בעקיפין", "אמרתי את זה במפורש ובגלוי", "לא זוכר אם אמרתי במפורש"],                      # is_hint_or_implied
 ["כתבתי לו את זה במייל", "אמרתי לו את זה בפה", "אולי כתבתי ואולי אמרתי"],                                  # medium_is_written
 ["זה בדיוק מה שאמרו עליי, פשוט חזרתי על זה", "אמרתי רק עליו ולא על עצמי", "אולי גם אמרתי על עצמי"],        # includes_same_self_disparagement
 ["הכל כבר ידוע לכולם ופורסם", "איש לא שמע את זה עד עכשיו", "אולי זה כבר פורסם"],                         # is_unverified_rumor (inverse sense handled by gold value)
 ["שמעתי את זה משני מקורות נפרדים", "שמעתי את זה רק ממקור אחד", "לא ברור מכמה מקורות שמעתי"],             # confirms_prior_report_from_second_source
 # --- context.* extractable from near conversation ---
 ["אני שואל כי אני צריך להחליט אם לעבוד איתו", "אני שואל סתם מתוך סקרנות", "לא ברור למה אני שואל"],        # inquiry_has_future_purpose
 ["אבא שלי ביקש ממני לגלות על זה", "איש לא ביקש ממני לדווח", "אולי מישהו ביקש ממני לדווח"],                # parent_or_rabbi_requested_disclosure
 ["כבר סיפרתי לך את זה בשבוע שעבר", "זו הפעם הראשונה שאני מספר את זה", "אולי כבר סיפרתי את זה"],          # repeats_prior_report
 ["הוא בעצמו סיפר את זה לכולם בקבוצה", "הוא לא סיפר את זה לאיש", "אולי הוא סיפר את זה בעצמו"],            # subject_disclosed_own_business_before_three
],
"en": [
 ["My aim is to warn and protect you", "I am sharing only to vent", "I do not know my purpose"],
 ["I want to humiliate him", "I do not want to hurt him", "I might want to hurt him"],
 ["I am doing this for revenge", "I have no desire for revenge", "I am unsure whether this is revenge"],
 ["I witnessed the incident myself", "I was not there and only heard about the incident", "I cannot remember whether I was there"],
 ["I checked and confirmed the report", "I have not checked whether the report is true", "I may check the report tomorrow"],
 ["I already addressed him about this behavior", "I have not addressed him about this behavior", "I might address him about this"],
 ["He will not accept correction", "He is willing to accept correction", "I do not know whether he will accept correction"],
 ["There is no other way to handle this", "There is another way to handle this", "There may be another way to handle this"],
 ["I said it jokingly", "I said it completely seriously", "Maybe I said it jokingly"],
 ["I only hinted at it", "I said it explicitly and openly", "I don't remember if I said it explicitly"],
 ["I wrote it to him in an email", "I told it to him verbally", "Maybe I wrote it and maybe I said it"],
 ["That's exactly what was said about me, I just repeated it", "I only said it about him, not myself", "Maybe I said it about myself too"],
 ["Everyone already knows it, it's public", "Nobody has heard it yet", "Maybe it's already public"],
 ["I heard it from two separate sources", "I heard it from only one source", "Unclear how many sources I heard it from"],
 ["I'm asking because I need to decide whether to work with him", "I'm just asking out of curiosity", "Unclear why I'm asking"],
 ["My father asked me to find out about this", "Nobody asked me to report", "Maybe someone asked me to report"],
 ["I already told you this last week", "This is the first time I'm telling it", "Maybe I already told it"],
 ["He himself told everyone in the group", "He didn't tell anyone", "Maybe he told it himself"],
],
"mixed": [
 ["המטרה שלי is to protect you", "אני מספר only to vent", "אני לא יודע what my purpose is"],
 ["אני רוצה to humiliate him", "אני לא רוצה to hurt him", "אולי ארצה to hurt him"],
 ["אני עושה את זה for revenge", "אין לי רצון for revenge", "לא ברור לי if this is revenge"],
 ["I witnessed the incident בעצמי", "לא הייתי שם and only heard about it", "לא זוכר if I was there"],
 ["I checked and confirmed את הדיווח", "לא בדקתי whether the report is true", "אולי אבדוק the report tomorrow"],
 ["כבר דיברתי איתו about this behavior", "טרם דיברתי איתו about this behavior", "אולי אדבר איתו about this"],
 ["הוא לא יקבל correction", "הוא מוכן לקבל correction", "לא יודע if he will accept correction"],
 ["אין דרך אחרת to handle this", "יש דרך אחרת to handle this", "אולי יש דרך אחרת to handle this"],
 ["אמרתי את זה jokingly", "אמרתי את זה seriously", "אולי אמרתי את זה jokingly"],
 ["רק hinted בעקיפין", "אמרתי את זה explicitly", "לא זוכר if I said it explicitly"],
 ["כתבתי לו את זה in an email", "אמרתי לו את זה verbally", "אולי wrote it and maybe said it"],
 ["זה בדיוק what was said עליי", "אמרתי only about him", "אולי said it about myself too"],
 ["הכל already public", "איש hasn't heard it yet", "אולי it's already public"],
 ["שמעתי את זה from two sources", "שמעתי only from one source", "לא ברור how many sources"],
 ["אני שואל because I need to decide", "אני שואל out of curiosity", "לא ברור why I'm asking"],
 ["אבא שלי asked me לגלות", "איש didn't ask me to report", "אולי someone asked me"],
 ["כבר סיפרתי לך את זה last week", "זו the first time I'm telling", "אולי already told it"],
 ["הוא בעצמו told everyone", "הוא didn't tell anyone", "אולי he told it himself"],
]}

BACK = {
"he":["האיש איחר לפגישה.", "הספק שלח ארגז שבור.", "המרצה הפסיק באמצע השיעור.", "העובד לא השלים את המשימה."],
"en":["The person missed the meeting.", "The supplier delivered a broken box.", "The lecturer stopped midway.", "The worker did not finish the task."],
"mixed":["הספק missed the deadline.", "העובד left early.", "המרצה stopped באמצע.", "הנהג skipped a stop."]
}

def save(name, rows):
    (ROOT / name).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument("--per-lang", type=int, default=800)
    ap.add_argument("--emit-splits", action="store_true", help="also emit train/dev/holdout via family split")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    rows = []
    seen = set()
    for lang in PHRASES:
        assert len(PHRASES[lang]) == NFACTS, f"{lang}: {len(PHRASES[lang])} phrases != {NFACTS} facts"
        for n in range(args.per_lang):
            k = rng.choice([1, 1, 2, 2, 3, 3, 4])
            ix = rng.sample(range(NFACTS), min(k, NFACTS))
            pieces = [rng.choice(BACK[lang])]
            gold = {}
            for i in ix:
                state = rng.randrange(3)
                phrase = PHRASES[lang][i][state]
                pieces.append(phrase + ".")
                if state < 2:
                    gold[KEYS[i]] = [state == 0, phrase]
            text = " ".join(pieces)
            if text in seen:
                continue
            seen.add(text)
            family = f"f-{lang}-{'-'.join(str(i) for i in sorted(ix))}-{n//12}"
            rows.append(dict(id=f"train2-{lang}-{n}", family=family, language=lang, text=text, gold=gold,
                 source="synthetic_templates_v2", provenance="synthetic_template",
                 synthetic=True, agent_reviewed=False,
                 human_review_pending=True, split="train"))
    CONTRAST_TEMPLATES = {
        "he": [
            'מישהו אחר כתב: "{t}". אני רק מצטט.',
            'אם הייתי כותב "{t}" זה היה היפותטי בלבד.',
            'האם נכון לומר "{t}"? אני שואל, לא קובע.',
        ],
        "en": [
            'Someone else wrote: "{t}". I am just quoting.',
            'If I wrote "{t}" it would be hypothetical.',
            'Is it accurate to say "{t}"? I am asking, not stating.',
        ],
        "mixed": [
            'Someone else wrote: "{t}". אני רק מצטט.',
            'If I wrote "{t}" זה היפותטי.',
            'האם נכון לומר "{t}"? I am asking.',
        ],
    }
    contrast_n = 0
    for lang in PHRASES:
        for fi in range(NFACTS):
            phrase = PHRASES[lang][fi][0]
            for tmpl in CONTRAST_TEMPLATES[lang]:
                text = tmpl.format(t=phrase)
                if text in seen:
                    continue
                seen.add(text)
                family = f"contrast-{lang}-{KEYS[fi]}-{contrast_n//3}"
                rows.append(dict(id=f"contrast-{lang}-{contrast_n}", family=family, language=lang,
                     text=text, gold={}, source="synthetic_templates_v2",
                     provenance="synthetic_template_contrast",
                     synthetic=True, agent_reviewed=False,
                     human_review_pending=True, split="train"))
                contrast_n += 1
    save("train_v2.jsonl", rows)
    print(json.dumps({"train_v2": len(rows), "facts": NFACTS,
      "sha256_train_v2": hashlib.sha256((ROOT / "train_v2.jsonl").read_bytes()).hexdigest(),
      "seed": args.seed}))
    if args.emit_splits:
        from split_v2 import main as split_main
        split_main(seed=args.seed, input_file="train_v2.jsonl")

if __name__ == "__main__":
    main()
