import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,FACT_CATALOG,factStoreFromExtraction,type FactRecord} from '../src/index.js';
import {validateExtraction} from '../src/extractor/validate.js';
import {CC_ALL_DRAFT_PACK} from '../src/chafetzChaim/allPacks.js';
import {CC_FINAL_DRAFT_PACK,FINAL_CASES} from '../src/chafetzChaim/finalPack.js';
const message={id:'synthetic',revision:1,direction:'outgoing' as const,authorRef:'user',platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'synthetic only'};
const gates:Record<string,Record<string,boolean>>={identified:{},speech:{'message.content_is_disparaging':true},rechilut:{'message.reports_what_someone_said_or_did_against_listener':true},receiving:{'listener.role_is_receiving':true},public:{'audience.size_at_least_three':true},repair:{'listener.role_is_receiving':true,'context.reviewing_already_sent_report':true}};
for(const [key,id,,,,gate] of FINAL_CASES) test('FINAL '+key+' context admission and uncertainty through full pack',()=>{
 const ruleId='cc-final.'+key.replace(':','-');
 const defaults={'subject.identifiable':true,...gates[gate]};
 for(const state of ['true','false','null','missing','candidate','disputed'] as const){
  const values:Record<string,boolean|null>={...defaults};
  if(state!=='missing')values[id]=state==='false'?false:state==='null'?null:true;
  const extraction=validateExtraction({proposedFacts:[]},FACT_CATALOG,'synthetic only');
  const store=factStoreFromExtraction(extraction,FACT_CATALOG,{confirmed:values});
  if(state==='candidate'||state==='disputed')store.facts.get(id)!.status=state as FactRecord['status'];
  const result=evaluate({message,facts:store.snapshot(),catalog:FACT_CATALOG,rulePack:CC_ALL_DRAFT_PACK,ruleMode:'live_draft',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
  assert.equal(result.findings.some(f=>f.ruleId===ruleId),state==='true',key+' '+state);
  assert.ok(result.questions.length<=1);assert.ok(result.findings.every(f=>f.draft));
 }
 const catalog=FACT_CATALOG.find(f=>f.id===id)!;
 // Existing extracted text facts retain their original policy; all newly introduced context is user-only.
 if(catalog.confirmedByUserOnly)for(const value of [true,false]){
  const e=validateExtraction({proposedFacts:[{id,value,confidence:1,provenance:'model_extraction',evidenceExcerpt:'synthetic only'}]},FACT_CATALOG,'synthetic only');
  assert.equal(e.proposedFacts.length,0,id);
 }
 const store=factStoreFromExtraction(undefined,FACT_CATALOG,{confirmed:{...defaults,[id]:true,'subject.identifiable':false}});
 const result=evaluate({message,facts:store.snapshot(),catalog:FACT_CATALOG,rulePack:CC_FINAL_DRAFT_PACK,ruleMode:'live_draft',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
 assert.equal(result.findings.length,0,'unidentified');
});
