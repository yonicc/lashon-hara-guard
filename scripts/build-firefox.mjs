// Firefox (AMO) build: stage extension/ with manifest.firefox.json as
// manifest.json, drop Chrome-only files and tests, validate, and zip.
//   node scripts/build-firefox.mjs [--check] [--out <dir>]
// --check validates without writing a zip. Output (default dist-firefox/):
//   lhg-firefox-<version>.zip + .sha256 sidecar (git-ignored).
import {readFileSync,writeFileSync,existsSync,rmSync,mkdirSync,cpSync,readdirSync,statSync,createWriteStream} from 'node:fs';
import {join,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const ext=join(root,'extension');
const args=process.argv.slice(2);
const checkOnly=args.includes('--check');
const outFlag=args.indexOf('--out');
const outDir=join(root,outFlag>=0?args[outFlag+1]:'dist-firefox');
const stage=join(outDir,'stage');
const fail=m=>{console.error('FIREFOX BUILD FAILED: '+m);process.exit(1);};
// Excluded from the Firefox package (Chrome-only, tests, or unsupported v1).
const EXCLUDE_FILES=new Set([
  'manifest.firefox.json', // shipped as manifest.json instead
  'memory-offscreen.html','memory-offscreen.mjs', // no offscreen API in Firefox
  'decider-manifest.mjs','decider-model.mjs','decider-policy.mjs','decider-route.mjs', // threaded JSEP, unsupported v1
  'gmail-browser.cjs','gmail-browser-ux.cjs', // Chromium test helpers
  'GMAIL-CHECKS.md', // dev doc
]);
const EXCLUDE_DIRS=new Set(['vendor/decider']); // threaded JSEP binaries (~22MB)
const failList=[];
function walk(dir,base='') {
  for(const name of readdirSync(dir)) {
    if(name.startsWith('.')) continue;
    const rel=base?base+'/'+name:name;
    const full=join(dir,name);
    if(statSync(full).isDirectory()) {
      if(!EXCLUDE_DIRS.has(rel)) walk(full,rel);
      continue;
    }
    if(EXCLUDE_FILES.has(rel)||name.endsWith('.test.cjs')||name.endsWith('.testlib.cjs')) continue;
    const dest=join(stage,rel);
    mkdirSync(dirname(dest),{recursive:true});
    cpSync(full,dest);
  }
}
const chromeManifest=JSON.parse(readFileSync(join(ext,'manifest.json'),'utf8'));
const fxManifest=JSON.parse(readFileSync(join(ext,'manifest.firefox.json'),'utf8'));
if(chromeManifest.version!==fxManifest.version) fail('version skew: manifest.json '+chromeManifest.version+' vs manifest.firefox.json '+fxManifest.version);
if((fxManifest.permissions||[]).includes('offscreen')) fail('Firefox manifest must not request offscreen');
if(fxManifest.background?.service_worker) fail('Firefox manifest must not use service_worker');
for(const f of fxManifest.background?.scripts||[]) {
  if(!existsSync(join(ext,f))) fail('background script missing: '+f);
}
const scripts=fxManifest.background?.scripts||[];
if(scripts[scripts.length-1]!=='background.js') fail('background.js must load last');
const csp=fxManifest.content_security_policy?.extension_pages||'';
if(!csp.includes("'wasm-unsafe-eval'")) fail('Firefox CSP must allow wasm-unsafe-eval');
if(!fxManifest.browser_specific_settings?.gecko?.id) fail('Firefox manifest needs browser_specific_settings.gecko.id');
const optHosts=fxManifest.optional_host_permissions||[];
for(const h of ['127.0.0.1','lhg-proxy','huggingface.co','*.hf.co']) {
  if(!optHosts.some(o=>o.includes(h))) fail('optional_host_permissions missing '+h);
}
rmSync(stage,{recursive:true,force:true});
mkdirSync(stage,{recursive:true});
walk(ext);
writeFileSync(join(stage,'manifest.json'),JSON.stringify(fxManifest,null,2)+'\n');
// AMO/site distribution uses the same public-mode flag as the Chrome package.
writeFileSync(join(stage,'check-mode.js'),'globalThis.LHG_PUBLIC_BUILD = true;\n'+readFileSync(join(stage,'check-mode.js'),'utf8'));
// Validate the staged tree (not just the source).
const staged=[];
(function collect(dir,base='') {
  for(const name of readdirSync(dir)) {
    const rel=base?base+'/'+name:name;
    const full=join(dir,name);
    if(statSync(full).isDirectory()) {collect(full,rel);continue;}
    staged.push(rel);
  }
})(stage);
for(const s of staged) {
  if(s.endsWith('.test.cjs')||s.endsWith('.testlib.cjs')) failList.push('test file staged: '+s);
  if(s.includes('threaded')) failList.push('threaded WASM staged: '+s);
}
for(const f of scripts) {
  if(!staged.includes(f)) failList.push('staged background script missing: '+f);
}
for(const cs of fxManifest.content_scripts||[]) {
  for(const f of [...(cs.js||[]),...(cs.css||[])]) {
    if(!staged.includes(f)) failList.push('staged content file missing: '+f);
  }
}
if(!staged.includes(fxManifest.options_ui?.page||'')) failList.push('options_ui page missing');
if(!staged.includes('memory-firefox.mjs')) failList.push('memory-firefox.mjs missing');
if(staged.includes('memory-offscreen.mjs')) failList.push('offscreen doc must not ship in Firefox build');
for(const loader of ['memory-embedding.mjs','memory-router-model.mjs']) {
  const src=readFileSync(join(stage,loader),'utf8');
  if(!src.includes('numThreads=1')||!src.includes('proxy=false')) failList.push(loader+' must pin single-threaded WASM');
}
const bgSrc=readFileSync(join(stage,'memory-background.js'),'utf8');
if(!bgSrc.includes('memory-firefox.mjs')) failList.push('memory-background.js must branch to memory-firefox.mjs');
const ffSrc=readFileSync(join(stage,'memory-firefox.mjs'),'utf8');
if(ffSrc.includes('decider-model.mjs')) failList.push('memory-firefox.mjs must not load the threaded decider');
if(!ffSrc.includes('decider-unsupported-firefox')) failList.push('memory-firefox.mjs must fail decider ops closed');
if(failList.length) fail('\n - '+failList.join('\n - '));
const bytes=staged.reduce((n,s)=>n+statSync(join(stage,s)).size,0);
console.log('staged '+staged.length+' files, '+(bytes/1048576).toFixed(1)+' MiB');
if(checkOnly) {console.log('FIREFOX CHECK OK');process.exit(0);}
const zipName='lhg-firefox-'+fxManifest.version+'.zip';
const zipPath=join(outDir,zipName);
rmSync(zipPath,{force:true});
if(process.platform==='win32') {
  // Not Compress-Archive: on Windows PowerShell 5.1 it stores 'vendor\x' entry names.
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',
    join(root,'scripts','zip-forward-slash.ps1'),stage,zipPath],{stdio:'inherit'});
} else {
  execFileSync('zip',['-r','-X','-q',zipPath,'.'],{cwd:stage,stdio:'inherit'});
}
const sha256=createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(zipPath+'.sha256',sha256+'  '+zipName+'\n');
console.log('wrote '+relative(root,zipPath)+' ('+(statSync(zipPath).size/1048576).toFixed(1)+' MiB) sha256='+sha256);
console.log('FIREFOX BUILD OK');
