"""Sealed v3: agent-authored natural messages, written BEFORE the e8 data/training exists.
Legacy-style: implicit purpose (warnings, requests to an authority), compound facts in one message,
quotes/questions/hypotheticals that must stay unknown. Never used for training or prompt tuning.
python research/local-extractor/make_sealed_v3.py  -> diverse/sealed_v3.jsonl
"""
import json,pathlib
ROOT=pathlib.Path(__file__).parent
T,F=True,False
ROWS=[
("he","ראיתי אתמול בעצמי איך הקבלן משאיר את הפיגום בלי גידור ליד הגן. תדברו עם העירייה שיסגרו לו את האתר לפני שילד ייפגע.",{"firsthand":T,"purpose":T},[]),
("he","חברה סיפרה לי שהרופאה בקופה צורחת על מטופלים, לא בדקתי אם זה נכון. סתם, שיהיה לכם על מה לרכל.",{"firsthand":F,"verified":F,"purpose":F},["intent"]),
("he","אחרי שהוא הלשין עליי לבוס, הגיע תורו. אני הולך לפרסם לכולם את ההודעות שלו כדי שיתבייש.",{"revenge":T,"intent":T},["purpose"]),
("he","דיברתי עם השכן כבר שלוש פעמים על הרעש בלילות, והוא פשוט צוחק לי בפנים. אני כותב לוועד הבית כדי שיטפלו בזה.",{"rebuke":T,"purpose":T},["firsthand","rejects"]),
("he","הצלבתי את החשבוניות מול הדוח של הגזבר ויש פער של אלפי שקלים. שכולם בוועד יידעו לפני ההצבעה.",{"verified":T,"purpose":T},["firsthand"]),
("he","אין לי שום דרך אחרת להגן על הבת שלי חוץ מלספר להורים מה המדריך עושה. ניסיתי לדבר איתו והוא אמר שזה לא ענייני.",{"no_alternative":T,"purpose":T,"rebuke":T},["rejects"]),
("he","אני לא רוצה להשמיץ אף אחד, אבל המעסיק הקודם שלי לא שילם לי משכורת חודשיים. היזהרו לפני שאתם חותמים אצלו.",{"intent":F,"firsthand":T,"purpose":T},[]),
("he","שמעתי שמנהל הסניף מעלים קופות. עוד לא שאלתי אותו על זה ישירות.",{"firsthand":F,"rebuke":F},[]),
("he","האם מותר לי לכתוב בקבוצה שהגננת צועקת על הילדים? אני שואל לפני שאני עושה משהו.",{},[]),
("he","יוסי כתב בקבוצה 'אני אנקום בו על זה', ואני רק מעביר לכם את מה שהוא כתב.",{},["purpose"]),
("en","I watched the delivery guy throw our package over the fence myself. Please report him to the company so it stops happening to everyone on the street.",{"firsthand":T,"purpose":T},[]),
("en","Honestly I just want everyone to see what a joke Dan is, lol. He botched the presentation again.",{"intent":T},["purpose","firsthand"]),
("en","I called the clinic and two staff members confirmed the hygienist has no license. Don't book with her until this is sorted out.",{"verified":T,"purpose":T},[]),
("en","I already told Ronit twice that she can't take credit for my work, and she keeps doing it. There's no point talking to her again, she won't listen.",{"rebuke":T,"rejects":T},["firsthand"]),
("en","A friend forwarded me a screenshot saying the landlord keeps deposits. I haven't checked any of it.",{"firsthand":F,"verified":F},[]),
("en","Not trying to get back at him or anything, I just think the board needs to know the treasurer skipped the audit so they can fix it.",{"revenge":F,"purpose":T},["intent"]),
("en","If he ever does that again, maybe I'll tell his manager. For now I'm just thinking out loud.",{},[]),
("en","She embarrassed me at the wedding, so now it's my turn to make her pay. Spread this around.",{"revenge":T},["intent","purpose"]),
("en","The only way to stop him from scamming more seniors is to post this publicly, I tried everything else. He sold my grandmother a fake warranty.",{"no_alternative":T,"purpose":T},["firsthand","rebuke"]),
("en","Meeting moved to Thursday at 9, bring the budget slides.",{},[]),
("mixed","ראיתי בעצמי את ה-driver עושה texting בזמן נסיעה עם הילדים. Please tell the school so they find someone else.",{"firsthand":T,"purpose":T},[]),
("mixed","I heard from Maya שהמורה לפסנתר מאחר כל שיעור, but I didn't verify it.",{"firsthand":F,"verified":F},[]),
("mixed","דיברתי עם Avi על ה-comments שלו בישיבה, and he promised to stop. אני מעדכן את HR רק כדי שיהיה רשום.",{"rebuke":T},["purpose","rejects"]),
("mixed","Just for laughs, תראו מה נועה לבשה היום 😂",{"purpose":F},["intent"]),
("mixed","I'm 100% sure שהוא גונב, honestly. אין לי ראיות אבל.",{},["verified"]),
("mixed","בדקתי מול ה-bank statements, and the money never arrived. Warn the others before they pay him.",{"verified":T,"purpose":T},["firsthand"]),
("mixed","He will never accept criticism from me, I know him. אז אני פונה ישר למנהלת כדי שתעצור את זה.",{"rejects":T,"purpose":T},[]),
("mixed","אני לא כותב את זה מתוך כעס או נקמה, I just want the next tenant to know about the mold.",{"revenge":F,"purpose":T},["intent"]),
("mixed","Someone wrote in the group: 'בדקתי והוא באמת רמאי'. I have no idea who checked what.",{},[]),
("mixed","אני רוצה שכולם יצחקו עליו tomorrow at the party, תעבירו את הסרטון.",{"intent":T},["purpose"]),
]
out=[]
for i,(lang,text,expect,ok) in enumerate(ROWS):
    out.append(dict(id=f"sealed3-{i+1}",family=f"sealed3-{i+1}",language=lang,text=text,split="sealed_v3",
        synthetic=True,agent_reviewed=True,human_review_pending=True,source="agent_authored_sealed_v3",
        expect=expect,ok=ok))
(ROOT/"diverse"/"sealed_v3.jsonl").write_text("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in out),encoding="utf-8")
print(len(out),"rows")
