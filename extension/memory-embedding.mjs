// All executable assets are packaged. Only explicit install fetches model data.
export const MODEL_REVISION='761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const MODEL_FILES=['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx'];
export const CACHE='lhg-e5-'+MODEL_REVISION;
const HASHES={
 'config.json':'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
 'tokenizer.json':'0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
 'tokenizer_config.json':'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
 'onnx/model_quantized.onnx':'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
};
async function validate(file,response) {
 const bytes=await response.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==HASHES[file]) throw Error('model-integrity-failed');
 return new Response(bytes,{headers:{'content-type':file.endsWith('.json')?'application/json':'application/octet-stream'}});
}
const local=file=>'https://huggingface.co/Xenova/multilingual-e5-small/resolve/'+MODEL_REVISION+'/'+file;
export async function installModel() {
  const cache=await caches.open(CACHE);
  for(const file of MODEL_FILES) {
    if(await cache.match(local(file))) continue;
    const response=await fetch(local(file)+'?download=true&lhg='+Date.now(),{cache:'no-store'});
    if(!response.ok) throw Error('model-download-failed:'+file+':'+response.status);
    await cache.put(local(file),await validate(file,response));
  }
  return {installed:true};
}
let loading;
export async function importModel(files) {
  const cache=await caches.open(CACHE);
  for(const expected of MODEL_FILES) {
    const matches=Array.from(files).filter(f=>(f.webkitRelativePath||f.name).replaceAll('\\','/').endsWith('/'+expected)||f.name===expected);
    if(matches.length!==1) throw Error('model-files-required');
    await cache.put(local(expected),await validate(expected,new Response(matches[0])));
  }
  return {installed:true};
}
export function loadEmbed() {
  return loading ||= (async()=>{
    const {pipeline,env}=await import('./vendor/transformers.min.mjs');
    env.allowRemoteModels=false; env.allowLocalModels=true;
    env.localModelPath=chrome.runtime.getURL('models/');
    env.useBrowserCache=false; env.useFSCache=false; env.useCustomCache=true;
    env.customCache=await caches.open(CACHE);
    env.backends.onnx.wasm.wasmPaths=chrome.runtime.getURL('vendor/');
    env.backends.onnx.wasm.numThreads=1; env.backends.onnx.wasm.proxy=false;
    const extractor=await pipeline('feature-extraction','Xenova/multilingual-e5-small',{quantized:true,local_files_only:true,revision:MODEL_REVISION});
    return async text=>Array.from((await extractor(text,{pooling:'mean',normalize:true})).data);
  })().catch(e=>{loading=null;throw e;});
}
