// Real MV3 options and storage; local engines are absent in this synthetic fixture.
import {createRequire} from 'node:module';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const {chromium}=createRequire(path.resolve(process.argv[2]))('playwright');
const shots=process.argv[3] || path.join(os.tmpdir(),'lhg-presets-shots');
await mkdir(shots,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'lhg-presets-'));
let browser;
try {
 browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1200,height:1000},args:['--disable-extensions-except='+path.resolve('extension'),'--load-extension='+path.resolve('extension')]});
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 for(let i=0;i<100;i++){if(await worker.evaluate(()=>!!globalThis.LHG_CHECK_MODE))break;await new Promise(r=>setTimeout(r,50));}
 await worker.evaluate(async()=>{
   for(const ids of Object.values(LHG_CHECK_MODE.LOCAL_ENGINES)) for(const id of ids) LHG_CHECK_MODE.unregisterLocalEngine(id);
   await chrome.storage.local.set({lhgLang:'he',lhgCheckMode:'cloud',lhgCloudFallback:false,lhgMemoryEnabled:false,lhgRouterEnabled:false});
 });
 const base=worker.url().replace(/\/[^/]*$/,'');
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/options.html');
 await page.locator('.preset-badge:not([hidden])').first().waitFor();
 assert.equal(await page.locator('button.preset').count(),6);
 for(const [lang,dir] of [['he','rtl'],['en','ltr']]){
   await page.locator('[data-lang="'+lang+'"]').click();
   await page.waitForFunction(d=>document.documentElement.dir===d,dir);
   await page.locator('[data-preset="B"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-preset="B"]').getAttribute('aria-pressed')==='true');
   let s=await worker.evaluate(()=>chrome.storage.local.get(null));
   assert.equal(s.lhgCheckMode,'cloud');assert.equal(s.lhgCloudFallback,false);assert.equal(s.lhgMemoryEnabled,true);assert.equal(s.lhgRouterEnabled,true);
   await page.locator('[data-preset="A"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-preset="A"]').getAttribute('aria-pressed')==='true');
   s=await worker.evaluate(()=>chrome.storage.local.get(null));
   assert.equal(s.lhgMemoryEnabled,false);assert.equal(s.lhgRouterEnabled,false);
   const opened=browser.waitForEvent('page');
   await page.locator('[data-preset="E"]').click();
   const setup=await opened;await setup.waitForURL(base+'/ollama-setup.html');
   s=await worker.evaluate(()=>chrome.storage.local.get(null));
   assert.equal(s.lhgCheckMode,'cloud');assert.equal(s.lhgCloudFallback,false);
   await setup.close();
   await page.locator('.preset-advanced > summary').click();
   assert.equal(await page.locator('.preset-advanced').getAttribute('open'),'');
   await page.locator('#cloudFallback').check();
   await page.waitForFunction(()=>document.getElementById('presetCustom').hidden===false);
   assert.equal((await worker.evaluate(()=>chrome.storage.local.get('lhgCloudFallback'))).lhgCloudFallback,true);
   await page.locator('.preset-advanced > summary').click();
   await page.locator('[data-preset="A"]').click();
   await page.screenshot({path:path.join(shots,'options-'+lang+'.png'),fullPage:true});
   const boxes=await page.locator('button.preset').evaluateAll(nodes=>nodes.map(n=>({col:n.dataset.col,row:n.dataset.row,x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
   const cloud=boxes.find(b=>b.col==='cloud'),local=boxes.find(b=>b.col==='local');
   assert.ok(dir==='rtl'?cloud.x>local.x:cloud.x<local.x);
 }
 await page.setViewportSize({width:480,height:900});
 assert.equal(await page.locator('#presetGrid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1);
 await page.screenshot({path:path.join(shots,'options-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS real MV3: six cells, RTL/LTR placement, A/B storage, absent local opens setup without switching, Advanced storage, mobile stacking; shots='+shots);
}finally{await browser?.close();await rm(profile,{recursive:true,force:true});}
