import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CC_ALL_DRAFT_PACK} from '../src/chafetzChaim/allPacks.js';
const map=JSON.parse(readFileSync(new URL('../src/chafetzChaim/sourceCoverage.json',import.meta.url),'utf8'));
test('FINAL-COV all 177 have either runtime and partial scope or a sourced categorical blocker',()=>{
 const counts:Record<string,number>={implemented:0,partial:0,expert_ruling:0,external_evidence:0,not_representable:0};
 for(const s of map.sections){
  if(s.disposition==='partial'){assert.ok(s.ruleIds.length);assert.equal(s.blocker,null);counts.partial!++;continue;}
  assert.equal(s.disposition,'blocked',s.key);assert.equal(s.ruleIds.length,0);
  assert.ok(Object.hasOwn(counts,s.blocker.category));assert.equal(s.blocker.sourceUrl,s.url);
  assert.ok(s.blocker.reasonHe.length>60);assert.equal(s.unimplementedHe,s.blocker.reasonHe);
  counts[s.blocker.category]!++;
 }
 assert.equal(Object.values(counts).reduce((a,b)=>a+b),177);
 assert.equal(counts.implemented,0);
 assert.equal(new Set(map.sections.filter((s:any)=>s.blocker).map((s:any)=>s.blocker.reasonHe)).size,12);
 assert.equal(CC_ALL_DRAFT_PACK.rules.length,234);
});
