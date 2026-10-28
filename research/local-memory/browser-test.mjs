import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const assets=process.env.LHG_TRANSFORMERS_DIR;
if(!assets) throw Error('Set LHG_TRANSFORMERS_DIR to installed @xenova/transformers 2.17.2 (with cached e5 model).');
const wasm=path.resolve(assets,'../../onnxruntime-web/dist');
const routes=[
 ['/extension/',path.resolve(here,'../../extension')],
 ['/vendor/',path.join(assets,'dist')],
 ['/wasm/',wasm],
 ['/models/',path.join(assets,'.cache')],
 ['/',here]
];
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const [prefix,root]=routes.find(([p])=>pathname.startsWith(p));
  const rel=pathname.slice(prefix.length)||'index.html', file=path.resolve(root,rel);
  if(!file.startsWith(path.resolve(root)+path.sep)) throw Error('path');
  const data=await readFile(file);
  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.json')?'application/json':'text/html');
  res.end(data);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(path.join(os.tmpdir(),'lhg-memory-test-'));
let context;
const results={browser:null,externalRequests:[],checks:[],timings:{}};
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true});
 await context.route('**/*',route=>{
   if(!route.request().url().startsWith(url+'/')) {results.externalRequests.push(route.request().url());return route.abort();}
   return route.continue();
 });
 const page=await context.newPage();
 page.on('pageerror',e=>console.error('PAGE:',e.message));
 await page.goto(url);await page.waitForFunction(()=>!!window.LocalMemory);
 return page;
}
try{
 let page=await launch();
 results.browser=await page.evaluate(()=>navigator.userAgent);
 const t=Date.now();
 await page.evaluate(async()=>{
  const {loadLocalEmbed}=await import('/embedding.mjs');
  window.realEmbed=await loadLocalEmbed();
 });
 results.timings.modelLoadMs=Date.now()-t;
 const outcome=await page.evaluate(async()=>{
   const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
   const checks=[], timings={};
   let clock=Date.now();
   const scope={platform:'gmail',accountId:'synthetic-a',conversationId:'synthetic-thread-1'};
   const other={...scope,accountId:'synthetic-b'};
   const mem=new LocalMemory({embed:realEmbed,now:()=>clock});
   await mem.clear();
   const event=(sourceId,text,extra={})=>({type:'message_observed',scope,sourceId,text,direction:'incoming',observedAt:clock,enabled:true,...extra});
   const t0=performance.now();
   await mem.ingest(event('vehicle','הרכב במוסך בגלל תקלה במנוע. התיקון צפוי להסתיים ביום שלישי.'));
   await mem.ingest(event('lesson','השיעור בפרשת השבוע יתקיים בבית המדרש ביום חמישי.'));
   await mem.ingest(event('invoice','החשבונית לספק טרם שולמה. התשלום יועבר בהעברה בנקאית.'));
   timings.ingest3Ms=performance.now()-t0;
   await mem.ingest(event('secret-other-account','מידע סינתטי בחשבון אחר',{scope:other}));
   const tool=mem.tools(scope);
   check(Object.keys(tool).sort().join(',')==='get_recent,search_history','read-only tool allowlist');
   const hit=await tool.search_history({query:'מתי יתקנו את המכונית?',top_k:1});
   check(hit[0]?.ref==='vehicle','Hebrew semantic retrieval');
   check(hit[0].status==='candidate'&&hit[0].provenance==='dom_observed','retrieval does not confirm facts');
   check((await tool.get_recent()).length===3,'account isolation');
   await mem.ingest(event('compose-1','טיוטה סינתטית לפני שליחה',{type:'input_observed',direction:'outgoing'}));
   await mem.ingest(event('compose-1','טיוטה סינתטית מעודכנת',{type:'input_observed',direction:'outgoing'}));
   check((await tool.get_recent()).filter(x=>x.ref==='compose-1').length===1,'text input updates one draft');
   check((await tool.get_recent()).find(x=>x.ref==='compose-1').kind==='draft','unsent input marked as draft');
   await mem.ingest(event('mail-body-1','קונטקסט סינתטי מגוף המייל',{type:'context_observed'}));
   check((await tool.get_recent()).find(x=>x.ref==='mail-body-1').kind==='context','collected mail context ingested');
   await mem.deleteMessage(scope,'compose-1');await mem.deleteMessage(scope,'mail-body-1');
   check((await mem.tools({...scope,conversationId:'other-thread'}).get_recent()).length===0,'conversation isolation');
   check((await mem.ingest(event('vehicle','הרכב במוסך בגלל תקלה במנוע. התיקון צפוי להסתיים ביום שלישי.'))).reason==='duplicate','DOM replay deduplication');
   check(!(await mem.ingest(event('disabled','לא לשמור',{enabled:false}))).stored,'disabled ingestion rejected');
   let rejected=false;try{await tool.search_history({query:'רכב',top_k:4});}catch{rejected=true;}check(rejected,'tool budget enforced');
   rejected=false;try{mem.tools({...scope,accountId:''});}catch{rejected=true;}check(rejected,'unknown identity rejected');
   // Edits replace both text and embedding.
   clock+=1000;
   await mem.ingest(event('vehicle','השיעור בוטל עקב עבודות בבית המדרש.',{type:'message_edited'}));
   check((await tool.get_recent()).find(x=>x.ref==='vehicle').text.includes('השיעור בוטל'),'edit replaces original');
   const rows=await mem.rows(JSON.stringify([scope.platform,scope.accountId,scope.conversationId]));
   check(rows.length===3&&rows.every(x=>x.embedding.length===384),'persisted vectors with records');
   const originalEmbed=mem.embed;
   mem.embed=async()=>{throw Error('synthetic-embedding-failure');};
   let failed=false;
   try{await mem.ingest(event('vehicle','טקסט חדש שלא יישמר'));}catch{failed=true;}
   mem.embed=originalEmbed;
   check(failed&&(await tool.get_recent()).find(x=>x.ref==='vehicle').text.includes('השיעור בוטל'),'embedding failure preserves prior record');
   check((await mem.ingest(event('vehicle','עדכון ישן',{observedAt:clock-1}))).reason==='stale','out-of-order update rejected');
   await mem.deleteMessage(scope,'vehicle');
   check(!(await tool.search_history({query:'השיעור בוטל'})).some(x=>x.ref==='vehicle'),'delete removes search result');
   // Concurrent write/delete must leave no resurrection.
   await Promise.all([mem.ingest(event('race','תיקון רכב סינתטי')),mem.deleteMessage(scope,'race')]);
   check(!(await tool.get_recent()).some(x=>x.ref==='race'),'in-flight ingestion deletion ordered');
   // Scaling fixture: 2,000 synthetic records, vectors from the three real e5 passages.
   // Batch insert avoids measuring 2,000 duplicate inference calls as search latency.
   const batch=await mem.rows(JSON.stringify([scope.platform,scope.accountId,scope.conversationId]));
   const seededAt=performance.now();
   await mem.transaction('readwrite',s=>{
     for(let i=0;i<2000;i++) s.put({...batch[i%batch.length],id:'bench-'+i,sourceId:'bench-'+i});
   });
   timings.batchSeed2000Ms=performance.now()-seededAt;
   const times=[];
   for(let i=0;i<30;i++){const st=performance.now();await tool.search_history({query:'מתי משלמים לספק?'});times.push(performance.now()-st);}
   times.sort((a,b)=>a-b);timings.endToEndQueryP50Ms=times[15];timings.endToEndQueryP95Ms=times[28];
   check((await tool.search_history({query:'תשלום לספק'})).length===3,'bounded search across 2000 records');
   await mem.deleteConversation(scope);
   check((await tool.get_recent()).length===0,'conversation deletion includes benchmark vectors');
   check((await mem.tools(other).get_recent()).length===1,'conversation deletion preserves other account');
   // Save one record for browser process restart test.
   await mem.ingest(event('restart','רשומה סינתטית לבדיקת פתיחה מחדש'));
   window.scope=scope;window.mem=mem;window.clock=clock;
   return {checks,timings,scope,clock};
 });
 results.checks.push(...outcome.checks);Object.assign(results.timings,outcome.timings);
 await context.close();
 page=await launch();
 const restart=await page.evaluate(async({scope,clock})=>{
   let now=clock;
   const mem=new LocalMemory({embed:async()=>{throw Error('not-needed');},now:()=>now});
   const tools=mem.tools(scope);
   if(!(await tools.get_recent()).some(x=>x.ref==='restart'))throw Error('restart persistence');
   now+=15*86400000;
   if((await tools.get_recent()).length)throw Error('expired rows visible');
   await mem.purge();
   const key=JSON.stringify([scope.platform,scope.accountId,scope.conversationId]);
   if((await mem.rows(key)).length)throw Error('expired vectors not physically deleted');
   await mem.clear();
   if((await mem.transaction('readonly',s=>new Promise((resolve,reject)=>{
     const r=s.count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
   })))!==0)throw Error('clear left records');
   mem.close();
   return ['IndexedDB survives browser process restart','expiry filters reads','purge physically removes text and vectors','clear completed'];
 },outcome);
 results.checks.push(...restart);
 assert.deepEqual(results.externalRequests,[]);
 results.checks.push('all browser requests restricted to loopback');
 results.passed=true;
 console.log(JSON.stringify(results,null,2));
 await writeFile(path.join(here,'browser-results.json'),JSON.stringify(results,null,2)+'\n');
}finally{
 await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});
}
