"""Deterministic synthetic template source for the 18-fact extractor (contract_v2.json).

Writes ONE full source file, all_v2.jsonl, with the split already decided; split_v2.py only
filters/joins it and never reads its own outputs (rerun-safe).

Leakage design (docs/40):
* A *semantic unit* is one fact sentence (alias, state, variant) or one background sentence.
  The Hebrew and English strings of a unit are translations of the same source and share its id.
* Every unit belongs to exactly ONE split (fact variants v0,v1 -> train, v2 -> dev, v3 -> holdout;
  backgrounds are split-scoped too). A row is composed only of units from its own split, so no
  semantic source, translation, code-switched (mixed) rendering or contrast crosses splits.
* family = hash of the row's sorted fact units (language-free). he/en/mixed renderings of the same
  composition and the contrast rows (quote/hypothetical/question) built from a single unit share the
  family of that unit's single-fact row.
Labels: state T/F -> gold [bool, verbatim evidence]; U (undecidable) -> omitted (unknown is not false).
Synthetic only; agent_reviewed=False (no review pass was performed on these rows); human_review_pending.
"""
import argparse
import hashlib
import json
import pathlib
import random

ROOT = pathlib.Path(__file__).parent
CONTRACT = json.loads((ROOT / "contract_v2.json").read_text(encoding="utf-8"))
KEYS = [f[0] for f in CONTRACT["facts"]]
VARIANT_SPLIT = {0: "train", 1: "train", 2: "dev", 3: "holdout"}
SPLITS = ("train", "dev", "holdout")
# Facts whose phrasings imply each other; never compose them in one row (labels would be ambiguous).
EXCLUDE_PAIRS = {frozenset(p) for p in [
    ("firsthand", "repeats_prior"), ("unverified_rumor", "repeats_prior"), ("unverified_rumor", "firsthand"),
    ("unverified_rumor", "verified"), ("second_source", "verified"), ("second_source", "repeats_prior"),
    ("second_source", "firsthand"), ("purpose", "future_purpose")]}
# Quoting is itself relaying; a quote-contrast would be ambiguous for these facts.
NO_QUOTE_CONTRAST = {"repeats_prior", "second_source"}

