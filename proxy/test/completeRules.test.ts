import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Env } from '../src/handler.js';
import worker from '../src/index.js';
import type { ExtractorProvider } from '../../engine/src/index.js';
import { CC_ALL_DRAFT_PACK, coverageKeyOfSource, isGroupDSource } from '../../engine/src/index.js';
function assertRouted(result: { rules: { findings: {ruleId:string}[]; referrals?: {sectionKey:string}[] } }, id:string) {
 const rule=CC_ALL_DRAFT_PACK.rules.find(r=>r.id===id)!;
 if(isGroupDSource(rule.source)) {
  assert.ok(!result.rules.findings.some(f=>f.ruleId===id),id+' must not be a finding');
  assert.ok(result.rules.referrals?.some(r=>r.sectionKey===coverageKeyOfSource(rule.source)),id+' referral');
 } else assert.ok(result.rules.findings.some(f=>f.ruleId===id),id);
}
const env:Env={LHG_BRAIN_BASE_URL:'https://synthetic.test',LHG_BRAIN_TOKEN:'synthetic',LHG_ACCESS_KEY:'synthetic-key'};
test('final pack reaches real handler without disparagement or direct-against-listener classification',async()=>{
 const result=await check({'subject.identifiable':true,'message.content_is_disparaging':false,
 'message.may_be_understood_as_disparagement':false,
 'message.reports_what_someone_said_or_did_against_listener':false,
 'message.confirms_prior_report_from_second_source':true});
 assert.ok(!result.rules.notChecked);
 assert.ok(result.rules.findings.some(f=>f.ruleId==='cc-final.p2_prin4-2'));
 assert.equal(result.alert,'warn');
 assert.ok(Number(!!result.rules.question)+(result.analysis?.questionsHe?.length??0)<=1);
});
test('integrated child chain distinguishes event knowledge from original publication',async()=>{
 const result=await check({'subject.identifiable':true,'message.content_is_disparaging':true,
 'context.repeats_prior_report':true,'speaker.knows_first_hand':true,
 'speaker.heard_original_report_before_three':false,'matter.already_known_to_many':false});
 assert.ok(!result.rules.notChecked);
 assertRouted(result,'cc-speech-expansion.2-04.transmission-chain');
 assert.ok(Number(!!result.rules.question)+(result.analysis?.questionsHe?.length??0)<=1);
});
test('new source-specific context remains unknown rather than inferred false or a permit',async()=>{
 for(const value of [false,null]){
  const result=await check({'subject.identifiable':true,'message.content_is_disparaging':false,
  'message.may_be_understood_as_disparagement':false,
  'message.reports_what_someone_said_or_did_against_listener':false,
  'message.confirms_prior_report_from_second_source':value});
  assert.ok(!result.rules.findings.some(f=>f.ruleId==='cc-final.p2_prin4-2'));
  assert.ok(Number(!!result.rules.question)+(result.analysis?.questionsHe?.length??0)<=1);
 }
});
const provider=():ExtractorProvider=>({id:'synthetic',modelVersion:'synthetic',async extract(){return {
 directAssessment:'no_concern', proposedFacts:[],analysis:{questionsHe:['one?','two?','three?']}};}});
