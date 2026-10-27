import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Env } from '../src/handler.js';
import worker from '../src/index.js';
import type { ExtractorProvider } from '../../engine/src/index.js';
const env:Env={LHG_BRAIN_BASE_URL:'https://synthetic.test',LHG_BRAIN_TOKEN:'synthetic',LHG_ACCESS_KEY:'synthetic-key'};
const provider=():ExtractorProvider=>({id:'synthetic',modelVersion:'synthetic',async extract(){return {
 directAssessment:'no_concern', proposedFacts:[],analysis:{questionsHe:['one?','two?','three?']}};}});
async function check(confirmedFacts:Record<string,boolean|null>){
 const response=await handle(new Request('https://synthetic.test/check',{method:'POST',
 headers:{'content-type':'application/json','x-lhg-key':env.LHG_ACCESS_KEY},
 body:JSON.stringify({text:'synthetic expansion boundary',confirmedFacts})}),env,provider);
 assert.equal(response.status,200);
 return await response.json() as {alert:string;rules:{mode:string;notChecked?:boolean;findings:{ruleId:string}[];question?:unknown};analysis?:{questionsHe?:string[]}};
}
test('complete pack reaches handler: truthful non-disparaging report with no hostile intent',async()=>{
 const result=await check({'subject.identifiable':true,'subject.is_fellow':true,
 'message.reports_what_someone_said_or_did_against_listener':true,
 'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false,
 'speaker.intent_to_disparage':false,'message.content_is_true':true});
 assert.equal(result.rules.mode,'live_draft');assert.ok(!result.rules.notChecked);
 const ids=result.rules.findings.map(f=>f.ruleId);
 for(const id of ['cc-rechilut.1-02.report','cc-rechilut.1-03.no-intent','cc-rechilut.1-04.truth'])assert.ok(ids.includes(id),id);
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
 assert.ok(fear.rules.findings.some(f=>f.ruleId==='cc-context.10-08.retaliation-review'));
 assert.equal(fear.alert,'warn');
});
test('deployed worker entrypoint identifies the exact build and rejects malformed version headers',async()=>{
 const sha='a'.repeat(40);
 const response=await worker.fetch(new Request('https://synthetic.test/health'),{...env,LHG_BUILD_SHA:sha});
 assert.equal(response.headers.get('x-lhg-build-sha'),sha);
 assert.deepEqual(await response.json(),{ok:true});
 const malformed=await worker.fetch(new Request('https://synthetic.test/health'),{...env,LHG_BUILD_SHA:'bad\r\nheader'});
 assert.equal(malformed.headers.get('x-lhg-build-sha'),null);
});
