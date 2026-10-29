const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function mode(meaning,extractor={alert:'unsure'}){
 const c={LHG_LOCAL_MEANING:meaning};vm.runInNewContext(fs.readFileSync(__dirname+'/check-mode.js','utf8'),c);
 c.LHG_CHECK_MODE.registerLocalEngine({id:'extractor-7b-q4',available:async()=>true,check:async()=>extractor});
 return c.LHG_CHECK_MODE;
}
test('meaning can raise a local alert; never lowers extractor/rules or admits none',async()=>{
 const prefs={lhgCheckMode:'local-fast'};let cloud=0;
 const run=(m,e)=>mode(m,e).route({text:'synthetic'},prefs,async()=>{cloud++;return {alert:'none'};});
 assert.equal((await run(async()=>({alert:'warn',p:.999}))).alert,'warn');
 assert.equal((await run(async()=>({alert:'unsure',p:.001}),{alert:'warn',rules:{findings:[1]}})).alert,'warn');
 assert.equal((await run(async()=>({alert:'none',p:0}))).alert,'unsure');
 for(const result of [null,{alert:'warn',p:NaN},{alert:'warn',p:2},{alert:'warn'}]){
  const r=await run(async()=>result);assert.equal(r.alert,'unsure');assert.equal(r.meaning.status,'unavailable');
 }
 const failed=await run(async()=>{throw Error('missing model')});assert.equal(failed.alert,'unsure');assert.equal(failed.meaning.status,'unavailable');
 const notChecked=await run(async()=>({alert:'warn',p:1}),{alert:'not_checked'});assert.equal(notChecked.alert,'not_checked');
 assert.equal(cloud,0);
});
test('low confidence remains unsure, invalid scores are rejected and thresholds are ordered',async()=>{
 const {T_LOW,T_HIGH,meaningBand}=await import('./decider-policy.mjs');
 assert.ok(T_LOW>=0&&T_LOW<T_HIGH&&T_HIGH<=1);
 assert.equal(meaningBand(T_HIGH),'warn');if(T_LOW>0)assert.equal(meaningBand(T_LOW/2),'low');
 for(const p of [NaN,Infinity,-.1,1.01,null,undefined])assert.throws(()=>meaningBand(p));
});
test('decider import rejects wrong hashes before writing; missing artifact never approves',async()=>{
 const {webcrypto}=require('node:crypto');global.crypto=webcrypto;let writes=0;
 global.caches={open:async()=>({match:async()=>undefined,put:async()=>{writes++;}})};
 const {importDecider,deciderInstalled,loadDecider}=await import('./decider-model.mjs');
 assert.equal(await deciderInstalled(),false);await assert.rejects(loadDecider(),/not-installed/);
 await assert.rejects(importDecider([]),/files-required/);
 await assert.rejects(importDecider([{name:'config.json',webkitRelativePath:'d1/v2/config.json',arrayBuffer:async()=>new TextEncoder().encode('{}').buffer}]),/integrity-failed/);
 assert.equal(writes,0);
});
