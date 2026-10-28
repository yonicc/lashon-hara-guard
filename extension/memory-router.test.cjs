const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {fakeIndexedDB}=require('./fake-idb.testlib.cjs');
const {createDocument}=require('./mini-dom.testlib.cjs');
const {webcrypto}=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const scope={platform:'gmail',accountId:'synthetic@example.invalid',conversationId:'thread-a'};
const text='What about the garage repair we discussed?';
const embed=async t=>{const v=Array(384).fill(0);v[/garage/.test(t)?0:1]=1;return v;};
async function seed(){
 globalThis.indexedDB=fakeIndexedDB();
 const {LocalMemory}=await import('./memory.mjs');
 const now=Date.now(),m=new LocalMemory({embed,name:'router-'+Math.random(),now:()=>now});
 const put=(s,id,t,days=0,type='context_observed')=>m.ingest({scope:s,sourceId:id,text:t,observedAt:now-days*86400000,enabled:true,type,direction:'incoming'});
 await put(scope,'old','Synthetic Person garage repair is delayed; email a@example.invalid',3,'input_observed');
 for(let i=0;i<6;i++)await put(scope,'d'+i,'school topic '+i,0.1+i/100);
 await put({...scope,conversationId:'other'},'foreign','garage FOREIGN CONVERSATION');
 await put({...scope,accountId:'other@example.invalid'},'foreign-account','garage FOREIGN ACCOUNT');
 return {m,now};
}
async function content(m,route,{enabled=true}={}){
 const {expandMemory}=await import('./memory-router.mjs');
 const calls=[],document=createDocument('<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account (synthetic@example.invalid)"></a><div data-thread-id="thread-a"><div id="box"></div></div>');
 const c=vm.createContext({document,crypto:webcrypto,TextEncoder,setTimeout,clearTimeout,console,location:{hash:'#inbox/thread-a'},
 LHG_SETTINGS:{get:()=>({lhgMemoryEnabled:true,lhgRouterEnabled:enabled}),isActive:()=>true},
 LHG_LOCAL_CONTEXT:{attach:()=>({authorDisplayName:'Synthetic Person'})},
 chrome:{runtime:{sendMessage:async msg=>{
   calls.push(msg); if(msg.op==='route_context') return {ok:true,result:await expandMemory({memory:m,scope:msg.scope,text:msg.text,route})};
   return {ok:true,result:[]};
 }}}});
 for(const f of ['selectors.js','memory-content.js','context-builder.js','context-runtime.js']) vm.runInContext(read(f),c);
 return {calls,c,document,prepare:()=>c.LHG_CONTEXT_RUNTIME.prepare({type:'lhg-check',text,platform:'gmail',direction:'incoming'},document.querySelector('#box'))};
}
test('router: scoped semantic retrieval reaches real prepared packet and background POST',async()=>{
 const {m}=await seed(),f=await content(m,async()=>['mem_search']);
 const msg=await f.prepare(),packet=msg.context;
 assert.match(packet.recentMessages[0].text,/garage repair/);
 assert.match(packet.recentMessages[0].text,/candidate; dom_observed; draft/);
 assert.equal(packet.recentMessages[0].authorRef,'unknown');
 assert.ok(packet.recentMessages.length<=5);assert.ok(packet.recentMessages.every(x=>x.text.length<=300));
 assert.doesNotMatch(JSON.stringify(packet),/FOREIGN|Synthetic Person|a@example.invalid|thread-a|sourceId|embedding/);
 assert.match(packet.recentMessages[0].text,/\[name\]/);
 assert.equal(packet.facts.length,0);assert.equal(packet.forwarded,undefined);
 let handler,body;
 const bg=vm.createContext({crypto:webcrypto,TextEncoder,setTimeout,clearTimeout,AbortController,
 chrome:{storage:{local:{get:async()=>({accessKey:'synthetic'}),set:async()=>{}}},runtime:{onMessage:{addListener:fn=>handler=fn}}},
 fetch:async(_url,init)=>{body=JSON.parse(init.body);return {ok:true,status:200,json:async()=>({alert:'warn'})};}});
 vm.runInContext(read('background.js'),bg);
 await new Promise(resolve=>handler(msg,{},resolve));
 assert.deepEqual(body.context,JSON.parse(JSON.stringify(packet)));
 await m.deleteMessage(scope,'old');
 assert.ok(!(await f.prepare()).context.recentMessages.some(r=>r.text.includes('garage repair')));
});
test('router: none, ask_user and inference error preserve normal packet without inventing facts',async()=>{
 for(const route of [async()=>[],async()=>['ask_user'],async()=>{throw Error('offline');},async()=>['write']]){
   const {m}=await seed(),f=await content(m,route),msg=await f.prepare();
   assert.equal(msg.context.recentMessages.length,0);assert.equal(msg.context.facts.length,0);
 }
});
test('router: recent, combined heads, disabled flag, captured scope and unknown scope',async()=>{
 const {m}=await seed(),{expandMemory}=await import('./memory-router.mjs');
 const recent=await expandMemory({memory:m,scope,text,route:async()=>['mem_recent']});
 assert.equal(recent.candidates.length,5);assert.ok(!recent.candidates.some(r=>r.text.includes('garage')));
 const combined=await expandMemory({memory:m,scope,text,route:async()=>['mem_recent','mem_search']});
 assert.equal(combined.candidates.length,5);assert.match(combined.candidates[0].text,/garage/);
 assert.equal((await expandMemory({memory:m,scope:null,text,route:async()=>['mem_search']})).status,'unknown');
 const off=await content(m,async()=>{throw Error('must not run');},{enabled:false});
 await off.prepare();assert.equal(off.calls.filter(c=>c.op==='route_context').length,0);
 const f=await content(m,async()=>{await new Promise(r=>setTimeout(r,10));return ['mem_search'];});
 const pending=f.prepare();f.document.querySelector('[data-thread-id]').setAttribute('data-thread-id','other');
 assert.match((await pending).context.recentMessages[0].text,/garage repair/);
});
test('router: budget timeout returns unknown without turning a failure into an approval',async()=>{
 const {m}=await seed(),{expandMemory,headsFromLogits}=await import('./memory-router.mjs');
 const start=performance.now();
 const result=await expandMemory({memory:m,scope,text,route:()=>new Promise(()=>{})});
 assert.equal(result.status,'unknown');assert.equal(result.alert,undefined);assert.ok(performance.now()-start<450);
 assert.throws(()=>headsFromLogits([NaN,0,1]));assert.deepEqual(headsFromLogits([-100,-100,-100]),[]);
});

