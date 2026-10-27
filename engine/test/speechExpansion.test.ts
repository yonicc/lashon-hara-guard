import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, FACT_CATALOG, factStoreFromExtraction,
  type FactCatalogEntry, type FactRecord, type EvaluationInput } from '../src/index.js';
import { validateExtraction } from '../src/extractor/validate.js';
import { exprFactIds } from '../src/evalExpr.js';
import { validateRulePack } from '../src/validatePack.js';
import { CC_ALL_DRAFT_PACK } from '../src/chafetzChaim/allPacks.js';
import { CC_SPEECH_EXPANSION_DRAFT_PACK as pack } from '../src/chafetzChaim/speechExpansion.js';

const json = (path: string) => JSON.parse(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'));
const newFacts = json('rules/chafetz-chaim/speechExpansion.facts.json') as FactCatalogEntry[];
const vocabulary = json('rules/chafetz-chaim/facts.json').facts as FactCatalogEntry[];
const catalog = [...new Map([...vocabulary, ...FACT_CATALOG, ...newFacts].map(f => [f.id, f])).values()];
type Values = Record<string, boolean | null>;
const base: Values = { 'subject.identifiable': true, 'message.content_is_disparaging': true };
const repeat: Values = { 'context.repeats_prior_report': true };
const dual: Values = { 'message.content_is_disparaging': false, 'message.has_benign_and_disparaging_readings': true };
const religious: Values = { 'message.reports_religious_noncompliance': true, 'matter.is_between_man_and_god': true };
const average: Values = { 'subject.generally_observant_with_occasional_lapses': true };
const future: Values = { 'context.inquiry_has_future_purpose': true };
const favorable: Values = { 'message.has_favorable_interpretation': true };
const message: EvaluationInput['message'] = { id:'synthetic', revision:1, direction:'outgoing',
  authorRef:'user', platform:'test', conversationId:'synthetic', audienceSnapshot:{}, text:'synthetic only' };
function run(suffix: string, values: Values, change?: { id:string; status:FactRecord['status'] },
  mode: EvaluationInput['ruleMode'] = 'live_draft') {
  const rules = suffix === '*' ? pack.rules : pack.rules.filter(r => r.id.endsWith('.' + suffix));
  assert.ok(rules.length);
  const store = factStoreFromExtraction(undefined, catalog, { confirmed: { ...base, ...values } });
  if (change) { const f = store.facts.get(change.id); assert.ok(f); f.status = change.status; }
  return evaluate({ message, facts:store.snapshot(), catalog, rulePack:{...pack,rules},
    ruleMode:mode, maxQuestions:1, contextVersion:'test', modelVersion:'test' });
}
// Source-specific counterexamples: the final field must be known, independently of
// group size, first-hand knowledge of the underlying event, or declared benefit.
const cases: [string, Values, string][] = [
  ['authority-avak', {...dual,'context.parent_or_rabbi_requested_disclosure':true}, 'context.parent_or_rabbi_requested_disclosure'],
  ['dual-delivery', {...dual,'message.delivery_signals_disparagement':true}, 'message.delivery_signals_disparagement'],
  ['spread-intent', {...repeat,'speaker.intends_to_spread_report':true}, 'speaker.intends_to_spread_report'],
  ['incidental-only', {...repeat,'message.said_incidentally_without_intent':false}, 'message.said_incidentally_without_intent'],
  ['transmission-chain', {...repeat,'speaker.heard_original_report_before_three':false,'matter.already_known_to_many':false}, 'speaker.heard_original_report_before_three'],
  ['non-spreader', {...repeat,'audience.original_listener_withholds_report':true}, 'audience.original_listener_withholds_report'],
  ['locality', {...repeat,'context.report_crosses_locality':true}, 'context.report_crosses_locality'],
  ['warning-scope', {'message.was_told_in_confidence':true,'message.confidentiality_warning_is_general':true}, 'message.confidentiality_warning_is_general'],
  ['restricted-warning', {'message.was_told_in_confidence':true,'message.confidentiality_warning_is_general':false}, 'message.confidentiality_warning_is_general'],
  ['two-listeners', {...repeat,'context.original_report_had_only_two_listeners':true}, 'context.original_report_had_only_two_listeners'],
  ['amplification', {...repeat,'message.amplifies_prior_disparagement':true,'message.contains_falsehood_or_exaggeration':false}, 'message.amplifies_prior_disparagement'],
  ['expected-belief', {...repeat,'listener.expected_to_accept_report_as_fact':true,'listener.believes_report':false}, 'listener.expected_to_accept_report_as_fact'],
  ['institutional-blame', {'message.content_is_disparaging':false,'context.discloses_committee_dissent_to_shift_blame':true}, 'context.discloses_committee_dissent_to_shift_blame'],
  ['historical-minority', {'context.reports_historical_committee_minority':true}, 'context.reports_historical_committee_minority'],
  ['lecture-motive', {'message.critiques_torah_lecture':true,'message.attributes_exclusively_self_serving_motive':true}, 'message.attributes_exclusively_self_serving_motive'],
  ['self-disclosure', {'context.subject_disclosed_own_business_before_three':true}, 'context.subject_disclosed_own_business_before_three'],
  ['dual-presence', {...dual,'speaker.would_say_in_subjects_presence':true,'message.delivery_signals_disparagement':true}, 'message.delivery_signals_disparagement'],
  ['benign-delivery', {...dual,'message.delivery_signals_disparagement':false}, 'message.delivery_signals_disparagement'],
  ['indirect-harm', {'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false,'message.content_may_cause_harm':true,'speaker.intends_indirect_harm_by_neutral_report':true}, 'speaker.intends_indirect_harm_by_neutral_report'],
  ['feigned-innocence', {'speaker.feigns_innocence_while_disparaging':true,'message.said_incidentally_without_intent':false}, 'speaker.feigns_innocence_while_disparaging'],
  ['actual-no-harm', {'context.reviewing_already_sent_report':true,'toelet.disclosure_causes_actual_harm':false}, 'toelet.disclosure_causes_actual_harm'],
  ['god-fearing', {...favorable,'subject.known_as_god_fearing':true}, 'subject.known_as_god_fearing'],
  ['balanced-average', {...favorable,...average,'matter.interpretations_are_balanced':true,'matter.circumstances_favor_adverse_reading':false}, 'matter.interpretations_are_balanced'],
  ['adverse-average', {...favorable,...average,'matter.interpretations_are_balanced':false,'matter.circumstances_favor_adverse_reading':true}, 'matter.circumstances_favor_adverse_reading'],
  ['favorable-balance', {...favorable,'matter.interpretations_are_balanced':false,'matter.circumstances_favor_adverse_reading':false}, 'matter.circumstances_favor_adverse_reading'],
  ['personal-vs-public', {'speaker.personally_concludes_wrongdoing':true}, 'speaker.personally_concludes_wrongdoing'],
  ['recent-lapse', {...religious,'message.about_past_or_family':false}, 'message.about_past_or_family'],
  ['knowledge-of-law', {...religious,...average,'subject.may_not_know_prohibition_or_severity':true}, 'subject.may_not_know_prohibition_or_severity'],
  ['single-private', {...religious,...average,'matter.single_private_lapse':true,'context.disclosure_to_prevent_current_prohibition':false}, 'matter.single_private_lapse'],
  ['prevent-current', {...religious,'context.disclosure_to_prevent_current_prohibition':true}, 'context.disclosure_to_prevent_current_prohibition'],
  ['two-witnesses', {...religious,'toelet.knows_subject_will_not_accept_rebuke':true,'audience.can_influence_subject':true,'evidence.multiple_firsthand_witnesses':true}, 'evidence.multiple_firsthand_witnesses'],
  ['single-confidant', {...religious,'audience.is_speakers_trusted_rabbi':true,'evidence.multiple_firsthand_witnesses':false}, 'audience.is_speakers_trusted_rabbi'],
  ['mentor-leak', {...religious,'audience.is_speakers_trusted_rabbi':true,'audience.can_influence_subject':true,'audience.listener_will_spread':true}, 'audience.listener_will_spread'],
  ['one-event-two-seers', {...religious,'matter.single_private_lapse':true,'evidence.multiple_firsthand_witnesses':true}, 'matter.single_private_lapse'],
  ['repeated-deliberate', {'subject.repeated_intentional_sin':true}, 'subject.repeated_intentional_sin'],
  ['court-excuse', {'context.court_order_to_act_reported':true,'context.refusal_excuse_unresolved':true}, 'context.refusal_excuse_unresolved'],
  ['court-review', {'context.court_order_to_act_reported':true,'context.refusal_excuse_unresolved':false}, 'context.refusal_excuse_unresolved'],
  ['educational-purpose', {'audience.is_speakers_child_or_student':true,'toelet.risk_of_learning_bad_conduct':true,'toelet.purpose_is_constructive':true,'context.educational_purpose_explained_to_listener':false}, 'context.educational_purpose_explained_to_listener'],
  ['educational-motive', {'audience.is_speakers_child_or_student':true,'toelet.risk_of_learning_bad_conduct':true,'speaker.intent_to_disparage':true}, 'speaker.intent_to_disparage'],
  ['inquiry-disclosure', {...future,'context.inquiry_purpose_disclosed_to_respondent':false}, 'context.inquiry_purpose_disclosed_to_respondent'],
  ['respondent-conflict', {...future,'context.respondent_is_subject_enemy_or_competitor':true}, 'context.respondent_is_subject_enemy_or_competitor'],
  ['unrelated-inquiries', {...future,'context.inquiry_includes_unrelated_people':true}, 'context.inquiry_includes_unrelated_people'],
  ['inquiry-belief', {...future,'listener.believes_report':true}, 'listener.believes_report'],
  ['repair-harm', {'context.reviewing_already_sent_report':true,'toelet.disclosure_causes_actual_harm':true}, 'toelet.disclosure_causes_actual_harm'],
  ['repair-rejected', {'context.reviewing_already_sent_report':true,'toelet.disclosure_causes_actual_harm':false,'context.all_listeners_rejected_without_disparagement':true}, 'context.all_listeners_rejected_without_disparagement'],
  ['withheld-favor', {'message.reports_withheld_favor_without_active_harm':true,'toelet.purpose_is_constructive':false}, 'toelet.purpose_is_constructive'],
  ['revenge', {'message.reports_withheld_favor_without_active_harm':true,'speaker.motive_is_revenge_or_hatred':true}, 'speaker.motive_is_revenge_or_hatred'],
  ['peacemaking', {'message.denies_virtue_or_status':true,'speaker.explains_conduct_to_reduce_listener_hatred':true}, 'speaker.explains_conduct_to_reduce_listener_hatred'],
  ['prior-audience-status', {'message.about_torah_or_piety':true,'audience.previously_regarded_subject_as_torah_scholar':true}, 'audience.previously_regarded_subject_as_torah_scholar'],
  ['physical-weakness', {'message.about_physical_weakness':true,'message.content_may_cause_harm':true}, 'message.content_may_cause_harm'],
  ['credit', {'message.about_financial_means_or_debt':true,'message.content_may_cause_harm':true}, 'message.content_may_cause_harm'],
  ['relative-context', {'message.is_praise':false,'message.may_be_understood_as_disparagement':true}, 'message.may_be_understood_as_disparagement'],
  ['goods-disparagement', {'message.about_craft_or_goods':true,'message.content_may_cause_harm':false}, 'message.content_may_cause_harm'],
  ['joint-speakers', {'context.two_speakers_jointly_report':true}, 'context.two_speakers_jointly_report'],
  ['habit', {'speaker.reports_habitual_disparaging_speech':true}, 'speaker.reports_habitual_disparaging_speech'],
  ['habit-limits', {'speaker.reports_habitual_disparaging_speech':true}, 'speaker.reports_habitual_disparaging_speech'],
  ['small-audience', {'audience.size_at_least_three':false}, 'audience.size_at_least_three'],
  ['curiosity', {'context.inquiry_includes_unrelated_people':true,'context.inquiry_has_future_purpose':false}, 'context.inquiry_has_future_purpose'],
  ['minor-precept', {...religious}, 'message.reports_religious_noncompliance'],
  ['traits-knowledge', {'message.about_character_traits':true,'subject.may_not_know_prohibition_or_severity':true}, 'subject.may_not_know_prohibition_or_severity'],
  ['reformed-past', {...repeat,'message.about_past_or_family':true,'subject.has_repented_or_reformed':true}, 'subject.has_repented_or_reformed'],
  ['lecture-mockery', {'message.critiques_torah_lecture':true,'message.said_in_jest':true}, 'message.said_in_jest'],
  ['widespread-branch', {...repeat,'matter.already_known_to_many':true}, 'matter.already_known_to_many'],
  ['publicity-dispute', {...repeat,'speaker.heard_original_report_before_three':true}, 'speaker.heard_original_report_before_three'],
];
for (const [suffix, values, trigger] of cases) test('source branch: ' + suffix, () => {
  const matched = run(suffix, values);
  assert.equal(matched.findings.length, 1);
  assert.equal(matched.findings[0]!.draft, true);
  assert.match(matched.findings[0]!.messageHe, /טיוטה בלבד, לא פסק ולא היתר/);
  assert.equal(run(suffix, values, undefined, 'approved_only').findings.length, 0);
  const missing = { ...values }; delete missing[trigger];
  const unknown = run(suffix, missing);
  assert.equal(unknown.findings.length, 0);
  assert.equal(unknown.questions.length, 1);
  assert.equal(unknown.questions[0]!.factId, trigger);
  for (const status of ['candidate','disputed','unknown'] as const)
    assert.equal(run(suffix, values, {id:trigger,status}).findings.length, 0, status);
  if (typeof values[trigger] === 'boolean')
    assert.equal(run(suffix, {...values,[trigger]:!values[trigger]}).findings.length, 0);
});

test('source exceptions remain unknown until independently resolved', () => {
  for (const [suffix, values, exception] of [
    ['transmission-chain', {...repeat,'speaker.heard_original_report_before_three':false}, 'matter.already_known_to_many'],
    ['single-private', {...religious,...average,'matter.single_private_lapse':true}, 'context.disclosure_to_prevent_current_prohibition'],
  ] as [string,Values,string][]) {
    assert.equal(run(suffix, values).findings.length, 0);
    assert.equal(run(suffix, values).questions[0]?.factId, exception);
    assert.equal(run(suffix, {...values,[exception]:true}).findings.length, 0);
    assert.equal(run(suffix, {...values,[exception]:false}).findings.length, 1);
    assert.equal(run(suffix, {...values,[exception]:false},{id:exception,status:'disputed'}).findings.length, 0);
  }
});
test('facts about event knowledge, current audience and belief cannot substitute for source-specific facts', () => {
  const unrelated = {'speaker.knows_first_hand':true,'audience.size_at_least_three':true,
    'evidence.multiple_firsthand_witnesses':true,'listener.believes_report':true,
    'toelet.purpose_is_constructive':true};
  const result = run('transmission-chain', {...repeat,...unrelated,'matter.already_known_to_many':false});
  assert.equal(result.findings.length, 0);
  assert.equal(result.questions[0]?.factId, 'speaker.heard_original_report_before_three');
  assert.equal(run('expected-belief', {...repeat,...unrelated}).findings.length, 0);
  assert.equal(run('joint-speakers', unrelated).findings.length, 0);
  assert.equal(run('two-listeners', {...repeat,...unrelated}).findings.length, 0);
  assert.equal(run('self-disclosure', unrelated).findings.length, 0);
  assert.equal(run('educational-purpose', unrelated).findings.length, 0);
});
test('benign dual reading, actual disparagement and peacemaking remain distinct routes', () => {
  assert.equal(run('dual-delivery', {...dual,'message.content_is_disparaging':true,
    'message.delivery_signals_disparagement':true}).findings.length, 0);
  assert.equal(run('dual-delivery', {...dual,'message.delivery_signals_disparagement':false}).findings.length, 0);
  assert.equal(run('dual-presence', {...dual,'speaker.would_say_in_subjects_presence':true}).findings.length, 0);
  assert.equal(run('peacemaking', {'message.denies_virtue_or_status':true,
    'speaker.explains_conduct_to_reduce_listener_hatred':true}).findings.length, 1);
  assert.equal(run('balanced-average', {...favorable,...average,
    'matter.interpretations_are_balanced':false,'matter.circumstances_favor_adverse_reading':true}).findings.length, 0);
  assert.equal(run('adverse-average', {...favorable,...average,
    'matter.interpretations_are_balanced':true,'matter.circumstances_favor_adverse_reading':false}).findings.length, 0);
  for (const suffix of ['balanced-average','adverse-average','favorable-balance']) {
    assert.equal(run(suffix, {...favorable,...average,'matter.interpretations_are_balanced':true,
      'matter.circumstances_favor_adverse_reading':true}).findings.length,0,'contradictory balance');
    assert.equal(run(suffix, {...favorable,...average,'matter.interpretations_are_balanced':false}).findings.length,0,'missing direction');
  }
});
test('new vocabulary is user-only, sensitive, temporary and excluded from model admission', () => {
  const existing = new Set(vocabulary.map(f=>f.id));
  assert.equal(new Set(newFacts.map(f=>f.id)).size,newFacts.length);
  for (const f of newFacts) {
    assert.equal(existing.has(f.id),false,f.id);
    assert.equal(f.confirmedByUserOnly,true); assert.equal(f.sensitivity,'high'); assert.equal(f.persistent,false);
    assert.ok(f.valueType === undefined || f.valueType === 'boolean');
    for (const value of [true,false]) {
      const extraction=validateExtraction({proposedFacts:[{id:f.id,value,confidence:1,
        provenance:'model_extraction',evidenceExcerpt:'synthetic only'}]},catalog,'synthetic only');
      assert.equal(extraction.proposedFacts.length,0,f.id);
      assert.equal(factStoreFromExtraction(extraction,catalog).facts.has(f.id),false);
    }
  }
});
test('complete isolated pack is draft, source-linked, catalog-backed and not silently integrated', () => {
  assert.deepEqual(validateRulePack(pack), {valid:true,errors:[]});
  const baselineIds = new Set(CC_ALL_DRAFT_PACK.rules.map(r=>r.id));
  const catalogIds = new Set(catalog.map(f=>f.id));
  const used = new Set<string>();
  const covered = new Set(cases.map(c=>c[0]));
  for (const r of pack.rules) {
    assert.equal(baselineIds.has(r.id),false);
    assert.equal(r.reviewStatus,'draft'); assert.equal(r.domain,'halacha_draft');
    assert.equal(r.outcome.severity,'medium');
    assert.ok(r.source?.url?.startsWith('https://www.sefaria.org/'));
    assert.ok(covered.has(r.id.split('.').at(-1)!),'fixture missing '+r.id);
    const ids = [...exprFactIds(r.applicability),...exprFactIds(r.conditions),
      ...(r.exceptions??[]).flatMap(e=>[...exprFactIds(e)])];
    for (const id of ids) { assert.ok(catalogIds.has(id),id); used.add(id); }
  }
  for (const f of newFacts) assert.ok(used.has(f.id),'unused fact '+f.id);
  assert.ok(run('*',{}).questions.length<=1);
  assert.equal(run('*',{}).findings.length,0);
  assert.ok(run('*',{'subject.identifiable':false}).questions.length<=1);
});
test('coverage names every assigned source key and exactly the implemented additions', () => {
  const coverage = json('docs/speechExpansion-coverage.json');
  const baseline = json('engine/src/chafetzChaim/sourceCoverage.json');
  const assigned = baseline.sections.filter((s:{key:string})=>/^p1_prin[1-5]:/.test(s.key));
  assert.deepEqual(coverage.sections.map((s:{key:string})=>s.key).sort(),
    assigned.map((s:{key:string})=>s.key).sort());
  const ids = coverage.sections.flatMap((s:{addedRuleIds:string[]})=>s.addedRuleIds).sort();
  assert.deepEqual(ids,pack.rules.map(r=>r.id).sort());
  for (const s of coverage.sections) {
    assert.equal(s.complete,false);
    assert.ok(s.remainingDevelopmentHe.length);
    assert.ok(s.remainingExpertHe.length);
    for (const id of s.addedRuleIds) {
      const r=pack.rules.find(r=>r.id===id)!;
      assert.equal('p1_prin'+r.source!.principle!.replace('Principle ','')+':'+r.source!.section!.split(':')[1],s.key);
    }
  }
});
