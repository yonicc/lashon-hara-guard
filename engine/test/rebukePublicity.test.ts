import test from 'node:test';
import assert from 'node:assert/strict';
// Predicate fixtures; actual referral boundaries are asserted by this helper too.
import { evaluatePredicates as evaluate } from './predicateFixture.js';
import { CC_ALL_DRAFT_PACK, CC_TOELET_CONDITIONS, FACT_CATALOG, evalExpr,
 factStoreFromExtraction, type EvaluationInput } from '../src/index.js';
import { validateExtraction } from '../src/extractor/validate.js';
const message: EvaluationInput['message']={id:'synthetic',revision:1,direction:'outgoing',
 authorRef:'user',platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'synthetic only'};
const fear='speaker.fears_retaliation_from_subject';
const reputation=['speaker.publicly_known_impartial','speaker.publicly_known_says_in_presence',
 'speaker.publicly_known_fearless','speaker.publicly_known_truthful'];
const id='cc-context.10-07.public-rebuke-exception';
const base={'subject.identifiable':true,'message.content_is_disparaging':true,
 'toelet.purpose_is_constructive':true,'toelet.rebuke_attempted':false,
 'toelet.knows_subject_will_not_accept_rebuke':true,'audience.size_at_least_three':false};
const rep=(value:boolean)=>Object.fromEntries(reputation.map(f=>[f,value]));
function run(values:Record<string,boolean|null>,ruleId=id,status?:'candidate'|'disputed') {
 const validated=validateExtraction({proposedFacts:[]},FACT_CATALOG,'synthetic only');
 const store=factStoreFromExtraction(validated,FACT_CATALOG,{confirmed:values});
 if(status) for(const f of [fear,...reputation]) {
  const fact=store.facts.get(f); if(fact) fact.status=status;
 }
 return evaluate({message,facts:store.snapshot(),catalog:FACT_CATALOG,
  rulePack:{...CC_ALL_DRAFT_PACK,rules:CC_ALL_DRAFT_PACK.rules.filter(r=>r.id===ruleId)},
  ruleMode:'live_draft',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
}
test('publicity warning requires both source exceptions to be known false',()=>{
 const result=run({...base,[fear]:false,...rep(false)});
 assert.equal(result.findings.length,1); assert.equal(result.findings[0]?.draft,true);
 for(const value of [true,null]) assert.equal(run({...base,...rep(false),[fear]:value}).findings.length,0);
 assert.equal(run({...base,...rep(false)}).findings.length,0);
 assert.equal(run({...base,[fear]:false,...rep(true)}).findings.length,0);
 for(const field of reputation) {
  const values={...base,[fear]:false,...rep(true),[field]:null};
  const result=run(values);
  assert.equal(result.findings.length,0,field); assert.equal(result.questions.length,1);
  assert.equal(result.questions[0]?.factId,field);
  assert.equal(run({...values,[field]:false}).findings.length,1,field+' independently required');
 }
 for(const status of ['candidate','disputed'] as const) {
  const result=run({...base,[fear]:false,...rep(true)},id,status);
  assert.equal(result.findings.length,0); assert.ok(result.questions.length<=1);
 }
});
test('group size and ineffective rebuke never imply fear or public reputation',()=>{
 for(const size of [true,false,null]) for(const knows of [true,false,null]) {
  const result=run({...base,'audience.size_at_least_three':size,
   'toelet.knows_subject_will_not_accept_rebuke':knows});
  assert.equal(result.findings.length,0); assert.ok(result.questions.length<=1);
 }
});
test('source 8 is a review reminder and cannot establish the cumulative conditions',()=>{
 const result=run({...base,[fear]:true},'cc-context.10-08.retaliation-review');
 assert.equal(result.findings.length,1); assert.match(result.findings[0]!.messageHe,/מומחה/);
 const conditions={...base,[fear]:true,...rep(false),'speaker.knows_first_hand':true,
 'speaker.checked_halachic_classification':true,'message.contains_falsehood_or_exaggeration':false,
 'speaker.intent_to_disparage':false,'speaker.motive_is_revenge_or_hatred':false,
 'toelet.no_other_way':true,'toelet.no_excess_harm':true};
 assert.equal(evalExpr(CC_TOELET_CONDITIONS,factStoreFromExtraction(undefined,FACT_CATALOG,{confirmed:conditions}).snapshot()),false);
});
test('source 9 reputation affects only publicity; all other cumulative facts remain necessary',()=>{
 const values={...base,...rep(true),'speaker.knows_first_hand':true,
 'speaker.checked_halachic_classification':true,'message.contains_falsehood_or_exaggeration':false,
 'speaker.intent_to_disparage':false,'speaker.motive_is_revenge_or_hatred':false,
 'toelet.no_other_way':true,'toelet.no_excess_harm':true};
 const store=(v:Record<string,boolean|null>)=>factStoreFromExtraction(undefined,FACT_CATALOG,{confirmed:v}).snapshot();
 assert.equal(evalExpr(CC_TOELET_CONDITIONS,store(values)),true);
 for(const field of ['speaker.checked_halachic_classification','toelet.no_other_way','toelet.no_excess_harm'])
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,store({...values,[field]:false})),false,field);
 assert.equal(run(values,'cc-context.10-09.established-speaker').findings.length,1);
});
test('all five new facts are source-specific user-only and model proposals cannot establish exceptions',()=>{
 for(const field of [fear,...reputation]) {
  const entry=FACT_CATALOG.find(f=>f.id===field)!;
  assert.equal(entry.confirmedByUserOnly,true); assert.equal(entry.persistent,false);
  for(const value of [true,false]) {
   const extraction=validateExtraction({proposedFacts:[{id:field,value,confidence:1,
    provenance:'model_extraction',evidenceExcerpt:'synthetic only'}]},FACT_CATALOG,'synthetic only');
   assert.equal(extraction.proposedFacts.length,0);
   assert.equal(factStoreFromExtraction(extraction,FACT_CATALOG).facts.has(field),false);
  }
 }
});
