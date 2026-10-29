import {DECIDER_ID,DECIDER_HASHES,DECIDER_BYTES} from './decider-manifest.mjs';
import {usesSecondModel,combineProbability} from './decider-route.mjs';
import {meaningBand} from './decider-policy.mjs';
export const DECIDER_CACHE='lhg-meaning-'+DECIDER_ID+'-chunks-v1';
const CHUNK=32*1024*1024;
const key=file=>'https://lhg.invalid/meaning/'+DECIDER_ID+'/'+file;
const parts=file=>DECIDER_BYTES[file]?Array.from({length:Math.ceil(DECIDER_BYTES[file]/CHUNK)},(_,i)=>file+'.part'+i):[file];
export async function deciderInstalled(){
 const cache=await caches.open(DECIDER_CACHE);
 return (await Promise.all(Object.keys(DECIDER_HASHES).flatMap(parts).map(f=>cache.match(key(f))))).every(Boolean);
}
export async function importDecider(files){
 const selected=[];
 // Hash every file before making this version available. Never fetch model data during inference.
 for(const [file,hash] of Object.entries(DECIDER_HASHES)){
  const hits=Array.from(files).filter(f=>(f.webkitRelativePath||f.name).replaceAll('\\','/').endsWith('/'+file));
  if(hits.length!==1)throw Error('decider-files-required');
  const bytes=await hits[0].arrayBuffer();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==hash)throw Error('decider-integrity-failed');
  selected.push([file,hits[0]]);
 }
 const cache=await caches.open(DECIDER_CACHE);
 for(const [file,blob] of selected){
  const names=parts(file);
  for(let i=0;i<names.length;i++)await cache.put(key(names[i]),new Response(DECIDER_BYTES[file]?blob.slice(i*CHUNK,Math.min((i+1)*CHUNK,blob.size)):blob));
 }
 await chrome.storage.local.set({lhgDeciderArtifact:DECIDER_ID});
}
let loading;
export function loadDecider(){
 return loading ||= (async()=>{
  if(!await deciderInstalled())throw Error('decider-not-installed');
  const cache=await caches.open(DECIDER_CACHE);
  const {AutoTokenizer,AutoModelForSequenceClassification,env}=await import('./vendor/decider/transformers.min.mjs');
  env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.useFSCache=false;
  env.localModelPath=chrome.runtime.getURL('models/meaning/');
  env.useCustomCache=true;env.customCache={put:async()=>{},match:async url=>{
   const raw=String(url),prefix=env.localModelPath;
   if(!raw.startsWith(prefix))return undefined;
   const file=raw.slice(prefix.length);
   if(!DECIDER_BYTES[file])return cache.match(key(file));
   let i=0;const names=parts(file);
   return new Response(new ReadableStream({async pull(controller){
    if(i===names.length){controller.close();return;}
    const response=await cache.match(key(names[i++]));
    if(!response){controller.error(Error('decider-not-installed'));return;}
    controller.enqueue(new Uint8Array(await response.arrayBuffer()));
   }}),{headers:{'Content-Length':String(DECIDER_BYTES[file])}});
  }};
  env.backends.onnx.wasm.wasmPaths=chrome.runtime.getURL('vendor/decider/');
  env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  const models=new Map();
  async function score(run,text){
   let pair=models.get(run);
   if(!pair){
    const opts={local_files_only:true,dtype:run==='v2'?'fp32':'q8',device:'wasm'};
    pair=[await AutoTokenizer.from_pretrained(run,opts),await AutoModelForSequenceClassification.from_pretrained(run,opts)];
    models.set(run,pair);
   }
   const logits=(await pair[1](pair[0](text,{truncation:true,max_length:96}))).logits.data;
   return 1/(1+Math.exp(Number(logits[0])-Number(logits[1])));
  }
  return async text=>{
   if(typeof text!=='string'||!text.trim()||text.length>10000)throw Error('decider-bad-input');
   const clean=text.trim(),he=await score('v2',clean);
   const ml=usesSecondModel(clean)?await score('v4-xlmr-ml',clean):null;
   const p=combineProbability(he,ml),band=meaningBand(p);
   return {artifact:DECIDER_ID,p,band,alert:band==='warn'?'warn':'unsure'};
  };
 })().catch(e=>{loading=null;throw e;});
}
