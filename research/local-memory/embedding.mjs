// Serve vendor JS, WASM and model files locally. No remote inference or fallback.
export async function loadLocalEmbed() {
  const {pipeline,env}=await import('/vendor/transformers.min.js');
  env.allowRemoteModels=false; env.localModelPath='/models/'; env.useBrowserCache=false;
  env.backends.onnx.wasm.wasmPaths='/wasm/';
  env.backends.onnx.wasm.numThreads=1;
  const extractor=await pipeline('feature-extraction','Xenova/multilingual-e5-small',{quantized:true});
  return async text=>{
    const r=await extractor(text,{pooling:'mean',normalize:true});
    return Array.from(r.data);
  };
}
