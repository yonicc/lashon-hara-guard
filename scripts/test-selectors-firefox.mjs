// Synthetic selector compatibility in real Gecko; no signed-in site coverage.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const {firefox}=createRequire(path.resolve(process.argv[2]))('playwright');
const browser=await firefox.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.setContent(`<main id="main"><header><span title="Synthetic chat">Synthetic chat</span></header><div class="message-in"><span class="copyable-text">Synthetic message</span></div><footer><div contenteditable="true" role="textbox"></div></footer></main><div role="textbox" contenteditable="true" data-placeholder="Message"></div><div role="textbox" contenteditable="true" g_editable="true" aria-multiline="true"></div>`);
 await page.addScriptTag({content:readFileSync('extension/selectors.js','utf8')});
 const result=await page.evaluate(()=>{
  const selectors=new Set();
  function walk(o){for(const v of Object.values(o)){if(typeof v==='string')selectors.add(v);else if(v&&typeof v==='object')walk(v);}}
  for(const k of ['memory','whatsapp','googleChat','gmail'])if(LHG_SELECTORS[k])walk(LHG_SELECTORS[k]);
  const invalid=[];for(const s of selectors){try{document.querySelectorAll(s);}catch(e){invalid.push({s,error:e.message});}}
  const match=list=>list.some(s=>document.querySelector(s));
  return {count:selectors.size,invalid,whatsappCompose:match(LHG_SELECTORS.whatsapp.compose),whatsappIncoming:match(LHG_SELECTORS.whatsapp.incomingMessage),chatCompose:match(LHG_SELECTORS.googleChat.compose)};
 });
 assert.deepEqual(result.invalid,[]);
 assert.ok(result.count>20);assert.ok(result.whatsappCompose&&result.whatsappIncoming&&result.chatCompose);
 console.log('GECKO SELECTORS OK '+JSON.stringify(result));
}finally{await browser.close();}
