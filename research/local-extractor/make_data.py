"""Deterministic synthetic training templates; never used as an independent benchmark."""
import hashlib
import itertools
import json
import pathlib
import random

ROOT = pathlib.Path(__file__).parent
CONTRACT = json.loads((ROOT / "contract.json").read_text(encoding="utf-8"))
KEYS = [f[0] for f in CONTRACT["facts"]]
# Each tuple gives explicitly stated true, false, and unknown. Missing != false.
PHRASES = {
"he": [
["המטרה שלי להזהיר כדי להגן עליכם", "אני מספר רק כדי לפרוק תסכול", "אינני יודע מה המטרה שלי"],
["אני רוצה לבייש אותו", "אני לא רוצה לפגוע בו", "אולי ארצה לפגוע בו"],
["אני פועל מתוך נקמה", "אין לי שום רצון לנקום בו", "אני לא בטוח אם זו נקמה"],
["ראיתי בעצמי את האירוע", "לא הייתי שם ורק שמעתי על האירוע", "אינני זוכר אם הייתי שם"],
["בדקתי ואימתתי את פרטי הדיווח", "לא בדקתי את נכונות הדיווח", "אולי אבדוק את הדיווח מחר"],
["כבר דיברתי איתו על ההתנהגות הזאת", "טרם דיברתי איתו על ההתנהגות הזאת", "ייתכן שאדבר איתו על כך"],
["הוא לא יקבל תוכחה", "הוא מוכן לקבל תוכחה", "אינני יודע אם יקבל תוכחה"],
["אין שום דרך אחרת לטפל בזה", "יש דרך אחרת לטפל בזה", "אולי יש דרך אחרת לטפל בזה"]
],
"en": [
["My aim is to warn and protect you", "I am sharing only to vent", "I do not know my purpose"],
["I want to humiliate him", "I do not want to hurt him", "I might want to hurt him"],
["I am doing this for revenge", "I have no desire for revenge", "I am unsure whether this is revenge"],
["I witnessed the incident myself", "I was not there and only heard about the incident", "I cannot remember whether I was there"],
["I checked and confirmed the report", "I have not checked whether the report is true", "I may check the report tomorrow"],
["I already addressed him about this behavior", "I have not addressed him about this behavior", "I might address him about this"],
["He will not accept correction", "He is willing to accept correction", "I do not know whether he will accept correction"],
["There is no other way to handle this", "There is another way to handle this", "There may be another way to handle this"]
],
"mixed": [
["המטרה שלי is to protect you", "אני מספר only to vent", "אני לא יודע what my purpose is"],
["אני רוצה to humiliate him", "אני לא רוצה to hurt him", "אולי ארצה to hurt him"],
["אני עושה את זה for revenge", "אין לי רצון for revenge", "לא ברור לי if this is revenge"],
["I witnessed the incident בעצמי", "לא הייתי שם and only heard about it", "לא זוכר if I was there"],
["I checked and confirmed את הדיווח", "לא בדקתי whether the report is true", "אולי אבדוק the report tomorrow"],
["כבר דיברתי איתו about this behavior", "טרם דיברתי איתו about this behavior", "אולי אדבר איתו about this"],
["הוא לא יקבל correction", "הוא מוכן לקבל correction", "לא יודע if he will accept correction"],
["אין דרך אחרת to handle this", "יש דרך אחרת to handle this", "אולי יש דרך אחרת to handle this"]
]}
BACK = {
"he":["האיש איחר לפגישה.", "הספק שלח ארגז שבור.", "המרצה הפסיק באמצע השיעור.", "העובד לא השלים את המשימה."],
"en":["The person missed the meeting.", "The supplier delivered a broken box.", "The lecturer stopped midway.", "The worker did not finish the task."],
"mixed":["הספק missed the deadline.", "העובד left early.", "המרצה stopped באמצע.", "הנהג skipped a stop."]
}
def save(name, rows):
    (ROOT / name).write_text("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in rows),encoding="utf-8")
def main():
    rng=random.Random(20261028)
    rows=[]
    seen=set()
    for lang in PHRASES:
        for n in range(400):
            ix = rng.sample(range(8), rng.choice([0,1,1,2,2,3]))
            pieces=[rng.choice(BACK[lang])]
            gold={}
            for i in ix:
                state=rng.randrange(3)
                phrase=PHRASES[lang][i][state]
                pieces.append(phrase+".")
                if state<2: gold[KEYS[i]]=[state==0,phrase]
            text=" ".join(pieces)
            if text in seen: continue
            seen.add(text)
            rows.append(dict(id=f"train-{lang}-{n}",language=lang,text=text,gold=gold,
                 source="synthetic_templates",synthetic=True,agent_reviewed=True,
                 human_review_pending=True,split="train"))
    # Entire legacy 74-item fixture is evaluation-only. No training ingestion.
    old=json.loads((ROOT.parents[1]/"engine/test/fixtures/fact-extraction-eval-v1.json").read_text(encoding="utf-8"))
    ids={f[1]:f[0] for f in CONTRACT["facts"]}
    legacy=[dict(id="legacy-"+r["id"],language="he",text=r["text"],
       expect={ids[k]:v for k,v in r["expect"].items() if k in ids},
       ok=[ids[k] for k in r.get("ok",[]) if k in ids],
       source="legacy_eval_v1",synthetic=True,agent_reviewed=True,human_review_pending=True,split="legacy_eval")
       for r in old["items"]]
    save("train.jsonl",rows)
    save("legacy.jsonl",legacy)
    print(json.dumps({"train":len(rows),"legacy_eval":len(legacy),
      "sha256_train":hashlib.sha256((ROOT/"train.jsonl").read_bytes()).hexdigest()}))
if __name__=="__main__": main()
