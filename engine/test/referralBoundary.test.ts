import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, FACT_CATALOG, CC_ALL_DRAFT_PACK, type EvaluationInput, type Rule } from '../src/index.js';
import { groupDSections, referralCards, coverageKeyOfSource } from '../src/chafetzChaim/referral.js';

const message: EvaluationInput['message'] = { id:'synthetic',revision:1,direction:'outgoing',
 authorRef:'user',platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'synthetic referral' };
function input(rules: Rule[], facts: EvaluationInput['facts'] = new Map()): EvaluationInput {
 return { message, facts, catalog:FACT_CATALOG,rulePack:{id:'synthetic',version:'1',rules},
   contextVersion:'test',modelVersion:'test' };
}
const facts = new Map(FACT_CATALOG.map(f => [f.id, {id:f.id,value:true,status:'known' as const,
 provenance:'user' as const,scope:'message' as const,updatedAt:'2026-10-28'}]));
const template = CC_ALL_DRAFT_PACK.rules[0]!;

for (const section of groupDSections()) test('referral-only boundary: ' + section.key, () => {
 const [part, rest] = section.key.split('_prin');
 const [principle, n] = rest!.split(':');
 const source = {work:'Chafetz Chaim',part:part==='p1'?'Part One':'Part Two',
   principle:'Principle '+principle,section:principle+':'+n,url:section.url,verifiedAt:'2026-10-28'};
 for (const mode of [undefined,'approved_only','live_draft'] as const)
 for (const status of ['draft','source_verified','expert_reviewed','approved'] as const)
 for (const applicability of [true, 'unknown', false] as const) {
   const rule: Rule = {...template,id:'synthetic-'+section.key,source,reviewStatus:status,
     reviewer:'synthetic',reviewedAt:'2026-10-28',fixtures:['synthetic'],
     applicability:{eq:['subject.identifiable',true]},conditions:{and:[]},exceptions:[]};
   const state = new Map(facts);
   if (applicability === 'unknown') state.delete('subject.identifiable');
   else state.set('subject.identifiable',{...state.get('subject.identifiable')!,value:applicability});
   const result = evaluate({...input([rule],state),ruleMode:mode});
   assert.notEqual(result.status,'not_checked',status);
   assert.equal(result.findings.length,0);
   assert.equal(result.draftObservations.length,0);
   assert.equal(result.questions.length,0);
   if (applicability !== false) assert.ok(result.referrals.some(r=>r.sectionKey===section.key),
      mode + ' ' + status + ' ' + applicability);
 }
});

for (const section of groupDSections().filter(s=>s.disposition==='blocked'))
 test('blocked section is reachable without executable rule: '+section.key, () => {
   assert.ok(!CC_ALL_DRAFT_PACK.rules.some(r=>coverageKeyOfSource(r.source)===section.key));
   const topic = referralCards().get(section.cardId)!.factsNeeded!
     .find(id=>id!=='subject.identifiable' && id!=='subject.is_fellow')!;
   assert.ok(topic);
   const state = new Map([[topic,facts.get(topic)!]]);
   const r = evaluate({...input(CC_ALL_DRAFT_PACK.rules,state)});
   const ref = r.referrals.find(r=>r.sectionKey===section.key);
   assert.ok(ref,topic);
   assert.ok(ref.gatheredFacts.some(g=>g.id===topic));
   assert.ok(ref.backgroundHe);
   assert.ok(ref.questionHe.includes('?'));
 });

test('routing: no topic from generic identity, false or unknown facts; no unrelated pack referrals',()=>{
 for (const value of [false,null] as const) {
  const state = new Map([['message.content_is_disparaging',{...facts.get('message.content_is_disparaging')!,
    value:value ?? false,status:value===null?'unknown' as const:'known' as const}]]);
  assert.equal(evaluate(input(CC_ALL_DRAFT_PACK.rules,state)).referrals.length,0);
 }
 const generic = new Map([...facts].filter(([id])=>id==='subject.identifiable'||id==='subject.is_fellow'));
 assert.equal(evaluate(input(CC_ALL_DRAFT_PACK.rules,generic)).referrals.length,0);
 assert.equal(evaluate(input([{...template,source:undefined}],facts)).referrals.length,0);
});

test('bundled referral data equals current coverage and cards',()=>{
 const cov=JSON.parse(readFileSync(new URL('../src/chafetzChaim/sourceCoverage.json',import.meta.url),'utf8'));
 const expected=cov.sections.filter((s:any)=>s.disposition==='blocked'||s.chatFeasibility==='external_evidence');
 assert.deepEqual(groupDSections().map(s=>s.key),expected.map((s:any)=>s.key));
 for(const s of expected) {
  const actual=groupDSections().find(x=>x.key===s.key)!;
  for(const key of ['ref','url','blocker','unimplementedHe','disposition','chatFeasibility'] as const)
    assert.deepEqual(actual[key],s[key],s.key+' '+key);
  const principle=s.key.split(':')[0];
  const cards=JSON.parse(readFileSync(new URL('../../rules/chafetz-chaim/cards/'+principle+'.json',import.meta.url),'utf8'));
  const card=cards.find((c:any)=>c.id===s.cardId);
  assert.deepEqual(referralCards().get(s.cardId),{
   summaryHe:card.summaryHe,quotesHe:card.quotesHe,uncertainHe:card.uncertainHe,factsNeeded:card.factsNeeded});
 }
});
