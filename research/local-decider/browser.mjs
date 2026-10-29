// Real MV3, explicit pinned folder import, cached-only CPU inference in offscreen.
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {usesSecondModel,combineProbability} from '../../extension/decider-route.mjs';
const {chromium}=createRequire('C:/Users/dev/lhg-worktrees/browser-tools/package.json')('playwright');
const reference=JSON.parse(await readFile('C:/Users/dev/lhg-design/decider-bench-d2-fp32.json','utf8'));
const profile=await mkdtemp(path.join(os.tmpdir(),'lhg-decider-')),external=[];
let browser;
try{
 console.log('Starting Chromium');
 browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1200,height:950},args:['--disable-extensions-except='+path.resolve('extension'),'--load-extension='+path.resolve('extension')]});
 console.log('Chromium launched; service workers='+browser.serviceWorkers().length);
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker',{timeout:30000});
 console.log('Worker '+worker.url());
 const base=worker.url().replace(/\/[^/]*$/,'');
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>console.log('PAGE '+m.type()+': '+m.text().slice(0,300)));
 browser.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
 await page.goto(base+'/options.html');
 console.log('Options loaded');
 await page.waitForFunction(()=>document.getElementById('deciderStatus').textContent.includes('Not installed'));
 console.log('Not installed status verified; selecting folder');
 await page.locator('#deciderImport').setInputFiles('D:/lhg-decider-models/d2-js');
 console.log('Folder selected; awaiting verified import');
 await Promise.race([page.waitForFunction(()=>document.getElementById('deciderStatus').textContent==='Installed',{},{timeout:180000}),new Promise((_,reject)=>setTimeout(()=>reject(Error('import-timeout')),90000))]).catch(async e=>{
  console.log('Import failed; errors='+JSON.stringify(errors));
  console.log('Import status='+await Promise.race([page.locator('#deciderStatus').innerText(),new Promise(resolve=>setTimeout(()=>resolve('page-unresponsive'),3000))]));throw e;
 });
 console.log('PASS explicit hash-verified folder import');
 const results=[];
 for(let i=0;i<reference.rows.length;i++){
  const row=reference.rows[i];
  const r=await worker.evaluate(async text=>{const t=performance.now();return {result:await LHG_LOCAL_MEANING({text}),ms:performance.now()-t};},row.text);
  results.push(r);if(i%100===0)console.log('Scored '+i);
 }
 const {T_LOW,T_HIGH}=await import('../../extension/decider-policy.mjs');
 let flips=0,maxDrift=0;
 for(let i=0;i<results.length;i++){
  const raw=reference.rows[i].text,he=reference.runs.v2.p[i],ml=reference.runs['v4-xlmr-ml'].p[i],p=combineProbability(he,usesSecondModel(raw)?ml:null);
  maxDrift=Math.max(maxDrift,Math.abs(results[i].result.p-p));
  if((p>=T_HIGH)!==(results[i].result.alert==='warn')||(p<T_LOW)!==(results[i].result.band==='low'))flips++;
 }
 assert.equal(flips,0);assert.ok(maxDrift<.0001,'browser vs native probability parity');
 // Real meaning engine, synthetic fact engine: verify cautious union without asking Ollama.
 const warning=reference.rows[results.findIndex(r=>r.result.alert==='warn')].text;
 const behavior=await worker.evaluate(async text=>{
  LHG_CHECK_MODE.registerLocalEngine({id:'extractor-7b-q4',available:async()=>true,check:async()=>({alert:'unsure'})});
  const r=await LHG_CHECK_MODE.route({text},{lhgCheckMode:'local-fast'},()=>{throw Error('unexpected cloud');});
  LHG_CHECK_MODE.registerLocalEngine({id:'extractor-7b-q4',available:async()=>true,check:async()=>({alert:'warn',rules:{findings:[{id:'sentinel'}]}})});
  const kept=await LHG_CHECK_MODE.route({text:'שלום'},{lhgCheckMode:'local-fast'},()=>{throw Error('unexpected cloud');});
  return {r,kept};
 },warning);
 assert.equal(behavior.r.alert,'warn');assert.equal(behavior.kept.rules.findings[0].id,'sentinel');
 for(const [lang,dir] of [['he','rtl'],['en','ltr']]){
  await page.locator('[data-lang="'+lang+'"]').click();await page.waitForFunction(d=>document.documentElement.dir===d,dir);
  await page.waitForFunction(expected=>document.getElementById('deciderStatus').textContent===expected,lang==='he'?'מותקן':'Installed');
  const card=page.locator('section.card').filter({has:page.locator('#deciderImport')});
  if(lang==='en')assert.equal(/[֐-׿]/.test(await card.innerText()),false,await card.innerText());
  await card.screenshot({path:'C:/Users/dev/lhg-design/shots/decider-'+lang+'.png'});
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('section.card').filter({has:page.locator('#deciderImport')}).screenshot({path:'C:/Users/dev/lhg-design/shots/decider-mobile-en.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const sorted=results.slice(5).map(r=>r.ms).sort((a,b)=>a-b);
 const summary={n:results.length,decision_flips:flips,max_probability_drift:maxDrift,p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.floor(sorted.length*.95)],first_ms:results[0].ms,external_requests:external};
 await writeFile('C:/Users/dev/lhg-design/decider-browser.json',JSON.stringify({summary,results},null,2));
 console.log('PASS real MV3 '+JSON.stringify(summary));
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