# alias -> lang -> state -> [v0, v1, v2, v3]
P = {
"purpose": {
 "he": {"T": ["המטרה שלי להזהיר כדי להגן עליכם", "אני כותב כדי שאף אחד לא ייפגע ממנו", "אני משתף כדי שהבעיה תתוקן", "אני מספר רק כדי שתיזהרו ולא תינזקו"],
        "F": ["אני מספר רק כדי לפרוק תסכול", "זה סתם בשביל הצחוק, לא כדי לעזור למישהו", "אני כותב רק כי בא לי להתלונן", "אין לזה שום תועלת, אני פשוט מתפרק"],
        "U": ["אינני יודע מה המטרה שלי", "לא ברור לי בשביל מה אני כותב את זה", "עוד לא החלטתי למה אני משתף", "אני לא בטוח מה אני רוצה להשיג מזה"]},
 "en": {"T": ["My aim is to warn and protect you", "I'm writing so nobody else gets hurt by him", "I'm sharing so the problem gets fixed", "I'm telling you only so you stay safe"],
        "F": ["I am sharing only to vent", "This is just for laughs, not to help anyone", "I'm writing only because I feel like complaining", "There's no benefit here, I'm just letting off steam"],
        "U": ["I do not know my purpose", "I'm not sure why I'm writing this", "I haven't decided why I'm sharing this", "I'm unsure what I want to achieve with this"]}},
"intent": {
 "he": {"T": ["אני רוצה לבייש אותו", "אני רוצה שכולם יצחקו עליו", "אני רוצה שיזלזלו בו", "אני רוצה שהוא ייראה רע מול כולם"],
        "F": ["אני לא רוצה לפגוע בו", "אין לי כוונה להשמיץ אותו", "אני לא מנסה להוציא לו שם רע", "אין לי שום רצון לבזות אותו"],
        "U": ["אולי ארצה לפגוע בו", "אני לא בטוח אם אני רוצה לפגוע בו", "קשה לי לומר אם אני רוצה לבייש אותו", "לא ברור לי אם אני רוצה שיצחקו עליו"]},
 "en": {"T": ["I want to humiliate him", "I want everyone to laugh at him", "I want people to look down on him", "I want him to look bad in front of everyone"],
        "F": ["I do not want to hurt him", "I have no intention of badmouthing him", "I'm not trying to give him a bad name", "I have no wish to embarrass him"],
        "U": ["I might want to hurt him", "I'm not sure whether I want to hurt him", "Hard to say if I want to shame him", "I can't tell whether I want people to laugh at him"]}},
"revenge": {
 "he": {"T": ["אני פועל מתוך נקמה", "זה החזר על מה שהוא עשה לי", "אני שונא אותו ורוצה להחזיר לו", "יש לי חשבון פתוח איתו ואני סוגר אותו"],
        "F": ["אין לי שום רצון לנקום בו", "זה לא מתוך כעס או טינה", "אני לא מחזיק נגדו שום טינה", "אין כאן שום חשבון אישי או נקמה"],
        "U": ["אני לא בטוח אם זו נקמה", "אולי יש פה קצת נקמה, אני לא יודע", "קשה לי להגיד אם זה מתוך טינה", "לא ברור לי אם אני כועס עליו"]},
 "en": {"T": ["I am doing this for revenge", "This is payback for what he did to me", "I hate him and want to get even", "I have a score to settle with him"],
        "F": ["I have no desire for revenge", "This is not out of anger or a grudge", "I hold no grudge against him", "There is nothing personal or vengeful here"],
        "U": ["I am unsure whether this is revenge", "Maybe there is some revenge here, I don't know", "Hard to say if this comes from a grudge", "I'm not sure whether I'm angry at him"]}},
"firsthand": {
 "he": {"T": ["ראיתי בעצמי את האירוע", "זה קרה לי אישית", "הייתי שם וראיתי במו עיניי", "נכחתי כשזה קרה"],
        "F": ["לא הייתי שם ולא ראיתי את זה בעצמי", "לא הייתי עד לזה בעצמי", "את זה לא ראיתי במו עיניי", "לא נכחתי כשזה קרה"],
        "U": ["אינני זוכר אם הייתי שם", "לא בטוח אם ראיתי את זה בעצמי", "אולי הייתי שם, אולי לא", "לא זוכר אם נכחתי"]},
 "en": {"T": ["I witnessed the incident myself", "It happened to me personally", "I was there and saw it with my own eyes", "I was present when it happened"],
        "F": ["I was not there and did not see it myself", "I did not witness it myself", "I didn't see this with my own eyes", "I was not present when it happened"],
        "U": ["I cannot remember whether I was there", "Not sure if I saw it myself", "Maybe I was there, maybe not", "I don't recall if I was present"]}},
"verified": {
 "he": {"T": ["בדקתי ואימתתי את פרטי הדיווח", "ביררתי עם מי שהיו שם והם אישרו", "השוויתי מסמכים וזה אומת", "וידאתי את העובדות לפני שכתבתי"],
        "F": ["לא בדקתי את נכונות הדיווח", "עוד לא ביררתי אם זה נכון", "לא אימתתי את הפרטים", "לא וידאתי את זה מול אף אחד"],
        "U": ["אולי אבדוק את הדיווח מחר", "לא בטוח אם בדקתי את זה עד הסוף", "ייתכן שאברר את זה בהמשך", "אינני זוכר אם אימתתי את הפרטים"]},
 "en": {"T": ["I checked and confirmed the report", "I asked people who were there and they confirmed it", "I compared the documents and it checked out", "I verified the facts before writing"],
        "F": ["I have not checked whether the report is true", "I haven't looked into whether it's true yet", "I did not verify the details", "I haven't confirmed this with anyone"],
        "U": ["I may check the report tomorrow", "Not sure if I checked it fully", "I might look into it later", "I don't remember if I verified the details"]}},
"rebuke": {
 "he": {"T": ["כבר דיברתי איתו על ההתנהגות הזאת", "העירתי לו על זה כמה פעמים", "פניתי אליו ישירות בעניין הזה", "כבר אמרתי לו בפנים שזה לא בסדר"],
        "F": ["טרם דיברתי איתו על ההתנהגות הזאת", "עוד לא העירתי לו על זה", "לא פניתי אליו בעניין", "עדיין לא אמרתי לו כלום על זה"],
        "U": ["ייתכן שאדבר איתו על כך", "אולי אעיר לו בהמשך", "לא בטוח אם כבר דיברתי איתו", "אולי אפנה אליו בשבוע הבא"]},
 "en": {"T": ["I already addressed him about this behavior", "I've pointed it out to him several times", "I approached him directly about it", "I already told him to his face that it's wrong"],
        "F": ["I have not addressed him about this behavior", "I haven't pointed it out to him yet", "I didn't approach him about it", "I haven't said anything to him about it yet"],
        "U": ["I might address him about this", "Maybe I'll mention it to him later", "Not sure if I already talked to him", "I may approach him next week"]}},
"rejects": {
 "he": {"T": ["הוא לא יקבל תוכחה", "אני יודע שהוא לא יקשיב לשום הערה", "אין סיכוי שהוא יקבל ביקורת", "הוא תמיד דוחה כל הערה"],
        "F": ["הוא מוכן לקבל תוכחה", "אני יודע שהוא פתוח לשמוע ביקורת", "הוא בדרך כלל מקשיב להערות", "הוא יקבל הערה אם יפנו אליו"],
        "U": ["אינני יודע אם יקבל תוכחה", "לא ברור אם הוא יקשיב", "אולי הוא יקבל ביקורת, אולי לא", "קשה לדעת איך הוא יגיב להערה"]},
 "en": {"T": ["He will not accept correction", "I know he won't listen to any remark", "There's no chance he'll take criticism", "He always rejects any comment"],
        "F": ["He is willing to accept correction", "I know he's open to hearing criticism", "He usually listens to remarks", "He would accept a comment if approached"],
        "U": ["I do not know whether he will accept correction", "Unclear if he'll listen", "Maybe he'll take criticism, maybe not", "Hard to know how he'd react to a comment"]}},
"no_alternative": {
 "he": {"T": ["אין שום דרך אחרת לטפל בזה", "זו האפשרות היחידה שנשארה", "אין לי דרך אחרת לעצור את זה", "ניסיתי הכל וזה מה שנשאר"],
        "F": ["יש דרך אחרת לטפל בזה", "אפשר היה לפתור את זה בשקט ביחידות", "יש פתרונות אחרים לזה", "אפשר לטפל בזה גם בלי לפרסם"],
        "U": ["אולי יש דרך אחרת לטפל בזה", "לא בטוח אם יש פתרון אחר", "ייתכן שיש דרך אחרת", "קשה לי לדעת אם יש אפשרות אחרת"]},
 "en": {"T": ["There is no other way to handle this", "This is the only option left", "I have no other way to stop it", "I've tried everything and this is what's left"],
        "F": ["There is another way to handle this", "This could be solved quietly in private", "There are other solutions to this", "This could be handled without publicizing it"],
        "U": ["There may be another way to handle this", "Not sure if there's another solution", "Possibly there is another way", "Hard to know if there's another option"]}},
"said_in_jest": {
 "he": {"T": ["אני אומר את זה סתם בצחוק", "זו רק בדיחה עליו", "אני רק מתלוצץ על חשבונו", "אל תיקחו ברצינות, זה בצחוק"],
        "F": ["אני אומר את זה ברצינות מלאה", "זו לא בדיחה, אני רציני", "אני לא מתלוצץ כאן בכלל", "תיקחו את זה ברצינות, אני לא צוחק"],
        "U": ["אולי זה בצחוק ואולי לא", "לא בטוח אם אני מתלוצץ", "קשה לי לומר אם זה רציני", "תחליטו אתם אם זה בצחוק"]},
 "en": {"T": ["I'm saying it just as a joke", "This is only a joke about him", "I'm just kidding at his expense", "Don't take it seriously, it's a joke"],
        "F": ["I'm saying it completely seriously", "This is no joke, I'm serious", "I'm not kidding at all here", "Take it seriously, I'm not joking"],
        "U": ["Maybe it's a joke and maybe not", "Not sure if I'm kidding", "Hard to say if it's serious", "You decide whether it's a joke"]}},
"is_hint": {
 "he": {"T": ["אני רק רומז על זה בעקיפין", "לא אגיד את זה במפורש, רק ארמוז", "אני לא אומר את זה ישירות, רק ברמז", "אני משאיר את זה ברמז בלבד"],
        "F": ["אני אומר את זה במפורש ובגלוי", "אני אומר את זה ישר בלי רמזים", "אני אומר את זה בפירוש", "בלי לרמוז, אני אומר את זה ישירות"],
        "U": ["לא זוכר אם אמרתי במפורש", "לא בטוח אם זה היה רמז", "אולי זה נשמע כמו רמז", "קשה לי לומר אם רמזתי"]},
 "en": {"T": ["I'm only hinting at it indirectly", "I won't say it outright, just hint", "I'm not saying it directly, only by hint", "I'm leaving it as a hint only"],
        "F": ["I'm saying it explicitly and openly", "I'm saying it straight with no hints", "I'm saying it plainly", "No hinting, I'm saying it directly"],
        "U": ["I don't remember if I said it explicitly", "Not sure if it was a hint", "Maybe it sounds like a hint", "Hard to say if I hinted"]}},
"medium_written": {
 "he": {"T": ["אני מעלה את זה בכתב כדי שיהיה תיעוד", "אני כותב את זה כאן בכוונה, שיישאר כתוב", "אני שם את זה על הכתב", "בחרתי לכתוב את זה ולא רק לומר"],
        "F": ["את הפרטים לא אכתוב, אספר רק בעל פה כשניפגש", "אני לא שם את זה בכתב, רק אגיד לך בטלפון", "לא אעלה את זה על הכתב, נדבר בעל פה", "את זה אומר רק בעל פה ולא בכתב"],
        "U": ["אולי אכתוב ואולי אגיד", "עוד לא החלטתי אם לכתוב או לומר", "לא בטוח אם לשים את זה בכתב", "אולי אעביר את זה בעל פה"]},
 "en": {"T": ["I'm putting this in writing so there's a record", "I'm writing it here on purpose so it stays written", "I'm putting this on the record in writing", "I chose to write this rather than just say it"],
        "F": ["I won't write the details, I'll tell you in person", "I'm not putting it in writing, I'll say it on the phone", "I won't put this on paper, we'll talk", "I'll only say this orally, not in writing"],
        "U": ["Maybe I'll write it and maybe say it", "I haven't decided whether to write or say it", "Not sure whether to put this in writing", "Maybe I'll pass it on verbally"]}},
"same_self_disparagement": {
 "he": {"T": ["גם אני לא יותר טוב ממנו בזה", "אני אומר את זה גם על עצמי, אני לא יותר טוב", "גם אני נוהג בדיוק כך", "האמת שגם אני סובל מאותה בעיה"],
        "F": ["זה רק עליו, לא עליי", "אני מדבר רק עליו ולא על עצמי", "את זה אני לא אומר על עצמי, רק עליו", "זה נוגע רק אליו, לא אליי"],
        "U": ["אולי זה נכון גם לגביי", "לא בטוח אם גם אני כזה", "ייתכן שגם אני לא שונה", "קשה לי לדעת אם זה גם עליי"]},
 "en": {"T": ["I'm no better at this than he is", "I say this about myself too, I'm no better", "I behave exactly the same way", "Honestly I have the very same problem"],
        "F": ["This is only about him, not me", "I'm talking only about him, not myself", "I'm not saying this about myself, only him", "This concerns only him, not me"],
        "U": ["Maybe this is true of me as well", "Not sure if I'm like that too", "Possibly I'm no different", "Hard to know if this applies to me too"]}},
"unverified_rumor": {
 "he": {"T": ["זו רק שמועה שעוד לא התבררה", "זה קול שמסתובב ואף אחד לא בירר אותו", "מדובר בשמועה בלבד, לא דבר מבורר", "זה רק מה שמדברים, עוד לא הוברר"],
        "F": ["זו לא שמועה, זה התברר באופן רשמי", "זה כבר הוכח בוועדה, לא סתם דיבורים", "הדבר הוברר לגמרי, אין כאן שמועה", "זה ממצא מבורר ולא קול בעלמא"],
        "U": ["לא ברור אם זו שמועה או עובדה", "אולי זה רק דיבורים", "אינני יודע אם זה התברר", "קשה לי לומר אם זה הוכח"]},
 "en": {"T": ["This is only a rumor that hasn't been clarified", "It's talk going around that nobody has looked into", "It's just a rumor, not an established fact", "It's only what people are saying, not yet clarified"],
        "F": ["This is no rumor, it was officially established", "It was already proven at the committee, not just talk", "It has been fully clarified, there's no rumor here", "It's an established finding, not hearsay"],
        "U": ["Unclear whether this is a rumor or a fact", "Maybe it's just talk", "I don't know whether it was clarified", "Hard to say if it was proven"]}},
"second_source": {
 "he": {"T": ["אני מאשר את מה שדנה סיפרה לך עליו", "מה ששמעת מיוסי, אני יכול לאשר שזה נכון", "אני מצטרף כמקור שני למה שכבר שמעת", "אני מאשר את הדיווח ששמעת קודם"],
        "F": ["את מה ששמעת מדנה אני לא יכול לאשר", "אני לא מאשר את מה שיוסי סיפר לך", "לגבי מה ששמעת קודם, אין לי אישור", "אני לא יכול לגבות את הדיווח ששמעת"],
        "U": ["לא בטוח אם אני מאשר את מה ששמעת", "אולי אוכל לאשר את מה שסיפרו לך", "קשה לי לומר אם זה תואם את מה ששמעת", "לא יודע אם זה מה שסיפרו לך"]},
 "en": {"T": ["I confirm what Dana told you about him", "What you heard from Yossi, I can confirm it's true", "I'm a second source for what you already heard", "I confirm the report you heard earlier"],
        "F": ["I can't confirm what you heard from Dana", "I don't confirm what Yossi told you", "As for what you heard before, I have no confirmation", "I cannot back up the report you heard"],
        "U": ["Not sure if I confirm what you heard", "Maybe I can confirm what they told you", "Hard to say if it matches what you heard", "I don't know if this is what they told you"]}},
"future_purpose": {
 "he": {"T": ["אני שואל כי אנחנו שוקלים לשכור ממנו דירה", "חשוב לי לדעת לפני שנכנסים איתו לשותפות", "אני מברר לקראת שידוך אפשרי", "זה בשביל להחליט אם להעסיק אותו"],
        "F": ["אני שואל סתם מתוך סקרנות", "אין לי שום עסק איתו בעתיד, סתם מעניין אותי", "סתם רציתי לדעת, אין לזה המשך", "זה רק מסקרנות, לא בשביל החלטה כלשהי"],
        "U": ["לא ברור למה אני שואל", "אולי זה יעזור לי בהמשך, לא יודע", "עוד לא יודע אם יהיה לי עסק איתו", "אני לא בטוח למה זה חשוב לי"]},
 "en": {"T": ["I'm asking because we're considering renting from him", "I need to know before going into partnership with him", "I'm checking ahead of a possible match", "It's to decide whether to hire him"],
        "F": ["I'm just asking out of curiosity", "I have no future dealings with him, I'm just curious", "I just wanted to know, nothing will come of it", "It's only curiosity, not for any decision"],
        "U": ["Unclear why I'm asking", "Maybe it'll help me later, I don't know", "I don't know yet if I'll deal with him", "I'm not sure why this matters to me"]}},
"requested_disclosure": {
 "he": {"T": ["אבא שלי ביקש שאעביר את זה", "הרב שלי ביקש ממני למסור את הדברים", "אמא שלי ביקשה שאספר לך", "הרב ביקש שאדווח לו על זה"],
        "F": ["אף הורה או רב לא ביקש ממני לספר", "איש מהוריי או מרבותיי לא ביקש זאת", "לא אבא ולא הרב ביקשו שאמסור את זה", "זה ביוזמתי, אף רב או הורה לא ביקש"],
        "U": ["אולי אבא ירצה שאספר", "לא בטוח אם הרב ביקש את זה", "אינני זוכר אם מישהו מהוריי ביקש", "ייתכן שהרב יבקש לדעת"]},
 "en": {"T": ["My father asked me to pass this on", "My rabbi asked me to report these things", "My mother asked me to tell you", "The rabbi asked me to let him know about this"],
        "F": ["No parent or rabbi asked me to tell this", "None of my parents or teachers asked for this", "Neither my father nor the rabbi asked me to pass it on", "This is my own initiative, no rabbi or parent asked"],
        "U": ["Maybe my father would want me to tell", "Not sure if the rabbi asked for this", "I don't recall if my parents asked", "The rabbi might ask to know"]}},
"repeats_prior": {
 "he": {"T": ["אני מעביר הלאה מה שיוסי סיפר לי עליו", "זה מה שסיפרו לי עליו ואני רק מעביר", "שמעתי את זה מדנה ואני מוסר לכם", "אני חוזר על מה שאמרו לי עליו"],
        "F": ["זה התיאור שלי, אני לא מעביר דברים של אחרים", "אני לא מוסר הלאה סיפור של מישהו אחר", "זה לא משהו שסיפרו לי, זה החשבון שלי", "אני לא מצטט אף אחד, אלה הדברים שלי"],
        "U": ["אולי כבר שמעתי את זה ממישהו", "לא זוכר אם סיפרו לי את זה", "ייתכן שזה הגיע אליי מאחרים", "לא בטוח מאיפה זה הגיע אליי"]},
 "en": {"T": ["I'm passing on what Yossi told me about him", "This is what people told me and I'm just relaying it", "I heard it from Dana and I'm passing it to you", "I'm repeating what I was told about him"],
        "F": ["This is my own account, not passing on others' stories", "I'm not relaying anyone else's story", "Nobody told me this, it's my own account", "I'm not quoting anyone, these are my own words"],
        "U": ["Maybe I heard this from someone already", "I don't remember if someone told me", "This may have reached me from others", "Not sure where this came from"]}},
"subject_self_disclosed": {
 "he": {"T": ["הוא בעצמו סיפר את זה מול חמישה אנשים בישיבה", "הוא עצמו גילה את זה בפני כל עשרת חברי הוועד", "הוא סיפר על זה בעצמו לשלושה שכנים לפחות", "הוא בעצמו הודיע על זה מול כל הכיתה"],
        "F": ["הוא לא סיפר את זה לאיש", "הוא סיפר את זה רק לי, בארבע עיניים", "הוא גילה את זה רק לחבר אחד בסוד", "הוא שמר את זה לעצמו ולא סיפר לאף אחד"],
        "U": ["אולי הוא סיפר את זה בעצמו", "הוא סיפר את זה באיזו קבוצה, לא יודע לכמה", "לא ברור למי הוא סיפר", "ייתכן שהוא עצמו פרסם את זה"]},
 "en": {"T": ["He himself told this to five people at the meeting", "He disclosed it himself to all ten committee members", "He told at least three neighbors about it himself", "He announced it himself in front of the whole class"],
        "F": ["He didn't tell anyone", "He told only me, privately", "He told just one friend, in confidence", "He kept it to himself and told no one"],
        "U": ["Maybe he told it himself", "He mentioned it in some group, not sure to how many", "Unclear who he told", "He may have made it public himself"]}},
}

