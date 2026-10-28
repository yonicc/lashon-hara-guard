const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {createDocument}=require('./mini-dom.testlib.cjs');
function fixture(html,{wid=null,enabled=true}={}) {
 const document=createDocument(html),sent=[];
 const context=vm.createContext({document,crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>wid},setTimeout,clearTimeout,console,
 chrome:{runtime:{sendMessage:m=>{sent.push(m);return Promise.resolve({ok:true,result:[]});}}},
 LHG_SETTINGS:{get:()=>({lhgMemoryEnabled:enabled}),isActive:()=>true}});
 for(const file of ['selectors.js','memory-content.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 return {document,sent,memory:context.LHG_MEMORY};
}
const account='<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account (one@example.invalid)"></a>';
test('memory: unknown account and display-name-only conversation never persist',()=>{
 const f=fixture('<div data-thread-id="t"><div id="box"></div></div>');
 assert.equal(f.memory.scopeFor('gmail',f.document.querySelector('#box')),null);
 const w=fixture('<main id="main"><header><span title="Shared name">Shared name</span></header><div id="box"></div></main>',{wid:'"12345@c.us"'});
 assert.equal(w.memory.scopeFor('whatsapp-web',w.document.querySelector('#box')),null);
});
test('memory: Google account ambiguity is unknown',()=>{
 const f=fixture(account+'<a href="https://accounts.google.com/SignOutOptions" aria-label="two@example.invalid"></a><div data-thread-id="t" id="box"></div>');
 assert.equal(f.memory.scopeFor('gmail',f.document.querySelector('#box')),null);
});
test('memory: Chat group and Gmail thread scopes use explicit IDs',()=>{
 for(const [platform,attr] of [['gmail','data-thread-id'],['google-chat','data-group-id']]) {
 const f=fixture(account+'<div '+attr+'="synthetic-thread"><div id="box"></div></div>');
 const s=f.memory.scopeFor(platform,f.document.querySelector('#box'));
 assert.equal(s.accountId,'one@example.invalid');assert.equal(s.conversationId,'synthetic-thread');
 }
});
test('memory: WhatsApp uses self WID and remote JID, not the title',()=>{
 const f=fixture('<main id="main"><div data-id="false_45678@c.us_SYNTH"><div id="box"></div></div></main>',{wid:'"12345@c.us"'});
 const s=f.memory.scopeFor('whatsapp-web',f.document.querySelector('#box'));
 assert.equal(s.accountId,'12345@c.us');assert.equal(s.conversationId,'45678@c.us');
});
test('memory: missing thread gives each new draft a separate local scope',()=>{
 const f=fixture(account+'<div id="a"></div><div id="b"></div>');
 const a=f.document.querySelector('#a'),b=f.document.querySelector('#b');
 assert.equal(f.memory.scopeFor('gmail',a),null);
 assert.notEqual(f.memory.scopeFor('gmail',a,{draft:true}).conversationId,f.memory.scopeFor('gmail',b,{draft:true}).conversationId);
});
test('memory: short input coalesces latest text and blank cancels pending writes',async()=>{
 const f=fixture(account+'<div data-thread-id="t"><div id="box"></div></div>'),el=f.document.querySelector('#box');
 f.memory.input('gmail',el,'a');f.memory.input('gmail',el,'ab');
 await new Promise(r=>setTimeout(r,180));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].event.text,'ab');
 f.memory.input('gmail',el,'abc');f.memory.input('gmail',el,'');
 await new Promise(r=>setTimeout(r,180));assert.equal(f.sent.length,2);assert.equal(f.sent[1].op,'delete');
});
test('memory: disabling memory sends no text',async()=>{
 const f=fixture(account+'<div data-thread-id="t" data-message-id="m" id="box"></div>',{enabled:false});
 const el=f.document.querySelector('#box');
 f.memory.input('gmail',el,'synthetic');f.memory.context('gmail',el,'synthetic');
 await new Promise(r=>setTimeout(r,180));assert.equal(f.sent.length,0);
});
test('memory: queued scope snapshot survives a conversation switch',async()=>{
 const f=fixture(account+'<div data-thread-id="first" data-message-id="m" id="box"></div>');
 const el=f.document.querySelector('#box');f.memory.context('gmail',el,'synthetic');
 el.setAttribute('data-thread-id','second');await new Promise(r=>setTimeout(r,180));
 assert.equal(f.sent[0].event.scope.conversationId,'first');
});
test('memory: model tool arguments cannot change the bound scope',async()=>{
 const f=fixture(account+'<div data-thread-id="bound" id="box"></div>');
 const tool=f.memory.tools('gmail',f.document.querySelector('#box'));
 assert.deepEqual(Object.keys(tool).sort(),['get_recent','search_history']);
 await tool.get_recent({accountId:'forged',conversationId:'forged'});
 assert.equal(f.sent[0].scope.conversationId,'bound');assert.equal(f.sent[0].scope.accountId,'one@example.invalid');
});
