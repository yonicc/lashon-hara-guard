// Synthetic real MV3/WASM integration. Run from research/local-memory.
// Requires LHG_TRANSFORMERS_DIR and LHG_ROUTER_DIR; imports pinned data explicitly.
import {chromium} from 'playwright';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const profile=await mkdtemp(path.join(os.tmpdir(),'lhg-router-'));
const extension=path.resolve('../../extension'),passed=[],network=[];
const scenarios=JSON.parse(await readFile('../local-router/memory-scenarios.json','utf8'));
const assets=process.env.LHG_TRANSFORMERS_DIR,router=process.env.LHG_ROUTER_DIR;
if(!assets||!router) throw Error('LHG_TRANSFORMERS_DIR and LHG_ROUTER_DIR required');
const ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
 args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
const check=(x,label)=>{assert.ok(x,label);passed.push(label);console.log('PASS',label);};
try {
 await ctx.route('https://**',r=>{
  if(r.request().url().startsWith('https://mail.google.com/')) return r.fulfill({contentType:'text/html',body:'<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account (synthetic@example.invalid)"></a><div data-thread-id="synthetic-thread"><div role="textbox" contenteditable="true" id="box"></div></div>'});
  network.push(r.request().url());return r.abort();
 });
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 worker.on('console',m=>console.log('WORKER',m.text()));
 const debug=await ctx.newCDPSession(await ctx.newPage());
 await debug.send('Target.setDiscoverTargets',{discover:true});
 debug.on('Target.targetCreated',async e=>{
  if(e.targetInfo.type!=='other')return;
  const {sessionId}=await debug.send('Target.attachToTarget',{targetId:e.targetInfo.targetId,flatten:false});
  await debug.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Runtime.enable'})});
 });
 debug.on('Target.receivedMessageFromTarget',e=>{
  const m=JSON.parse(e.message);
  if(m.method==='Runtime.consoleAPICalled')console.log('OFFSCREEN',m.params.args.map(x=>x.value||x.description).join(' '));
  if(m.method==='Runtime.exceptionThrown')console.log('OFFSCREEN ERROR',JSON.stringify(m.params.exceptionDetails));
 });
 const options=await ctx.newPage();await options.goto('chrome-extension://'+new URL(worker.url()).host+'/options.html');
 await options.locator('#memoryImport').setInputFiles(path.join(assets,'.cache/Xenova/multilingual-e5-small'));
 await options.waitForFunction(()=>document.querySelector('#memoryStatus').textContent==='Local search model is ready.',null,{timeout:60000});
 await options.locator('#routerImport').setInputFiles(router);
 await options.waitForFunction(()=>document.querySelector('#routerStatus').textContent.startsWith('Context router model imported.')||document.querySelector('#routerStatus').textContent.startsWith('Local memory is unavailable.'),null,{timeout:90000});
 assert.match(await options.locator('#routerStatus').textContent(),/^Context router model imported/);
 check(true,'explicit options import loads the pinned trained model in real offscreen WASM');
 check(await options.evaluate(async()=>{try{await (await import('./memory-router-model.mjs')).importRouter([new File(['bad'],'config.json')]);return false;}catch{return true;}}),'router rejects corrupt imported data');
 const sc={platform:'gmail',accountId:'synthetic@example.invalid',conversationId:'synthetic-thread'};
 await options.evaluate(async({sc,scenarios})=>{
  const {LocalMemory}=await import('./memory.mjs'),{loadEmbed}=await import('./memory-embedding.mjs');
  const m=new LocalMemory({name:'lhg-memory-v1',embed:await loadEmbed()});
  const now=Date.now();
  const put=(scope,id,text,age)=>m.ingest({enabled:true,scope,sourceId:id,text,type:'context_observed',direction:'incoming',observedAt:now-age});
  for(let i=0;i<scenarios.distractors.length;i++) await put(sc,'d'+i,scenarios.distractors[i],(i+1)*3600000);
  await put(sc,'planted',scenarios.scenarios[5].planted,72*3600000);
  await put({...sc,accountId:'foreign@example.invalid'},'foreign','FOREIGN ACCOUNT HOA budget report',100);
  await put({...sc,conversationId:'foreign'},'foreign','FOREIGN THREAD HOA budget report',100);
  m.close();
  await chrome.storage.local.set({lhgMemoryEnabled:true,lhgRouterEnabled:true});
 },{sc,scenarios});
 const denied=await options.evaluate(sc=>chrome.runtime.sendMessage({type:'lhg-memory',op:'route_context',scope:sc,text:'synthetic'}),sc);
 check(!denied?.ok,'extension page cannot forge a content frame router request');
 const mail=await ctx.newPage(),cdp=await ctx.newCDPSession(mail),contexts=[];
 cdp.on('Runtime.executionContextCreated',({context})=>contexts.push(context));await cdp.send('Runtime.enable');
 await mail.goto('https://mail.google.com/mail/u/0/');await mail.waitForTimeout(300);
 let world;
 for(const c of contexts) {try{if((await cdp.send('Runtime.evaluate',{contextId:c.id,expression:'!!globalThis.LHG_CONTEXT_RUNTIME',returnByValue:true})).result.value)world=c.id;}catch{}}
 check(!!world,'real isolated context runtime loaded');
 const isolated=async expression=>{
  const r=await cdp.send('Runtime.evaluate',{contextId:world,expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
 };
 const payload={type:'lhg-check',platform:'gmail',direction:'outgoing',text:scenarios.scenarios[5].message};
 // Warm inference is bounded; a cold/restarted document is allowed to fall back once.
 let result,prepared,ms;
 for(let i=0;i<3;i++){
  const t=performance.now();
  result=await isolated('chrome.runtime.sendMessage('+JSON.stringify({type:'lhg-memory',op:'route_context',scope:sc,text:payload.text})+')');
  ms=performance.now()-t;
  console.log('ROUTE',JSON.stringify(result),ms);
  if(result?.result?.candidates?.some(c=>c.text.includes('budget report'))) break;
  await mail.waitForTimeout(500);
 }
 check(result?.result?.labels?.includes('mem_search'),'trained emb8 router fires mem_search');
 check(result.result.candidates.some(c=>c.text.includes('budget report')),'real e5 scoped search retrieves the older planted message');
 check(!JSON.stringify(result).includes('FOREIGN'),'router cannot retrieve foreign account or conversation');
 prepared=await isolated('LHG_CONTEXT_RUNTIME.prepare('+JSON.stringify(payload)+',document.querySelector("#box"))');
 check(prepared.context.recentMessages.some(c=>c.text.includes('budget report')),'retrieval reaches the actual packet prepared for check');
 check(prepared.context.recentMessages.length<=5&&prepared.context.recentMessages.every(c=>c.text.length<=300),'packet shares the five-by-300 excerpt budget');
 check(prepared.context.recentMessages.some(c=>c.text.includes('candidate; dom_observed; context')),'candidate provenance survives into packet');
 check(!JSON.stringify(prepared.context).includes('synthetic@example.invalid'),'account identity stays local');
 await worker.evaluate(()=>chrome.offscreen.closeDocument());
 const reloaded=await options.evaluate(()=>chrome.runtime.sendMessage({type:'lhg-memory',op:'router_install'}));
 check(reloaded?.ok,'offscreen restart reloads both models from cache only');
 const again=await isolated('LHG_CONTEXT_RUNTIME.prepare('+JSON.stringify(payload)+',document.querySelector("#box"))');
 check(again.context.recentMessages.some(c=>c.text.includes('budget report')),'packet expansion works after cached offscreen restart');
 await options.evaluate(()=>chrome.storage.local.set({lhgRouterEnabled:false}));
 await mail.waitForTimeout(100);
 const off=await isolated('chrome.runtime.sendMessage('+JSON.stringify({type:'lhg-memory',op:'route_context',scope:sc,text:payload.text})+')');
 check(!off.ok&&off.error==='disabled','router switch is enforced at privileged bridge');
 check(network.length===0,'no external requests during import, inference or retrieval');
 await writeFile('router-extension-results.json',JSON.stringify({checks:passed,route_ms:ms,external:network},null,2));
} finally {await ctx.close();await rm(profile,{recursive:true,force:true});}
