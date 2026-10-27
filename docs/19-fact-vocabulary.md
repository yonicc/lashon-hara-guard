# 19 — אוצר העובדות המאוחד (חפץ חיים)

## מספרים
- הוצעו בכרטיסים: 357 מזהים שונים (`proposedNewFacts`).
- מוזגו לעובדה קיימת: 55 הצעות.
- עובדות חדשות: 29 (185 הצעות מופו אליהן).
- נדחו: 117 הצעות, עם סיבה במפה.
- סך הכול ב־`facts.json`: 60 עובדות (31 קיימות שלא שונו + 29 חדשות).

כל ההכרעות ב־`rules/chafetz-chaim/fact-merge-map.json`: `{action: merge|new|reject, target?, reason}`.
הרצה חוזרת: `python -I rules/chafetz-chaim/consolidate_facts.py` (אידמפוטנטי, שומר מפה קיימת).

## העובדות החדשות לפי נושא
- **הודעה:** `message.medium_is_written`, `message.is_praise`, `message.was_told_in_confidence`, `message.has_favorable_interpretation`, `message.about_past_or_family`, `message.about_character_traits`, `message.denies_virtue_or_status`, `message.said_incidentally_without_intent`
- **מדובר:** `subject.is_public_torah_figure`, `subject.is_established_wicked`, `subject.has_repented_or_reformed`, `subject.repeated_intentional_sin`
- **עניין:** `matter.is_between_man_and_god`, `matter.involves_money_dispute`
- **קהל/שומע:** `audience.can_help_or_influence`, `audience.is_close_to_speaker_or_subject`, `audience.includes_authorities_or_non_fellow`, `listener.already_knew`, `listener.will_act_harmfully`, `listener.can_leave_or_mute`, `listener.shows_agreement`, `listener.judges_favorably`
- **ראיות:** `evidence.has_recognizable_signs`, `evidence.multiple_firsthand_witnesses`
- **כותב/הקשר:** `speaker.was_pressured_to_tell`, `speaker.is_minor`, `speaker.motive_is_revenge_or_hatred`, `context.inquiry_has_future_purpose`, `context.threat_of_planned_harm`

עובדות רגישות (`subject.*` חדשות, `audience.is_close_to_speaker_or_subject`, `speaker.is_minor`) סומנו `persistent` + `confirmedByUserOnly`.

## דחיות
שאלות־על מצטברות, כוונות/הכרעות פנימיות שאין לברר בצ'אט, פרטי בית דין/קניינים/אונאה, וענייני תשובה לאחר מעשה. הדחויות נשארות מתועדות בכרטיסים ב־`proposedNewFacts`.

## חיבור למנוע (הצעה, לא בוצע)
`FACT_CATALOG` ב־`engine/src/lessonScenario.ts` לא שונה. כשיוכרע, לייצר מפה מ־`facts.json` (60) לקטלוג המנוע בקובץ נפרד, בלי לשנות מזהים קיימים.