async function check(confirmedFacts:Record<string,boolean|null>){
 const response=await handle(new Request('https://synthetic.test/check',{method:'POST',
 headers:{'content-type':'application/json','x-lhg-key':env.LHG_ACCESS_KEY},
 body:JSON.stringify({text:'synthetic expansion boundary',confirmedFacts})}),env,provider);
 assert.equal(response.status,200);
 return await response.json() as {alert:string;rules:{mode:string;notChecked?:boolean;findings:{ruleId:string}[];referrals?:{sectionKey:string}[];question?:unknown};analysis?:{questionsHe?:string[]}};
}
test('complete pack reaches handler: truthful non-disparaging report with no hostile intent',async()=>{
 const result=await check({'subject.identifiable':true,'subject.is_fellow':true,
 'message.reports_what_someone_said_or_did_against_listener':true,
 'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false,
 'speaker.intent_to_disparage':false,'message.content_is_true':true});
 assert.equal(result.rules.mode,'live_draft');assert.ok(!result.rules.notChecked);
 const ids=result.rules.findings.map(f=>f.ruleId);
 for(const id of ['cc-rechilut.1-02.report','cc-rechilut.1-03.no-intent','cc-rechilut.1-04.truth'])assertRouted(result,id);
 assert.equal(result.alert,'warn');
 assert.ok(Number(!!result.rules.question)+(result.analysis?.questionsHe?.length??0)<=1);
});
test('handler does not flag an authorized non-disparaging confidence',async()=>{
 const result=await check({'subject.identifiable':true,'message.was_told_in_confidence':true,
 'message.disclosure_authorized':true,'message.content_is_disparaging':false,
 'message.may_be_understood_as_disparagement':false,'message.content_may_cause_harm':false,
 'message.reports_what_someone_said_or_did_against_listener':false});
 assert.ok(!result.rules.findings.some(f=>/secret|confidence|authorization/.test(f.ruleId)));
 assert.equal(result.alert,'none');
});
test('handler exposes new preventive-benefit distinction even when purpose is constructive',async()=>{
 const result=await check({'subject.identifiable':true,'toelet.purpose_is_constructive':true,
 'context.threat_of_planned_harm':true,'toelet.future_benefit_expected':false});
 assert.equal(result.alert,'warn');
 assert.ok(result.rules.findings.some(f=>f.ruleId==='cc-prevention.9-02.expected-benefit'));
});
test('handler asks about publicity exceptions and respects confirmed fear without a permit',async()=>{
 const base={'subject.identifiable':true,'message.content_is_disparaging':true,
  'toelet.purpose_is_constructive':true,'toelet.rebuke_attempted':false,
  'toelet.knows_subject_will_not_accept_rebuke':true,'audience.size_at_least_three':false};
 const unknown=await check(base);
 assert.ok(!unknown.rules.findings.some(f=>f.ruleId==='cc-context.10-07.public-rebuke-exception'));
 assert.ok(Number(!!unknown.rules.question)+(unknown.analysis?.questionsHe?.length??0)<=1);
 const fear=await check({...base,'speaker.fears_retaliation_from_subject':true});
 assert.ok(!fear.rules.findings.some(f=>f.ruleId==='cc-context.10-07.public-rebuke-exception'));
 assertRouted(fear,'cc-context.10-08.retaliation-review');
 assert.equal(fear.alert,'unsure');
});
test('deployed worker entrypoint identifies the exact build and rejects malformed version headers',async()=>{
 const sha='a'.repeat(40);
 const response=await worker.fetch(new Request('https://synthetic.test/health'),{...env,LHG_BUILD_SHA:sha});
 assert.equal(response.headers.get('x-lhg-build-sha'),sha);
 assert.deepEqual(await response.json(),{ok:true});
 const malformed=await worker.fetch(new Request('https://synthetic.test/health'),{...env,LHG_BUILD_SHA:'bad\r\nheader'});
 assert.equal(malformed.headers.get('x-lhg-build-sha'),null);
});

test('handler reaches indirect report and informant branches without disparagement or direct rechilut',async()=>{
 const result=await check({'subject.identifiable':true,
 'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false,
 'message.reports_what_someone_said_or_did_against_listener':false,
 'message.reports_action_against_third_party':true,
 'message.identifies_informant_to_original_speaker':true});
 assert.ok(!result.rules.notChecked);
 for(const id of ['cc-clarification.r3-03.chain','cc-clarification.r3-02.informant'])
  assert.ok(result.rules.findings.some(f=>f.ruleId===id),id);
 assert.equal(result.alert,'warn');
 assert.ok(Number(!!result.rules.question)+(result.analysis?.questionsHe?.length??0)<=1);
});
test('handler separates actual delivery and receiver signs from speaker first-hand knowledge',async()=>{
 const result=await check({'subject.identifiable':true,'message.has_two_interpretations':true,
 'message.delivery_conveys_disparaging_interpretation':true,
 'speaker.would_say_in_subjects_presence':true,'speaker.knows_first_hand':true,
 'listener.role_is_receiving':true,'evidence.has_recognizable_signs':true,
 'listener.personally_observed_signs':false,'evidence.signs_directly_relate_to_report':false});
 for(const id of ['cc-clarification.3-02.delivery','cc-clarification.7-11.personal-signs','cc-clarification.7-11.direct-signs'])
  assertRouted(result,id);
 assert.ok(Number(!!result.rules.question)+(result.analysis?.questionsHe?.length??0)<=1);
});
test('handler checks inquiry source independently of constructive purpose',async()=>{
 const result=await check({'subject.identifiable':true,'context.inquiry_has_future_purpose':true,
 'toelet.purpose_is_constructive':true,'context.inquiry_purpose_disclosed_to_source':false,
 'context.inquiry_source_has_conflict_of_interest':true});
 for(const id of ['cc-clarification.4-11.disclose-purpose','cc-clarification.4-11.source-conflict'])
  assert.ok(result.rules.findings.some(f=>f.ruleId===id),id);
 assert.equal(result.alert,'warn');
});
