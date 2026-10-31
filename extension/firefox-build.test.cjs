const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const fxManifest=JSON.parse(read('manifest.firefox.json'));
const chromeManifest=JSON.parse(read('manifest.json'));
test('firefox manifest tracks the chrome manifest version',()=>{
 assert.equal(fxManifest.version,chromeManifest.version);
 assert.equal(fxManifest.manifest_version,3);
});
test('firefox manifest uses an event page, no offscreen, gecko id and options_ui',()=>{
 assert.ok(!(fxManifest.permissions||[]).includes('offscreen'));
 assert.ok(!fxManifest.background?.service_worker);
 const scripts=fxManifest.background?.scripts||[];
 assert.ok(scripts.length>1);
 assert.equal(scripts[scripts.length-1],'background.js');
 for(const f of scripts) assert.ok(fs.existsSync(path.join(__dirname,f)),'missing '+f);
 // The event page has no importScripts: the manifest list must mirror the
 // service worker importScripts chain in order, with background.js last.
 const chain=[];
 for(const m of read('background.js').matchAll(/importScripts\(([^)]*)\)/g)) {
  for(const q of m[1].matchAll(/'([^']+)'/g)) chain.push(q[1]);
 }
 assert.deepEqual(scripts,[...chain,'background.js']);
 assert.equal(fxManifest.browser_specific_settings?.gecko?.id,'lhg@ysho.uk');
 assert.ok(fxManifest.browser_specific_settings?.gecko?.strict_min_version);
 assert.equal(fxManifest.browser_specific_settings.gecko.strict_min_version,'140.0');
 assert.ok(fxManifest.browser_specific_settings.gecko.data_collection_permissions.required.includes('personalCommunications'));
 assert.ok((fxManifest.content_security_policy?.extension_pages||'').includes("'wasm-unsafe-eval'"));
 assert.ok(fs.existsSync(path.join(__dirname,fxManifest.options_ui?.page||'')));
 for(const cs of fxManifest.content_scripts||[]) {
  for(const f of [...(cs.js||[]),...(cs.css||[])]) assert.ok(fs.existsSync(path.join(__dirname,f)),'missing '+f);
 }
});
test('firefox host permissions are opt-in and match the request helper',()=>{
 const c=vm.createContext({});c.globalThis=c;
 vm.runInContext(read('permissions.js'),c);
 const origins=c.LHG_PERMISSIONS.ORIGINS;
 // Normalize the VM realm's Array prototype before strict comparison.
 assert.deepEqual(fxManifest.optional_host_permissions,Array.from(origins));
 assert.ok(!fxManifest.host_permissions);
 for(const h of ['127.0.0.1','lhg-proxy','huggingface.co','*.hf.co']) {
  assert.ok(origins.some(o=>o.includes(h)),'missing '+h);
 }
 assert.equal(c.LHG_PERMISSIONS.isFirefox(),false); // no `browser` in node
});
test('firefox permission request retains the click user gesture',async()=>{
 const calls=[];
 const c=vm.createContext({chrome:{permissions:{
  request:()=>{calls.push('request');return Promise.resolve(true);},
  contains:()=>{calls.push('contains');return Promise.resolve(true);}
 }}});
 vm.runInContext(read('permissions.js'),c);
 const result=c.LHG_PERMISSIONS.ensureAll();
 assert.deepEqual(calls,['request']);
 assert.equal((await result).granted,true);
});
test('firefox memory branch bypasses the offscreen document',()=>{
 const bg=read('memory-background.js');
 assert.ok(bg.includes('memory-firefox.mjs'));
 assert.ok(bg.includes('getBrowserInfo'));
 assert.ok(bg.includes("if(isFirefox) return firefoxRelay(data);"));
 const ff=read('memory-firefox.mjs');
 assert.ok(ff.includes('handleDirect'));
 assert.ok(ff.includes('decider-unsupported-firefox'));
 assert.ok(!ff.includes('decider-model.mjs'));
 assert.ok(!ff.includes('onMessage'));
});
test('firefox WASM stays single-threaded (no SharedArrayBuffer)',()=>{
 for(const loader of ['memory-embedding.mjs','memory-router-model.mjs']) {
  const src=read(loader);
  assert.ok(src.includes('numThreads=1'),loader);
  assert.ok(src.includes('proxy=false'),loader);
 }
 const build=read('../scripts/build-firefox.mjs');
 assert.ok(build.includes('vendor/decider')); // threaded JSEP excluded from the zip
 assert.ok(build.includes('memory-offscreen.mjs'));
});
test('firefox permission UI strings exist in both languages',()=>{
 const src=read('i18n.js');
 for(const k of ['perm.title','perm.hint','perm.grant','perm.granted','perm.missing','perm.deciderUnsupported']) {
  assert.ok(src.split("'"+k+"'").length-1>=2,'missing '+k);
 }
 const html=read('options.html');
 assert.ok(html.includes('permissions.js'));
 assert.ok(html.includes('permCard'));
 assert.ok(html.includes('data-i18n="perm.grant"'));
});
