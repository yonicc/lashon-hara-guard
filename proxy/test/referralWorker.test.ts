// A Node import/dry-run cannot catch unavailable filesystem reads in Workers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Wrangler pins these transitive dependencies; no extra production dependency.
const { build } = require('esbuild');
const { Miniflare } = require('miniflare');

test('bundled runLiveRules executes in workerd and returns group-D referrals', async () => {
 const dir=mkdtempSync(join(tmpdir(),'lhg-referral-worker-'));
 let mf:any;
 try {
  const entry=join(dir,'entry.ts');
  writeFileSync(entry, `
import {runLiveRules} from ${JSON.stringify(resolve('src/rules.ts'))};
export default { fetch() {
 const message={id:'synthetic',revision:1,direction:'outgoing',authorRef:'user',
 platform:'test',conversationId:'synthetic',audienceSnapshot:{},text:'synthetic only'};
 return Response.json(runLiveRules(message,undefined,{
 'subject.identifiable':true,'message.content_is_disparaging':true,
 'toelet.purpose_is_constructive':true,'toelet.rebuke_attempted':false,
 'toelet.knows_subject_will_not_accept_rebuke':false
 },'synthetic'));
}};
`);
  const bundle=await build({entryPoints:[entry],bundle:true,write:false,
   format:'esm',platform:'neutral',external:['node:*']});
  const config=readFileSync('wrangler.toml','utf8');
  const date=config.match(/compatibility_date = "([^"]+)"/)![1];
  const flags=JSON.parse(config.match(/compatibility_flags = (\[[^\n]+\])/)![1]!);
  const script=bundle.outputFiles[0].text;
  assert.ok(!script.includes('readFileSync'), 'runtime must not read repository files');
  mf=new Miniflare({workers:[{config:{
    name:'referral-test',compatibilityDate:date,compatibilityFlags:flags,
    manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:script}}}
  }}]});
  const response=await mf.dispatchFetch('https://synthetic.test');
  assert.equal(response.status,200);
  const result=await response.json();
  assert.notEqual(result.notChecked,true);
  assert.ok(result.referrals.some((r:any)=>r.sectionKey==='p1_prin1:2'), 'blocked section reachable');
  assert.ok(result.referrals.some((r:any)=>r.sectionKey==='p1_prin10:2'), 'partial section referred');
  assert.ok(!result.findings.some((f:any)=>f.ruleId==='cc-toelet.10-02c.rebuke-first'));
  assert.ok(result.referrals.every((r:any)=>r.gatheredFacts.length===5));
 } finally { if(mf) await mf.dispose(); rmSync(dir,{recursive:true,force:true}); }
});
