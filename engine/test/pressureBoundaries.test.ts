import test from 'node:test';
import assert from 'node:assert/strict';
// Predicate fixtures; actual referral boundaries are asserted by this helper too.
import { evaluatePredicates as evaluate } from './predicateFixture.js';
import {CC_ALL_DRAFT_PACK,FACT_CATALOG,factStoreFromExtraction,type EvaluationInput} from '../src/index.js';
import {validateExtraction} from '../src/extractor/validate.js';
const message:EvaluationInput['message']={id:'synthetic',revision:1,direction:'outgoing',
 authorRef:'user',platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'synthetic only'};
const cases: [string,string,string][]=[
 ['cc-speech.1-05.authority-request','context.parent_or_rabbi_requested_disclosure','1:5'],
 ['cc-speech.1-06.livelihood-pressure','speaker.risks_livelihood_for_refusing_disclosure','1:6'],
 ['cc-speech.1-07.social-pressure','speaker.fears_ridicule_for_refusing_disclosure','1:7'],
 ['cc-speech.1-09.self-disparagement','message.includes_same_self_disparagement','1:9'],
 ['cc-rechilut.1-05.authority-request','context.parent_or_rabbi_requested_disclosure','1:5'],
 ['cc-rechilut.1-06.livelihood-pressure','speaker.risks_livelihood_for_refusing_disclosure','1:6'],
 ['cc-rechilut.1-07.social-pressure','speaker.fears_ridicule_for_refusing_disclosure','1:7'],
];
for(const [id,fact,section] of cases) test(id+': source, true/false/missing/null/candidate/disputed and no cross-inference',()=>{
 const rule=CC_ALL_DRAFT_PACK.rules.find(r=>r.id===id)!;
 assert.equal(rule.source?.section,section);
 for(const state of [true,false,null,'missing','candidate','disputed'] as const) {
  const confirmed:Record<string,boolean|null>={'subject.identifiable':true,
   'message.content_is_disparaging':true,'message.reports_what_someone_said_or_did_against_listener':true,
   'speaker.was_pressured_to_tell':true,'subject.is_relative_of_speaker':true};
  if(state!=='missing') confirmed[fact]=typeof state==='string'?true:state;
  const extraction=validateExtraction({proposedFacts:[{id:fact,value:true,confidence:1,
   provenance:'model_extraction',evidenceExcerpt:'synthetic only'}]},FACT_CATALOG,'synthetic only');
  assert.equal(extraction.proposedFacts.length,0,'specific source context needs user confirmation');
  const store=factStoreFromExtraction(extraction,FACT_CATALOG,{confirmed});
  if(state==='candidate'||state==='disputed')store.facts.get(fact)!.status=state;
  const result=evaluate({message,facts:store.snapshot(),catalog:FACT_CATALOG,
   rulePack:{id:'test',version:'1',rules:[rule]},ruleMode:'live_draft',maxQuestions:1,
   contextVersion:'test',modelVersion:'test'});
  assert.equal(result.findings.length,state===true?1:0,String(state));
  assert.ok(result.questions.length<=1);
  if(state===true) assert.equal(result.findings[0]?.draft,true);
  if(state==='missing')assert.equal(result.questions[0]?.factId,fact,'general pressure cannot establish the precise cause');
 }
});