BACK = {
 "train": [("האיש איחר לפגישה.", "The person missed the meeting."), ("הספק שלח ארגז שבור.", "The supplier delivered a broken box."),
           ("המרצה הפסיק באמצע השיעור.", "The lecturer stopped midway through the class."), ("העובד לא השלים את המשימה.", "The worker did not finish the task."),
           ("השכן השאיר זבל בחדר המדרגות.", "The neighbor left trash in the stairwell."), ("המאמן צעק על הילדים באימון.", "The coach yelled at the kids at practice.")],
 "dev": [("הנהג דילג על תחנה.", "The driver skipped a stop."), ("הגזבר לא הציג קבלות.", "The treasurer did not show receipts.")],
 "holdout": [("הקבלן השאיר חוטי חשמל חשופים.", "The contractor left exposed electrical wires."), ("המוכר החזיר עודף לא נכון.", "The seller gave back the wrong change.")],
}
CONTRAST = {
 "quote": {"he": 'מישהו אחר כתב: "{t}". אני רק מצטט.', "en": 'Someone else wrote: "{t}". I am just quoting.', "mixed": 'Someone else wrote: "{t}". אני רק מצטט.'},
 "hypothetical": {"he": 'אם הייתי כותב "{t}" זה היה היפותטי בלבד.', "en": 'If I wrote "{t}" it would be hypothetical.', "mixed": 'If I wrote "{t}" זה היה היפותטי בלבד.'},
 "question": {"he": 'האם נכון לומר "{t}"? אני שואל, לא קובע.', "en": 'Is it accurate to say "{t}"? I am asking, not stating.', "mixed": 'האם נכון לומר "{t}"? I am asking, not stating.'},
}
PER_SPLIT = {"train": 900, "dev": 150, "holdout": 200}


