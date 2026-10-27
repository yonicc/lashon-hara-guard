"""Consolidate proposedNewFacts from Chafetz Chaim cards into a small vocabulary.

Run from this directory:  python -I consolidate_facts.py
Reads cards/*.json + facts.json, writes fact-merge-map.json, updates
facts.json (appending new facts only; existing ids are never changed)
and updates each card's factsNeeded/proposedNewFacts. Idempotent:
an existing fact-merge-map.json is preserved and extended.
"""
import json, glob, collections, pathlib

HERE = pathlib.Path(__file__).parent

NEW_FACTS = [
    ("message.medium_is_written", "האם הדברים נכתבים (צ'אט/מכתב/כתב) ולא רק נאמרים בעל פה?", 60, "low", False, None),
    ("message.is_praise", "האם ההודעה היא שבח על אדם (לרבות שבח מרובה או שבח בפני שונאיו)?", 61, "low", False, None),
    ("message.was_told_in_confidence", "האם הדברים נמסרו בסוד/בסתר או עם אזהרה שלא לגלות?", 62, "medium", False, None),
    ("message.has_favorable_interpretation", "האם יש למעשה או לדברים פירוש או צד זכות סביר?", 55, "low", False, None),
    ("message.about_past_or_family", "האם הדברים עוסקים במעשי עבר שתוקנו או במעשי אבות/משפחה?", 63, "medium", False, None),
    ("message.about_character_traits", "האם הדברים עוסקים במידות או באופי (גאווה, כעס וכדומה)?", 64, "low", False, None),
    ("message.denies_virtue_or_status", "האם הדברים שוללים מעלה/מעמד או עוסקים בחולשה הממעטת את המדובר?", 65, "medium", False, None),
    ("message.said_incidentally_without_intent", "האם הדברים נאמרו בדרך אגב/מסיח לפי תומו בלי כוונה לגנות?", 66, "low", False, None),
    ("subject.is_public_torah_figure", "האם המדובר הוא תלמיד חכם/מורה הוראה/רב/דרשן שהציבור סומך עליו?", 67, "medium", True, True),
    ("subject.is_established_wicked", "האם המדובר מוחזק ברבים כרשע/אפיקורס (ולא רק שמועה)?", 68, "high", True, True),
    ("subject.has_repented_or_reformed", "האם המדובר שב מדרכו או מתנהג עתה כשורה?", 69, "medium", True, True),
    ("subject.repeated_intentional_sin", "האם המדובר חזר במזיד כמה פעמים על עבירה מפורסמת?", 70, "high", True, True),
    ("matter.is_between_man_and_god", "האם העניין הוא בין אדם למקום (ולא בין אדם לחברו)?", 71, "low", False, None),
    ("matter.involves_money_dispute", "האם העניין עוסק בגזל/נזק/ממון/עסקה בין אנשים?", 72, "medium", False, None),
    ("audience.can_help_or_influence", "האם הנמענים יכולים לעזור, להשפיע או להוכיח את המדובר/הנפגע?", 45, "low", False, None),
    ("audience.is_close_to_speaker_or_subject", "האם הנמען הוא בן זוג/קרוב/שותף של הכותב או של המדובר?", 73, "medium", True, True),
    ("audience.includes_authorities_or_non_fellow", "האם בין הנמענים נכרים/שלטונות/ערכאות (חשש מלשינות)?", 74, "medium", False, None),
    ("listener.already_knew", "האם השומע כבר ידע את הדברים קודם?", 75, "low", False, None),
    ("listener.will_act_harmfully", "האם השומע צפוי לפעול/להזיק/לשנוא/להפסיד את המדובר על סמך הדברים?", 46, "medium", False, None),
    ("listener.can_leave_or_mute", "האם השומע יכול לעזוב/להשתיק/לחסום את השיחה בקלות?", 76, "low", False, None),
    ("listener.shows_agreement", "האם השומע מראה הסכמה או הנאה מהגנאי?", 77, "low", False, None),
    ("listener.judges_favorably", "האם השומע דן את המדובר לכף זכות?", 56, "low", False, None),
    ("evidence.has_recognizable_signs", "האם יש סימנים גלויים (דברים ניכרים) התומכים באמיתות הסיפור?", 57, "medium", False, None),
    ("evidence.multiple_firsthand_witnesses", "האם יש שני מספרים/עדים שראו בעצמם את העניין?", 58, "medium", False, None),
    ("speaker.was_pressured_to_tell", "האם הכותב הופצר/נלחץ/אוים לספר (לרבות חשש הפסד פרנסה)?", 78, "medium", False, None),
    ("speaker.is_minor", "האם הכותב/הדובר הוא קטין?", 79, "medium", True, True),
    ("speaker.motive_is_revenge_or_hatred", "האם מניע הכותב הוא נקמה/שנאה/הנאה מגנות המדובר?", 47, "medium", False, None),
    ("context.inquiry_has_future_purpose", "האם הבירור נועד לקשר עתידי (שידוך/שותפות/שכירות) או להגנה עתידית?", 48, "low", False, None),
    ("context.threat_of_planned_harm", "האם נשמעה תכנית ממשית לפגוע באדם (ולא גיזום בעלמא)?", 49, "medium", False, None),
]
NEW_IDS = {n[0] for n in NEW_FACTS}

