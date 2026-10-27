import test from 'node:test';
import assert from 'node:assert/strict';
import { CC_ALL_DRAFT_PACK, FACT_CATALOG, evaluate, factStoreFromExtraction, type EvaluationInput } from '../src/index.js';

const message: EvaluationInput['message'] = { id:'synthetic', revision:1, direction:'outgoing', authorRef:'user',
 platform:'test', conversationId:'synthetic', audienceSnapshot:{}, text:'synthetic source boundary' };
function run(confirmed: Record<string,boolean|null>, only?: string) {
 const store=factStoreFromExtraction(undefined,FACT_CATALOG,{confirmed});
 return evaluate({message,facts:store.snapshot(),catalog:FACT_CATALOG,ruleMode:'live_draft',maxQuestions:1,
  contextVersion:'test',modelVersion:'test',rulePack:only?{...CC_ALL_DRAFT_PACK,rules:CC_ALL_DRAFT_PACK.rules.filter(r=>r.id===only)}:CC_ALL_DRAFT_PACK});
}
const preventive={'subject.identifiable':true,'toelet.purpose_is_constructive':true,'context.threat_of_planned_harm':true};

test('authorized confidence causes no secret warning; unauthorized and unanswered permission stay distinct',()=>{
 const base={'subject.identifiable':true,'message.was_told_in_confidence':true,
  'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false,
  'message.content_may_cause_harm':false,'message.reports_what_someone_said_or_did_against_listener':false};
 const source=CC_ALL_DRAFT_PACK.rules.find(r=>r.id==='cc-rechilut.8-05.secret')!.source!.url;
 const authorized=run({...base,'message.disclosure_authorized':true});
 assert.equal(authorized.findings.filter(f=>f.source?.url===source).length,0);
 const denied=run({...base,'message.disclosure_authorized':false});
 assert.equal(denied.findings.filter(f=>f.source?.url===source).length,1,'one canonical secret rule');
 const unknown=run({...base,'message.disclosure_authorized':null},'cc-rechilut.8-05.secret');
 assert.equal(unknown.findings.length,0);
 assert.equal(unknown.questions[0]?.factId,'message.disclosure_authorized');
});

test('preventive purpose never substitutes for expected benefit',()=>{
 const id='cc-prevention.9-02.expected-benefit';
 const noBenefit=run({...preventive,'toelet.future_benefit_expected':false},id);
 assert.equal(noBenefit.findings[0]?.ruleId,id);
 assert.equal(run({...preventive,'toelet.future_benefit_expected':true},id).findings.length,0);
 const unknown=run(preventive,id);
 assert.equal(unknown.findings.length,0);
 assert.equal(unknown.questions[0]?.factId,'toelet.future_benefit_expected');
});

test('verified truth never substitutes for examining whether the matter is harmful',()=>{
 const id='cc-prevention.9-02.examination';
 const knownTruth={...preventive,'toelet.facts_verified':true,'message.content_is_true':true};
 const unknown=run(knownTruth,id);
 assert.equal(unknown.findings.length,0);
 assert.equal(unknown.questions[0]?.factId,'speaker.examined_matter_as_harmful');
 assert.equal(run({...knownTruth,'speaker.examined_matter_as_harmful':false},id).findings[0]?.ruleId,id);
});

test('actual harm still requires sections 5-6 even when it does not exceed the law',()=>{
 const id='cc-prevention.9-02.actual-harm';
 const base={...preventive,'toelet.no_excess_harm':true};
 assert.equal(run({...base,'toelet.disclosure_causes_actual_harm':true},id).findings[0]?.ruleId,id);
 assert.equal(run({...base,'toelet.disclosure_causes_actual_harm':false},id).findings.length,0);
 const unknown=run(base,id);
 assert.equal(unknown.findings.length,0);
 assert.equal(unknown.questions[0]?.factId,'toelet.disclosure_causes_actual_harm');
});

test('unknown publicity exceptions block the warning and ask at most one question',()=>{
 const result=run({'subject.identifiable':true,'message.content_is_disparaging':true,
  'toelet.purpose_is_constructive':true,'toelet.rebuke_attempted':false,
  'toelet.knows_subject_will_not_accept_rebuke':true,'audience.size_at_least_three':false});
 assert.ok(CC_ALL_DRAFT_PACK.rules.some(r=>r.id==='cc-context.10-07.public-rebuke-exception'));
 assert.ok(!result.findings.some(f=>f.ruleId==='cc-toelet.10-02c.rebuke-first'));
 assert.ok(!result.findings.some(f=>f.source?.section==='10:7'));
 assert.ok(!result.findings.some(f=>f.source?.section==='10:8'||f.source?.section==='10:9'));
 assert.equal(result.questions.length,1);
});
