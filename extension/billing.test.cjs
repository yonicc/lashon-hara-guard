const test=require('node:test'),assert=require('node:assert/strict');
const B=require('./billing.js'),{run}=require('./context-loop.js');
require('./ollama-client.js');require('./ollama-engine.bundle.js');
const schema=globalThis.LHG_NEEDS;
test('receipts aggregate actual prices and zero; unknown is never zero',()=>{
 assert.deepEqual(B.add(B.add(null,{status:'captured',chargedAgorot:3}),{status:'captured',chargedAgorot:7}),{status:'captured',chargedAgorot:10});
 for(const raw of [{status:'captured',chargedAgorot:-1},{status:'released',chargedAgorot:3},{status:'captured'},{status:'unknown',chargedAgorot:null}])
  assert.deepEqual(B.add({status:'captured',chargedAgorot:3},raw),{status:'unknown',chargedAgorot:null});
 assert.deepEqual(B.add(null,{status:'cached',chargedAgorot:0}),{status:'cached',chargedAgorot:0});
});
test('all context rounds count, including failure after a charged round',async()=>{
 for(const failed of [false,true]){
  let n=0;
  const result=await run({schema,request:{text:'synthetic',context:{version:1,recentMessages:[]}},check:async()=>{
   n++;
   return n===1?{alert:'warn',billing:{status:'captured',chargedAgorot:3},
    needs:{requests:[{id:'r',kind:'get_recent',args:{n:5}}],questions:[]}}
    :{alert:failed?'not_checked':'warn',billing:{status:failed?'released':'captured',chargedAgorot:failed?0:3}};
  },retrieve:async()=>[{text:'synthetic history'}],exchange:async()=>({version:1,platform:'gmail',direction:'outgoing',conversationRef:'synthetic',currentAuthorRef:'self',recentMessages:[{text:'synthetic history',authorRef:'unknown',direction:'incoming'}]})});
  assert.equal(n,2);assert.deepEqual(result.billing,{status:'captured',chargedAgorot:failed?3:6});
 }
});
test('superseded charged response still contributes its receipt',async()=>{
 let alive=true;
 const result=await run({schema,request:{text:'synthetic'},current:async()=>alive,
  check:async()=>{alive=false;return {alert:'none',billing:{status:'captured',chargedAgorot:3}};}});
 assert.deepEqual(result.billing,{status:'captured',chargedAgorot:3});assert.equal(result.alert,'unsure');
});