def check_bank():
    assert set(P) == set(KEYS), sorted(set(P) ^ set(KEYS))
    seen = {}
    for a in KEYS:
        for lang in ("he", "en"):
            for st in "TFU":
                assert len(P[a][lang][st]) == 4, (a, lang, st)
                for v, s in enumerate(P[a][lang][st]):
                    assert '"' not in s and s not in seen, (a, lang, st, v, s, seen.get(s))
                    seen[s] = (a, lang, st, v)


def fam(units):
    return "f18-" + hashlib.sha256("|".join(sorted(units)).encode()).hexdigest()[:16]


def row(rid, family, units, lang, text, gold, split, prov):
    return dict(id=rid, family=family, semantic_units=sorted(units), language=lang, text=text, gold=gold,
                split=split, source="synthetic_templates_v2", provenance=prov, contract="contract_v2.json",
                synthetic=True, agent_reviewed=False, human_review_pending=True)


def build(seed):
    check_bank()
    rng = random.Random(seed)
    rows, fams = [], set()
    for split in SPLITS:
        variants = [v for v, s in VARIANT_SPLIT.items() if s == split]
        target, tries = PER_SPLIT[split], 0
        made = 0
        while made < target:
            tries += 1
            assert tries < target * 50, "cannot reach target without duplicates"
            k = rng.choice([1, 1, 2, 2, 3, 3, 4])
            facts = rng.sample(KEYS, k)
            if any(frozenset((a, b)) in EXCLUDE_PAIRS for i, a in enumerate(facts) for b in facts[i + 1:]):
                continue
            picks = [(a, rng.choice("TTFFU"), rng.choice(variants)) for a in facts]
            units = [f"{a}:{st}:v{v}" for a, st, v in picks]
            family = fam(units)
            if family in fams:
                continue
            fams.add(family)
            bi = rng.randrange(len(BACK[split]))
            mixed_he = [rng.random() < 0.5 for _ in range(len(picks) + 1)]
            if all(mixed_he) or not any(mixed_he):
                mixed_he[0] = not mixed_he[0]
            for lang in ("he", "en", "mixed"):
                langs = [("he" if h else "en") for h in mixed_he] if lang == "mixed" else [lang] * (len(picks) + 1)
                pieces = [BACK[split][bi][0 if langs[0] == "he" else 1]]
                gold = {}
                for (a, st, v), pl in zip(picks, langs[1:]):
                    phrase = P[a][pl][st][v]
                    pieces.append(phrase + ".")
                    if st != "U":
                        gold[a] = [st == "T", phrase]
                rows.append(row(f"t2-{split}-{made}-{lang}", family, units + [f"bg:{split}:{bi}"], lang,
                                " ".join(pieces), gold, split, "synthetic_template"))
            made += 1
        # contrasts: every T unit of this split, all wrappers, all renderings; same family as the unit's own family
        for a in KEYS:
            for v in variants:
                unit = f"{a}:T:v{v}"
                for kind, tmpl in CONTRAST.items():
                    if kind == "quote" and a in NO_QUOTE_CONTRAST:
                        continue
                    for lang in ("he", "en", "mixed"):
                        inner = P[a]["en" if lang == "mixed" and kind != "quote" else ("he" if lang == "mixed" else lang)]["T"][v]
                        rows.append(row(f"c2-{split}-{a}-v{v}-{kind}-{lang}", fam([unit]), [unit], lang,
                                        tmpl[lang].format(t=inner), {}, split, "synthetic_template_contrast"))
    texts = [r["text"] for r in rows]
    assert len(texts) == len(set(texts)), "duplicate text"
    return rows


def dump(rows):
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument("--out", default="all_v2.jsonl")
    ap.add_argument("--check", action="store_true", help="rebuild twice in memory and compare to the file on disk; write nothing")
    args = ap.parse_args()
    data = dump(build(args.seed))
    h = hashlib.sha256(data.encode("utf-8")).hexdigest()
    if args.check:
        again = hashlib.sha256(dump(build(args.seed)).encode("utf-8")).hexdigest()
        disk = hashlib.sha256((ROOT / args.out).read_bytes()).hexdigest()
        ok = h == again == disk
        print(json.dumps({"deterministic": h == again, "matches_disk": disk == h, "sha256": h}))
        raise SystemExit(0 if ok else 1)
    (ROOT / args.out).write_bytes(data.encode("utf-8"))
    print(json.dumps({"out": args.out, "rows": data.count("\n"), "sha256": h, "seed": args.seed}))


if __name__ == "__main__":
    main()
