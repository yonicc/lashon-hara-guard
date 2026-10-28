// Explicit folder import only; cached model data, packaged executable code.
import {headsFromLogits} from './memory-router.mjs';
import {loadEmbed} from './memory-embedding.mjs';
export const ROUTER_CACHE='lhg-router-r2-e5s-emb8-v1';
export const ROUTER_HASHES=Object.freeze({
 'config.json':'cbb681465f86f41029f699362e139a04c46c210973c00ec2a8065765ae1782ba',
 'tokenizer.json':'9ec41bf93aea6a98979854d4411532d0b05401fffad8c1d95c5463a137e26254',
 'tokenizer_config.json':'ce30001b1b5e8e9cb010e74fdaff3025007f0330eb0fb7da81774f11efdd8845',
 'onnx/model_quantized.onnx':'99d63c867dbe4876bf31766d878da0dcc16bd294abc378e736e5b0a4c48d7a94'
});
const key=file=>'https://lhg.invalid/models/r2-e5s-emb8/'+file;
export async function importRouter(files) {
  const selected=[];
  // Validate everything before replacing any cached file.
  for(const [file,expected] of Object.entries(ROUTER_HASHES)) {
    const hits=Array.from(files).filter(f=>(f.webkitRelativePath||f.name).replaceAll('\\','/').endsWith('/'+file)||f.name===file);
    if(hits.length!==1) throw Error('router-files-required');
    const bytes=await hits[0].arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==expected) throw Error('router-integrity-failed');
    selected.push([file,bytes]);
  }
  const cache=await caches.open(ROUTER_CACHE);
  for(const [file,bytes] of selected) await cache.put(key(file),new Response(bytes));
}
let loading;
export function loadRouter() {
  return loading ||= (async()=>{
    const cache=await caches.open(ROUTER_CACHE);
    for(const file of Object.keys(ROUTER_HASHES)) if(!(await cache.match(key(file)))) throw Error('router-not-installed');
    await loadEmbed();
    const {AutoTokenizer,AutoModelForSequenceClassification,env}=await import('./vendor/transformers.min.mjs');
    const embeddingCache=env.customCache;
    // Global env is also used by embeddings. Set it synchronously, without replacing its cache.
    env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.useFSCache=false;
    env.useCustomCache=true;
    env.localModelPath=chrome.runtime.getURL('models/');
    env.customCache={put:async()=>{},match:async url=>{
      const raw=String(url);
      const marker='/r2-e5s-emb8/';
      if(raw.includes(marker)) return cache.match(key(raw.split(marker)[1].replace(/^resolve\/[^/]+\//,'')));
      return embeddingCache.match(url);
    }};
    env.backends.onnx.wasm.wasmPaths=chrome.runtime.getURL('vendor/');
    env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
    const opts={quantized:true,local_files_only:true};
    const tokenizer=await AutoTokenizer.from_pretrained('r2-e5s-emb8',opts);
    const model=await AutoModelForSequenceClassification.from_pretrained('r2-e5s-emb8',opts);
    return async text=>headsFromLogits((await model(tokenizer(text,{truncation:true,max_length:96}))).logits.data);
  })().catch(e=>{loading=null;throw e;});
}