test('router bridge: privileged sender and both switches gate inference; model arguments are discarded',async()=>{
 let handler,relay=[],settings={lhgMemoryEnabled:true,lhgRouterEnabled:true};
 const c=vm.createContext({URL,console:{warn(){}},setTimeout,clearTimeout,chrome:{
  runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,
   getContexts:async()=>[{}],sendMessage:async m=>{relay.push(m);return {ok:true,result:{status:'ok',candidates:[]}};},
   onMessage:{addListener:fn=>handler=fn}},storage:{local:{get:async()=>settings}}
 }});
 vm.runInContext(read('memory-background.js'),c);
 const sender={id:'extension',url:'https://mail.google.com/mail/u/0/',tab:{id:1}};
 const msg={type:'lhg-memory',op:'route_context',scope,text,labels:['write'],args:{accountId:'forged'}};
 const ask=(s=sender)=>new Promise(resolve=>handler(msg,s,resolve));
 assert.equal((await ask()).ok,true);
 assert.equal(relay.length,1);assert.equal(relay[0].target,'lhg-memory-offscreen');
 assert.equal(relay[0].args,undefined);assert.equal(relay[0].labels,undefined);
 for(const s of [{...sender,id:'other'},{...sender,url:'https://evil.invalid'},{...sender,incognito:true},{...sender,tab:{incognito:true}}])
  assert.equal((await ask(s)).ok,false);
 for(const flags of [{lhgMemoryEnabled:true,lhgRouterEnabled:false},{lhgMemoryEnabled:false,lhgRouterEnabled:true},
   {lhgMemoryEnabled:true,lhgRouterEnabled:true,lhgEnabled:false},
   {lhgMemoryEnabled:true,lhgRouterEnabled:true,lhgPlatforms:{gmail:false}}]){
  settings=flags;assert.equal((await ask()).ok,false);
 }
 assert.equal(relay.length,1);
});
