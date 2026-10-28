import {chromium} from 'playwright';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
const extension=path.resolve('../../extension');
const assets=process.env.LHG_TRANSFORMERS_DIR;
if(!assets) throw Error('LHG_TRANSFORMERS_DIR required');
const profile=await mkdtemp(path.join(os.tmpdir(),'lhg-mv3-'));
const checks=[],external=[],errors=[];
const server=createServer((req,res)=>{
 const file=path.resolve(assets,'.cache/Xenova/multilingual-e5-small',new URL(req.url,'http://localhost').pathname.slice(1));
 if(!file.startsWith(path.resolve(assets,'.cache')+path.sep)) {res.writeHead(403).end();return;}
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Content-Type',file.endsWith('.json')?'application/json':'application/octet-stream');
 createReadStream(file).on('error',()=>res.writeHead(404).end()).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const modelUrl='http://127.0.0.1:'+server.address().port;
let ctx;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('PASS',label);};
async function launch() {
 ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 ctx.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));});
 await ctx.route('https://huggingface.co/**',async route=>{
  if(process.env.LHG_LIVE_MODEL_DOWNLOAD==='1') return route.continue();
  const file=new URL(route.request().url()).pathname.split('/').slice(5).join('/');
  console.log('MODEL',file);
  try {await route.fulfill({status:302,headers:{location:modelUrl+'/'+file,'access-control-allow-origin':'*'}});}
  catch {await route.abort();}
 });
 await ctx.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: Synthetic (test@example.invalid)"></a><div data-thread-id="synthetic-thread"><div data-legacy-message-id="synthetic-mail"><div class="a3s">הרכב במוסך בגלל תקלה במנוע והתיקון יסתיים ביום שלישי.</div></div><div class="Am Al editable" contenteditable="true" role="textbox"></div></div>`}));
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 worker.on('console',msg=>console.log('WORKER',msg.text()));
 const debug=await ctx.newCDPSession(await ctx.newPage());
 await debug.send('Target.setDiscoverTargets',{discover:true});
 debug.on('Target.targetCreated',async e=>{
  console.log('TARGET',e.targetInfo.type,e.targetInfo.url);
  if(e.targetInfo.type!=='other') return;
  const {sessionId}=await debug.send('Target.attachToTarget',{targetId:e.targetInfo.targetId,flatten:false});
  await debug.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Runtime.enable'})});
 });
 debug.on('Target.receivedMessageFromTarget',e=>{
  const m=JSON.parse(e.message);
  if(m.method==='Runtime.consoleAPICalled') console.log('OFFSCREEN',m.params.args.map(x=>x.value||x.description).join(' '));
  if(m.method==='Runtime.exceptionThrown') console.log('OFFSCREEN ERROR',JSON.stringify(m.params.exceptionDetails));
 });
 const id=new URL(worker.url()).host;
 const options=await ctx.newPage();await options.goto('chrome-extension://'+id+'/options.html');
 return {options,worker,id};
}
try {
 let {options,worker,id}=await launch();
 check((await options.evaluate(()=>chrome.runtime.getManifest().version))==='0.10.0','real MV3 extension loaded');
 // Seed installed data via explicit install command; exact cached model bytes, no inference server.
 let install;
 if(process.env.LHG_IMPORT_MODEL==='1') {
   await options.locator('#memoryImport').setInputFiles(path.join(assets,'.cache/Xenova/multilingual-e5-small'));
   await options.waitForFunction(()=>document.getElementById('memoryStatus').textContent==='Local search model is ready.',{},{timeout:45000});
   install={ok:true};
 } else install=await options.evaluate(async()=>{await (await import('./memory-embedding.mjs')).installModel();return chrome.runtime.sendMessage({type:'lhg-memory',op:'install'});});
 console.log('INSTALL',install);
 check(install?.ok,'offscreen WASM model install and initialization');
 check(await options.evaluate(async()=>{try{await (await import('./memory-embedding.mjs')).importModel([new File(['bad'],'config.json')]);return false;}catch{return true;}}),'model import rejects incorrect hashes');
 await options.evaluate(()=>chrome.storage.local.set({lhgMemoryEnabled:true,lhgEnabled:true}));
 const mail=await ctx.newPage();
 const cdp=await ctx.newCDPSession(mail),contexts=[];
 cdp.on('Runtime.executionContextCreated',({context})=>contexts.push(context));
 await cdp.send('Runtime.enable');
 await mail.goto('https://mail.google.com/mail/u/0/');
 await mail.waitForTimeout(300);
 let world;
 for(const c of contexts) {try{if((await cdp.send('Runtime.evaluate',{contextId:c.id,expression:'!!globalThis.LHG_MEMORY',returnByValue:true})).result.value)world=c.id;}catch{}}
 check(!!world,'actual isolated content collector loaded');
 const isolated=async expression=>{
  const r=await cdp.send('Runtime.evaluate',{contextId:world,expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
 };
 const read=()=>isolated("LHG_MEMORY.tools('gmail',document.querySelector('[contenteditable]')).get_recent()");
 await mail.locator('[contenteditable]').fill('טיוטה סינתטית שטרם נשלחה');
 await mail.waitForTimeout(700);
 const rows=await read();
 check(rows.some(r=>r.kind==='draft'&&r.text.includes('טיוטה')),'typing event persisted without send or check success');
 check(rows.some(r=>r.kind==='context'&&r.text.includes('במוסך')),'opened-mail baseline context persisted');
 const search=await isolated("LHG_MEMORY.tools('gmail',document.querySelector('[contenteditable]')).search_history({query:'מתי יתקנו את המכונית?',top_k:1})");
 check(search[0]?.text.includes('במוסך'),'model tool semantic Hebrew retrieval through service worker');
 await mail.locator('[contenteditable]').fill('טיוטה חדשה בלבד');await mail.waitForTimeout(500);
 check((await read()).filter(r=>r.kind==='draft').length===1,'draft edits replace text and vectors');
 await mail.locator('[contenteditable]').fill('');await mail.waitForTimeout(300);
 check(!(await read()).some(r=>r.kind==='draft'),'cleared draft removed without sent inference');
 const denied=await options.evaluate(()=>chrome.runtime.sendMessage({type:'lhg-memory',op:'ingest',event:{scope:{platform:'gmail',accountId:'forged',conversationId:'forged'}}}));
 check(!denied?.ok,'options cannot forge DOM ingestion');
 await options.evaluate(()=>chrome.storage.local.set({lhgMemoryEnabled:false}));
 const disabled=await isolated("LHG_MEMORY.tools('gmail',document.querySelector('[contenteditable]')).get_recent().then(()=>false,()=>true)");
 check(disabled,'memory disabled gates read tools');
 await options.evaluate(()=>chrome.storage.local.set({lhgMemoryEnabled:true}));
 await worker.evaluate(()=>chrome.offscreen.closeDocument());
 check((await read()).some(r=>r.text.includes('במוסך')),'offscreen restart reopens persistent vault');
 await ctx.close();
 ({options,worker,id}=await launch());
 const persisted=await options.evaluate(async()=>{
   const {LocalMemory}=await import('./memory.mjs');
   const m=new LocalMemory({name:'lhg-memory-v1',embed:()=>{throw Error('not-needed');}});
   return m.tools({platform:'gmail',accountId:'test@example.invalid',conversationId:'synthetic-thread'}).get_recent();
 });
 check(persisted.some(r=>r.text.includes('במוסך')),'full browser restart preserves vault');
 // Rebind a trusted synthetic content frame after restart for the remaining checks.
 const again=await ctx.newPage();
 await again.goto('https://mail.google.com/mail/u/0/');
 const readAfter=()=>options.evaluate(async()=>{
   const {LocalMemory}=await import('./memory.mjs');const m=new LocalMemory({name:'lhg-memory-v1',embed:()=>{throw Error('not-needed');}});
   return m.tools({platform:'gmail',accountId:'test@example.invalid',conversationId:'synthetic-thread'}).get_recent();
 });
 await options.evaluate(async()=>{
  const {LocalMemory}=await import('./memory.mjs');
  const memory=new LocalMemory({name:'lhg-memory-v1',embed:async text=>Array.from({length:384},(_,i)=>i===0?1:0)});
  await memory.ingest({enabled:true,scope:{platform:'gmail',accountId:'other-account',conversationId:'synthetic-thread'},sourceId:'other',text:'other synthetic account',observedAt:Date.now(),type:'context_observed',direction:'incoming'});
 });
 check(!(await readAfter()).some(r=>r.text.includes('other synthetic')),'account isolation across extension-wide vault');
 await options.evaluate(async()=>{
  const {LocalMemory}=await import('./memory.mjs');const {loadEmbed}=await import('./memory-embedding.mjs');
  const m=new LocalMemory({name:'lhg-long-test',embed:await loadEmbed()});
  const scope={platform:'gmail',accountId:'synthetic',conversationId:'long'};
  await m.ingest({enabled:true,scope,sourceId:'long',text:'טקסט סינתטי ארוך '.repeat(90),observedAt:Date.now(),type:'context_observed',direction:'incoming'});
  const r=(await m.rows(JSON.stringify(Object.values(scope))))[0];if(r.embeddings.length<2)throw Error('chunking missing');
  await m.deleteMessage(scope,'long');if((await m.tools(scope).get_recent()).length)throw Error('chunk delete failed');
  await m.clear();m.close();
 });
 check(true,'long text chunking and atomic source deletion');
 const clear=await options.evaluate(()=>chrome.runtime.sendMessage({type:'lhg-memory',op:'clear'}));
 check(clear?.ok && (await readAfter()).length===0,'user clear removes text and vectors');
 check(errors.length===0,'no extension page errors');
 await writeFile('extension-results.json',JSON.stringify({browser:await options.evaluate(()=>navigator.userAgent),checks,errors,external,modelDownload:process.env.LHG_IMPORT_MODEL==='1'?'options folder import':process.env.LHG_LIVE_MODEL_DOWNLOAD==='1'?'Hugging Face live':'loopback fixture redirect'},null,2));
 console.log('TOTAL',checks.length);
} finally {await ctx?.close();server.close();await rm(profile,{recursive:true,force:true});}
