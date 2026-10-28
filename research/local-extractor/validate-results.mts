/** Offline contract check against the real engine, never calls a provider or /check. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExtraction } from '../../engine/src/extractor/validate.js';
import { FACT_CATALOG } from '../../engine/src/lessonScenario.js';
import { EXTRACTION_CONFIDENCE_MIN } from '../../engine/src/extractor/factPolicy.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const tag=process.argv[2] ?? 'e1-20261028';
const data=JSON.parse(fs.readFileSync(path.join(root,'results',tag+'-scored.json'),'utf8'));
let count=0, facts=0;
for (const [name,result] of Object.entries(data) as [string,any][]) {
  if (!result.engine_inputs) continue;
  for (const row of result.engine_inputs) {
    // 0.6 is ONLY an admission-test placeholder, never calibrated model confidence.
    const proposals=row.proposedFacts.map((f:any)=>({...f,confidence:EXTRACTION_CONFIDENCE_MIN}));
    const checked=validateExtraction({proposedFacts:proposals},FACT_CATALOG,row.text);
    assert.deepEqual(checked.droppedFacts,[],name+':'+row.id);
    assert.equal(checked.proposedFacts.length,proposals.length);
    assert.equal(checked.directAssessment,null);
    assert.equal(checked.meaning,undefined);
    facts+=proposals.length;count++;
  }
}
assert.ok(count>0,'No results were validated');
// Defense boundary checks use actual canonical catalog, including user-only flags.
const denied=validateExtraction({proposedFacts:[
  {id:'subject.is_established_wicked',value:true,confidence:1,evidenceExcerpt:'hello'},
  {id:'toelet.facts_verified',value:true,confidence:1,evidenceExcerpt:'fabricated'},
  {id:'toelet.no_other_way',value:false,confidence:2,evidenceExcerpt:'hello'},
]},FACT_CATALOG,'hello');
assert.equal(denied.proposedFacts.length,0);
assert.deepEqual(new Set(denied.droppedFacts.map(f=>f.reason)),new Set([
  'confirmed_by_user_only','evidence_not_in_message','confidence_missing_or_invalid']));
const result={candidateRowsValidated:count,factsValidated:facts,defenseChecks:3,tag};
fs.writeFileSync(path.join(root,'results',tag+'-engine-validation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
