import test from 'node:test';
import assert from 'node:assert/strict';
import {CC_ALL_DRAFT_PACK, FACT_CATALOG, evaluate, factStoreFromExtraction, type EvaluationInput} from '../src/index.js';
import {CC_CLARIFICATION_DRAFT_PACK} from '../src/chafetzChaim/clarificationPack.js';
import {validateExtraction} from '../src/extractor/validate.js';
const message:EvaluationInput['message']={id:'synthetic',revision:1,direction:'incoming',authorRef:'synthetic',platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'synthetic only'};
const yes = (id:string) => ({[id]:true});
const cases:[string,string,boolean,Record<string,boolean>][]=[
 ['3-02.delivery','message.delivery_conveys_disparaging_interpretation',true,yes('message.has_two_interpretations')],
 ['r2-02.delivery','message.delivery_conveys_disparaging_interpretation',true,{...yes('message.has_two_interpretations'),...yes('message.reports_what_someone_said_or_did_against_listener')}],
 ['r2-02.prior-conflict','audience.has_prior_conflict_with_reported_actor',true,{...yes('message.has_two_interpretations'),...yes('message.reports_what_someone_said_or_did_against_listener')}],
 ['r3-02.informant','message.identifies_informant_to_original_speaker',true,{}],
 ['r3-03.chain','message.reports_action_against_third_party',true,{}],
 ['r9-09.indirect-benefit','message.reports_action_against_third_party',true,yes('toelet.purpose_is_constructive')],
 ['7-11.direct-signs','evidence.signs_directly_relate_to_report',false,{...yes('listener.role_is_receiving'),...yes('evidence.has_recognizable_signs')}],
 ['7-11.personal-signs','listener.personally_observed_signs',false,{...yes('listener.role_is_receiving'),...yes('evidence.has_recognizable_signs')}],
 ['7-12.relay','listener.plans_to_relay_report',true,{...yes('listener.role_is_receiving'),...yes('evidence.has_recognizable_signs')}],
 ['r6-09.direct-signs','evidence.signs_directly_relate_to_report',false,{...yes('listener.role_is_receiving'),...yes('evidence.has_recognizable_signs'),...yes('message.reports_what_someone_said_or_did_against_listener')}],
 ['r6-09.personal-signs','listener.personally_observed_signs',false,{...yes('listener.role_is_receiving'),...yes('evidence.has_recognizable_signs'),...yes('message.reports_what_someone_said_or_did_against_listener')}],
 ['r6-09.relay','listener.plans_to_relay_report',true,{...yes('listener.role_is_receiving'),...yes('evidence.has_recognizable_signs'),...yes('message.reports_what_someone_said_or_did_against_listener')}],
 ['4-11.disclose-purpose','context.inquiry_purpose_disclosed_to_source',false,yes('context.inquiry_has_future_purpose')],
 ['4-11.source-conflict','context.inquiry_source_has_conflict_of_interest',true,yes('context.inquiry_has_future_purpose')],
];
function run(confirmed:Record<string,boolean|null>, stateFact?:string, state?:string) {
 const extraction=validateExtraction({},FACT_CATALOG,'synthetic only');
 const store=factStoreFromExtraction(extraction,FACT_CATALOG,{confirmed});
 if(stateFact && (state==='candidate'||state==='disputed'))store.facts.get(stateFact)!.status=state;
 return evaluate({message,facts:store.snapshot(),catalog:FACT_CATALOG,rulePack:CC_ALL_DRAFT_PACK,
 ruleMode:'live_draft',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
}
for(const [suffix,fact,trigger,base] of cases)test(suffix+': user states and applicability through full pack',()=>{
 const id='cc-clarification.'+suffix;
 assert.ok(CC_CLARIFICATION_DRAFT_PACK.rules.some(r=>r.id===id));
 for(const state of [true,false,null,'missing','candidate','disputed'] as const) {
  const confirmed:Record<string,boolean|null>={'subject.identifiable':true,
   'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false,
   'speaker.knows_first_hand':true,'speaker.would_say_in_subjects_presence':true,...base};
  if(state!=='missing')confirmed[fact]=typeof state==='string'?trigger:state;
  const r=run(confirmed,fact,typeof state==='string'?state:undefined);
  assert.equal(r.findings.some(f=>f.ruleId===id),state===trigger,String(state));
  assert.ok(r.questions.length<=1);
  assert.ok(r.findings.every(f=>f.draft));
  // Knowing the speaker's first-hand status or willingness to speak in presence
  // must not fill receiver-specific signs or delivery context.
  const withoutIdentity=run({...confirmed,'subject.identifiable':false},fact,typeof state==='string'?state:undefined);
  assert.equal(withoutIdentity.findings.some(f=>f.ruleId===id),false);
 }
});
test('all ten context facts require user confirmation and retain exact source metadata',()=>{
 const ids=new Set(CC_CLARIFICATION_DRAFT_PACK.rules.flatMap(r=>r.requiredFacts??[]));
 // Include applicability-only facts introduced by this change.
 ids.add('message.has_two_interpretations');
 const introduced=[...ids].filter(id=>FACT_CATALOG.find(f=>f.id===id)?.confirmedByUserOnly);
 for(const id of introduced)for(const value of [true,false]) {
  const x=validateExtraction({proposedFacts:[{id,value,confidence:1,provenance:'model_extraction',evidenceExcerpt:'synthetic only'}]},FACT_CATALOG,'synthetic only');
  assert.equal(x.proposedFacts.length,0,id);
  const f=FACT_CATALOG.find(f=>f.id===id)!;
  assert.equal(f.persistent,false,id);
 }
 assert.equal(introduced.length,10);
});
test('relay through an intermediary is detected even with no report against current listener or disparagement',()=>{
 const r=run({'subject.identifiable':true,'message.reports_action_against_third_party':true,
 'message.reports_what_someone_said_or_did_against_listener':false,
 'message.content_is_disparaging':false,'message.may_be_understood_as_disparagement':false});
 assert.ok(r.findings.some(f=>f.ruleId==='cc-clarification.r3-03.chain'));
 assert.equal(r.findings.some(f=>f.ruleId==='cc-rechilut.1-01.basic'),false);
});