REJECT_AGGREGATE = "שאלת-על מצטברת הנגזרת משאר העובדות, לא עובדה עצמאית לשאול"
REJECT_INTERNAL = "כוונה/הערכה פנימית או הכרעה הלכתית פרטנית שאין דרך אמינה לברר בצ'אט"
REJECT_POSTHOC = "עניין של תשובה/תיקון לאחר מעשה, לא נתון להחלת סעיף על הודעה"
REJECT_SPECIFIC = "פרט הלכתי/משפטי ספציפי (בית דין/קניינים/שיעורי אונאה) שאינו נחוץ בצ'אט"
REJECT_DEFAULT = "לא נחוץ להחלת סעיף על הודעת צ'אט, או שאין דרך לבררו מהמשתמש/ההקשר"

# Ordered (needles, target). First match wins. target in existing or NEW_IDS.
RULES = [
    (["all_conditions", "all_details", "details_fulfilled", "api_tlasa_details"], None),  # reject aggregate (handled below)
    (["teshuva."], None),
    (["listener.judges", "listener.judged", "judged_to_merit", "judges_to_merit", "removed_belief", "tried_to_remove_complaint"], "listener.judges_favorably"),
    (["can_be_judged_favorably", "favorable", "possible_merit", "has_possible_merit", "plausible_innocent", "act_has_plausible", "two_interpretations", "has_two_interpretations", "is_ambiguous", "ambiguous_interpretation", "has_ambiguous", "judgment_balance", "scale_tips", "judges_to_guilt", "judgment."], "message.has_favorable_interpretation"),
    (["medium_is_written"], "message.medium_is_written"),
    (["is_excessive_praise", "is_praise", "praise_may", "praise_before", "praise_leading"], "message.is_praise"),
    (["was_told_in_confidence", "was_told_as_secret", "told_in_secret", "in_confidence", "confidentiality", "warned_not", "warning_given", "warning_scope", "speaker_warned", "was_warned_not_to_relay", "permission_to_share"], "message.was_told_in_confidence"),
    (["has_repented", "now_behaves", "behaves_properly", "knows_subject_repentance", "subject_has_not_repent"], "subject.has_repented_or_reformed"),
    (["ancestors", "past_deeds", "past_misconduct", "corrected_past", "via_ancestors"], "message.about_past_or_family"),
    (["talmid_chacham", "moreh_horaah", "torah_preacher", "is_city_rabbi", "is_torah_preacher"], "subject.is_public_torah_figure"),
    (["is_apikores", "as_apikores", "apikorsut", "muchzak_as_rasha", "is_established_rasha", "established_as_apikores"], "subject.is_established_wicked"),
    (["repeated_intentional", "repeated_deliberate", "habitually_sins", "prone_to_repeat", "is_repeated_intentional", "habitual_offender"], "subject.repeated_intentional_sin"),
    (["bein_adam_lamakom", "between_man_and_god", "between_man_and_fellow", "is_bein_adam"], "matter.is_between_man_and_god"),
    (["onaah", "transaction", "theft_or_damage", "type_of_injustice", "interpersonal_withholding", "withheld_benefit", "sale_completed", "sale_", "is_finalized"], "matter.involves_money_dispute"),
    (["can_help_victim", "can_influence", "is_effective_rebuker", "can_refute", "can_calm_speaker", "audience.is_authority", "audience.is_city_judges", "listener_will_heed", "will_prevent_future", "deterrence_expected", "separate_from_prohibition"], "audience.can_help_or_influence"),
    (["is_minor", "is_child_of"], "speaker.is_minor"),
    (["spouse", "close_relative", "relative_of_speaker", "relative_of_listener", "relatives_of_subject", "relative_or_friend", "business_partner", "is_son_or_student", "son_or_student", "child_of_listener", "parent_of_victim", "parent_or_teacher", "parent_or_rabbi", "is_parent_or", "joint_interest"], "audience.is_close_to_speaker_or_subject"),
    (["non_jew", "non_fellow", "malshinut", "authorities", "to_authorities"], "audience.includes_authorities_or_non_fellow"),
    (["already_knew", "already_revealed", "knew_matter_not_actor", "realized_injustice", "already_spread_report"], "listener.already_knew"),
    (["will_act", "will_hate", "causes_hatred", "cause_hatred", "will_cause_harm", "intends_to_act", "intends_to_cause", "cause_grudge", "cause_material_harm", "cause_loss", "cause_mild_annoyance", "cause_benefit", "will_add_disparagement", "tendency_to_misuse", "listener_will_heed"], "listener.will_act_harmfully"),
    (["can_leave", "stays_voluntarily", "joined_after"], "listener.can_leave_or_mute"),
    (["shows_agreement", "level_of_acceptance"], "listener.shows_agreement"),
    (["dvarim", "recognizable_signs", "circumstantial", "suspicious_signs", "saw_directly", "testified_in_court", "independent_witnesses", "based_on_suspicion"], "evidence.has_recognizable_signs"),
    (["two_witnesses", "num_tellers", "are_two", "from_two", "count_is_two", "two_firsthand", "two_or_more", "like_two_witnesses", "trusted_as_two"], "evidence.multiple_firsthand_witnesses"),
    (["was_urged", "was_pressured", "pressured_speaker", "under_pressure", "requested_by_parent", "risk_of_job_loss", "risk_major_financial", "risk_of_loss_if", "fear_of_insults", "fear_of_subject", "can_harm_speaker", "has_fear_of"], "speaker.was_pressured_to_tell"),
    (["revenge", "motive_is_hatred", "motive_is_revenge", "enjoys_spread", "intent_to_cause_hatred", "intent_to_rekindle", "intent_is_revenge", "motive_is_peace"], "speaker.motive_is_revenge_or_hatred"),
    (["bad_middot"], "message.about_character_traits"),
    (["denies_virtue", "negation_of_virtue", "lack_of_wisdom", "physical_weakness", "financial_status", "diminishes_standing", "denial_of_virtue", "denial_of_virtues"], "message.denies_virtue_or_status"),
    (["mesich", "mesiah", "is_incidental", "within_other_discourse", "presented_as_innocent", "deceitful_innocence", "only_avak", "is_avak"], "message.said_incidentally_without_intent"),
    (["inquiry", "future_business", "future_warning", "asked_to_identify", "asked_who_harmed", "purpose_is_self_protection", "is_future_warning"], "context.inquiry_has_future_purpose"),
    (["threat.", "planned_harm"], "context.threat_of_planned_harm"),
    # existing vocabulary
    (["intent_to_disparage"], "speaker.intent_to_disparage"),
    (["would_say_in_subjects_presence", "causes_mild_annoyance_if_said"], "speaker.would_say_in_subjects_presence"),
    (["knows_first_hand", "heard_via", "via_intermediary", "is_rumor", "city_rumor", "rumor_col", "rumor_is_only", "directly_from_subject", "source_is_interested", "source_inferable", "reveals_source"], "speaker.knows_first_hand"),
    (["before_three", "known_to_many", "original_audience_size", "listener_count", "told_before_two", "made_in_front_of_three", "original_disclosure"], "audience.size_at_least_three"),
    (["already_known_to_many"], "matter.already_known_to_many"),
    (["includes_subject", "in_subjects_presence", "silent_in_presence", "subject_was_silent", "suspect_remained_silent", "remained_silent", "explicit_admission", "silent_in_presence"], "audience.includes_subject"),
    (["will_spread", "further_spread", "has_forwarded", "will_disclose_to_others", "already_spread"], "audience.listener_will_spread"),
    (["falsehood", "exaggeration", "omits_mitigating", "disclosure_only_deflects", "shifts_blame"], "message.contains_falsehood_or_exaggeration"),
    (["content_is_true", "facts_verified", "details_verified", "verified_in_beis", "verified_by", "established_as_impartial", "checked_halachic"], "toelet.facts_verified"),
    (["is_hint", "tone_indicates", "disparagement_recognizable", "vague_negative", "creates_suspicion"], "message.is_hint_or_implied"),
    (["said_in_jest", "lightheadedness"], "message.said_in_jest"),
    (["reports_what_someone_said"], "message.reports_what_someone_said_or_did_against_listener"),
    (["about_craft"], "message.about_craft_or_goods"),
    (["targets_torah", "about_torah_or", "torah_or_piety"], "message.about_torah_or_piety"),
    (["purpose_is_constructive", "deterrence", "saving_from_shame", "future_benefit_expected", "preemptive_warning", "is_to_separate"], "toelet.purpose_is_constructive"),
    (["rebuke_attempted", "rebuke_ineffective", "will_not_accept_rebuke", "not_accept_rebuke", "rebuke_would_be_heeded", "estimates_private_rebuke", "subject_will_not_accept"], "toelet.rebuke_attempted"),
    (["no_other_way"], "toelet.no_other_way"),
    (["no_excess_harm", "harm_is_only_withholding", "only_withholding_benefit"], "toelet.no_excess_harm"),
    (["needs_info_for_protection", "understands_from_start", "only_self_protection", "listener_will_heed"], "listener.needs_info_for_protection"),
    (["believes_report", "trusts_speaker", "reason_for_belief"], "listener.believes_report"),
    (["content_may_cause_harm", "harm_occurred", "expects_no_harm", "risk_of_expulsion", "disclosure_harms", "risk_of_malshinut", "risk_of_crooked", "risk_of_unlawful"], "message.content_may_cause_harm"),
    (["content_is_disparaging", "is_disparaging", "disparagement", "is_excessive"], "message.content_is_disparaging"),
    (["may_be_understood"], "message.may_be_understood_as_disparagement"),
    (["is_group"], "subject.is_group"),
    (["is_fellow"], "subject.is_fellow"),
    (["identifiable"], "subject.identifiable"),
]

