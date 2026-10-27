import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CC_ALL_DRAFT_PACK, CC_DRAFT_PACKS, CC_TOELET_CONDITIONS, FACT_CATALOG,
  evaluate, evalExpr, exprFactIds, validateRulePack,
  type FactMap, type Rule, type MessageEnvelope,
} from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const vocabulary = JSON.parse(readFileSync(join(root,'rules/chafetz-chaim/facts.json'),'utf8')).facts as {id:string;questionHe:string}[];
const message: MessageEnvelope = { id:'synthetic',revision:1,direction:'outgoing',authorRef:'user',
  platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'דוגמה סינתטית בלבד' };
const records = (values: Record<string,boolean>): FactMap => new Map(Object.entries(values).map(([id,value]) => [id,{
  id,value,status:'known' as const,provenance:'user' as const,scope:'message' as const,updatedAt:'2026-10-27T00:00:00Z',
}]));
function run(rule: Rule, facts: FactMap, live = true) {
  return evaluate({message, facts, rulePack:{id:'synthetic-test',version:'1',rules:[rule]},
    catalog:FACT_CATALOG,ruleMode:live?'live_draft':'approved_only',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
}
const byId = new Map(CC_ALL_DRAFT_PACK.rules.map(r => [r.id,r]));
const speech = {'subject.identifiable':true,'message.content_is_disparaging':true};
const receiving = {...speech,'listener.role_is_receiving':true};
const rechilut = {'subject.identifiable':true,'message.reports_what_someone_said_or_did_against_listener':true};
const seven = {
  'speaker.knows_first_hand':true, 'toelet.facts_verified':false,
  'speaker.checked_halachic_classification':true, 'toelet.rebuke_attempted':true,
  'message.contains_falsehood_or_exaggeration':false, 'toelet.purpose_is_constructive':true,
  'speaker.intent_to_disparage':false, 'speaker.motive_is_revenge_or_hatred':false,
  'toelet.no_other_way':true,'toelet.no_excess_harm':true,
};

// Each family has explicit positive, negative, absent, disputed, and draft-only
// scenarios. The negative changes the decisive fact, not the message direction.
const cases: [string,string,Record<string,boolean>,string][] = [
  ['speech','cc-speech.1-01.truth',{...speech,'message.content_is_true':true},'message.content_is_true'],
  ['publication','cc-publication.2-07.confidence',{...speech,'message.was_told_in_confidence':true},'message.was_told_in_confidence'],
  ['reputation','cc-reputation.8-03.minor',{'subject.identifiable':true,'subject.is_minor':true,'message.content_may_cause_harm':true},'message.content_may_cause_harm'],
  ['listener','cc-listener.6-11.harm',{...receiving,'listener.will_act_harmfully':true},'listener.will_act_harmfully'],
  ['rechilut','cc-rechilut.1-04.truth',{...rechilut,'message.content_is_true':true},'message.content_is_true'],
  ['prevention','cc-prevention.9-02.alternative',{'subject.identifiable':true,'toelet.purpose_is_constructive':true,'context.threat_of_planned_harm':true,'toelet.no_other_way':false},'toelet.no_other_way'],
  ['toelet','cc-toelet.10-01.wrongdoing-frame',{...speech,...seven,'subject.has_repented_or_reformed':false},'speaker.checked_halachic_classification'],
  ['context','cc-context.9-01.praise-enemies',{'subject.identifiable':true,'message.is_praise':true,'audience.includes_subject_enemies':true,'subject.is_established_righteous':false},'audience.includes_subject_enemies'],
];
for (const [family,id,values,decisive] of cases) {
  test(`CC ${family}: positive/negative/missing/disputed/default-mode`, () => {
    const rule = byId.get(id)!;
    assert.ok(rule,id);
    const complete = Object.fromEntries([...new Set([...(rule.requiredFacts??[]), ...exprFactIds(rule.applicability), ...exprFactIds(rule.conditions)])].map(id=>[id,false]));
    Object.assign(complete,values);
    const positive = run(rule,records(complete));
    assert.equal(positive.findings.length,1,id);
    assert.equal(positive.findings[0]?.draft,true);
    assert.equal(run(rule,records({...complete,[decisive]:!complete[decisive]})).findings.length,0);
    const absent=records(complete); absent.delete(decisive);
    const missing=run(rule,absent);
    assert.equal(missing.findings.length,0);
    assert.equal(missing.status,'needs_clarification');
    assert.equal(missing.questions.length,1);
    assert.equal(missing.questions[0]?.factId,decisive);
    const disputed=records(complete); disputed.get(decisive)!.status='disputed';
    assert.equal(run(rule,disputed).findings.length,0);
    assert.ok(run(rule,disputed).missingFactIds.includes(decisive));
    const internal=run(rule,records(complete),false);
    assert.equal(internal.findings.length,0);
    assert.equal(internal.draftObservations.length,1);
  });
}
test('all pack sources equal manifest, all referenced facts exist, no duplicated rules or verdicts', () => {
  const manifest=JSON.parse(readFileSync(join(root,'sources/chafetz-chaim/manifest.json'),'utf8')) as {
    principles:{key:string;ref:string;seifim:{n:number;url:string}[]}[]
  };
  const sources=new Map(manifest.principles.flatMap(p=>p.seifim.map(s=>[s.url,{p,s}] as const)));
  const ids=new Set<string>();
  const catalog=new Map(FACT_CATALOG.map(f=>[f.id,f]));
  const vocab=new Map(vocabulary.map(f=>[f.id,f]));
  for(const pack of CC_DRAFT_PACKS) assert.deepEqual(validateRulePack(pack).errors,[],pack.id);
  assert.deepEqual(validateRulePack(CC_ALL_DRAFT_PACK).errors,[]);
  for(const rule of CC_ALL_DRAFT_PACK.rules) {
    assert.ok(!ids.has(rule.id),rule.id); ids.add(rule.id);
    assert.equal(rule.reviewStatus,'draft'); assert.equal(rule.domain,'halacha_draft');
    assert.ok(!/(^|[^א-ת])(מותר|אסור)([^א-ת]|$)|permitted|forbidden/i.test(rule.outcome.messageHe),rule.id);
    const source=sources.get(rule.source?.url??''); assert.ok(source,rule.id);
    assert.equal(rule.source?.section,`${source.p.ref.match(/Principle (\d+)$/)?.[1]}:${source.s.n}`);
    const text=readFileSync(join(root,'sources/chafetz-chaim/text',source.p.key+'.txt'),'utf8');
    assert.ok(text.includes('['+source.s.n+']'),rule.id);
    const facts=new Set([...(rule.requiredFacts??[]),...exprFactIds(rule.applicability),...exprFactIds(rule.conditions),
      ...(rule.exceptions??[]).flatMap(e=>[...exprFactIds(e)])]);
    for(const id of facts) {
      assert.ok(vocab.has(id),`${rule.id}: vocabulary missing ${id}`);
      assert.ok(catalog.has(id),`${rule.id}: catalog missing ${id}`);
      assert.equal(catalog.get(id)?.questionHe,vocab.get(id)?.questionHe,id);
    }
  }
});
test('to-elet: personal knowledge OR verified hearsay; classification is mandatory', () => {
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records(seven)),true);
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records({...seven,'speaker.knows_first_hand':false,'toelet.facts_verified':true})),true);
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records({...seven,'speaker.knows_first_hand':false})),false);
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records({...seven,'speaker.checked_halachic_classification':false})),false);
  const missing=records(seven); missing.delete('speaker.checked_halachic_classification');
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,missing),'unknown');
  const disputed=records(seven); disputed.get('speaker.checked_halachic_classification')!.status='disputed';
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,disputed),'unknown');
});
test('to-elet: known ineffective rebuke also needs publicity; no shortcut to permission', () => {
  const values={...seven,'toelet.rebuke_attempted':false,'toelet.knows_subject_will_not_accept_rebuke':true};
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records(values)),'unknown');
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records({...values,'audience.size_at_least_three':false})),'unknown');
  // Section 9 is a separate alternative: without it known false, nonpublicity is unresolved.
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records({...values,'audience.size_at_least_three':false,
    'speaker.publicly_known_truthful':false})),false);
  assert.equal(evalExpr(CC_TOELET_CONDITIONS,records({...values,'audience.size_at_least_three':true})),true);
  const rule=byId.get('cc-toelet.10-02c.rebuke-first')!;
  assert.equal(run(rule,records({...speech,'toelet.purpose_is_constructive':true,'toelet.rebuke_attempted':false})).findings.length,0);
});
test('unknown/disputed righteous exception never turns into known-false', () => {
  const rule=byId.get('cc-context.9-01.praise-enemies')!;
  const values={'subject.identifiable':true,'message.is_praise':true,'audience.includes_subject_enemies':true};
  const unknown=run(rule,records(values));
  assert.equal(unknown.findings.length,0);
  assert.equal(unknown.questions[0]?.factId,'subject.is_established_righteous');
  assert.equal(run(rule,records({...values,'subject.is_established_righteous':true})).findings.length,0);
  const disputed=records({...values,'subject.is_established_righteous':false});
  disputed.get('subject.is_established_righteous')!.status='disputed';
  assert.equal(run(rule,disputed).findings.length,0);
});
test('praise alone is not excessive praise or praise before enemies', () => {
  for(const id of ['cc-context.9-01.praise-enemies','cc-context.9-01.excessive-praise']) {
    const rule=byId.get(id)!;
    const r=run(rule,records({'subject.identifiable':true,'message.is_praise':true,'subject.is_established_righteous':false}));
    assert.equal(r.findings.length,0,id); assert.equal(r.status,'needs_clarification');
  }
});
test('authorization does not remove other speech rules or yield a permit', () => {
  const facts=records({...speech,'message.content_is_true':true,'message.was_told_in_confidence':true,'message.disclosure_authorized':true});
  const r=evaluate({message,facts,rulePack:CC_ALL_DRAFT_PACK,catalog:FACT_CATALOG,ruleMode:'live_draft',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
  assert.ok(r.findings.some(f=>f.ruleId==='cc-speech.1-01.truth'));
  assert.equal(r.questions.length,1);
  assert.ok(r.findings.every(f=>f.draft===true));
});
test('all facts absent: no finding, one question; false identifiability never implicates an unnamed person', () => {
  const runAll=(facts:FactMap)=>evaluate({message,facts,rulePack:CC_ALL_DRAFT_PACK,catalog:FACT_CATALOG,ruleMode:'live_draft',maxQuestions:1,contextVersion:'test',modelVersion:'test'});
  assert.equal(runAll(new Map()).findings.length,0);
  assert.equal(runAll(new Map()).questions.length,1);
  const values=Object.fromEntries(FACT_CATALOG.map(f=>[f.id,true]));
  values['subject.identifiable']=false;
  assert.equal(runAll(records(values)).findings.length,0);
});