def decide(pid):
    low = pid.lower()
    for needles, target in RULES:
        if any(n in low for n in needles):
            if target is None:
                reason = REJECT_AGGREGATE if not low.startswith("teshuva.") else REJECT_POSTHOC
                return {"action": "reject", "reason": reason}
            action = "new" if target in NEW_IDS else "merge"
            return {"action": action, "target": target, "reason": "מיזוג לפי משמעות" if action == "merge" else "עובדה חדשה נחוצה וניתנת לבירור בצ'אט"}
    # specific reject families
    if any(k in low for k in ["bet_din", "beit_din", "beis_din", "court", "judges", "kinyan", "sixth"]):
        return {"action": "reject", "reason": REJECT_SPECIFIC}
    if any(k in low for k in ["is_beinoni", "piety_level", "status_level", "is_yarei", "is_sinner_like", "habitual_speaker", "habitual_lashon", "regards_as_permitted", "planned_phrasing", "is_angry", "deliberated", "checked_halachic", "can_determine", "judgment_balance", "internal_conclusion", "sweetness"]):
        return {"action": "reject", "reason": REJECT_INTERNAL}
    return {"action": "reject", "reason": REJECT_DEFAULT}

def main():
    facts_path = HERE / "facts.json"
    data = json.loads(facts_path.read_text(encoding="utf-8"))
    existing_ids = [f["id"] for f in data["facts"]]
    assert len(existing_ids) == len(set(existing_ids))
    # append new facts (never touch existing entries)
    have = set(existing_ids)
    for fid, q, pri, sens, pers, conf in NEW_FACTS:
        if fid not in have:
            entry = {"id": fid, "questionHe": q, "priority": pri, "sensitivity": sens, "persistent": pers}
            if conf:
                entry["confirmedByUserOnly"] = True
            data["facts"].append(entry)
            have.add(fid)
    assert len(data["facts"]) <= 60, len(data["facts"])

    map_path = HERE / "fact-merge-map.json"
    merge_map = {}
    if map_path.exists():
        try:
            merge_map = json.loads(map_path.read_text(encoding="utf-8"))
        except Exception:
            merge_map = {}

    card_files = sorted((HERE / "cards").glob("*.json"))
    counts = collections.Counter()
    for cf in card_files:
        cards = json.loads(cf.read_text(encoding="utf-8"))
        for card in cards:
            kept = []
            for p in (card.get("proposedNewFacts") or []):
                pid = p["id"] if isinstance(p, dict) else p
                if pid not in merge_map:
                    merge_map[pid] = decide(pid)
                d = merge_map[pid]
                if d["action"] in ("merge", "new"):
                    if d["target"] not in card["factsNeeded"]:
                        card["factsNeeded"].append(d["target"])
                else:
                    kept.append(p)
            card["proposedNewFacts"] = kept
        cf.write_text(json.dumps(cards, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # validate map targets
    for pid, d in merge_map.items():
        if d["action"] in ("merge", "new"):
            assert d.get("target") in have, (pid, d)
    for d in merge_map.values():
        counts[d["action"]] += 1
    map_path.write_text(json.dumps(merge_map, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    # Preserve the original compact one-line style for entries that only
    # carry id+questionHe (the pre-existing vocabulary); new entries are expanded.
    lines = ["{", ' "status": ' + json.dumps(data.get("status"), ensure_ascii=False) + ",", ' "note": ' + json.dumps(data.get("note"), ensure_ascii=False) + ",", ' "facts": [']
    for i, f in enumerate(data["facts"]):
        comma = "," if i < len(data["facts"]) - 1 else ""
        if set(f.keys()) == {"id", "questionHe"}:
            lines.append("  " + json.dumps(f, ensure_ascii=False) + comma)
        else:
            lines.append("  " + json.dumps(f, ensure_ascii=False, indent=1).replace("\n", "\n  ") + comma)
    lines += [" ]", "}"]
    facts_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"proposed={len(merge_map)} merge={counts['merge']} new={counts['new']} reject={counts['reject']} total_facts={len(data['facts'])}")

if __name__ == "__main__":
    main()
