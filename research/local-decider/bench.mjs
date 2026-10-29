// CPU benchmark and token/probability parity, with no network model fallback.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const {AutoTokenizer,AutoModelForSequenceClassification,env}=await import(pathToFileURL(process.argv[2]+'/node_modules/@huggingface/transformers/dist/transformers.node.mjs'));
env.allowRemoteModels=false;env.localModelPath=process.argv[3]+'/';env.useFSCache=false;
env.backends.onnx.wasm.numThreads=1;
const reference=JSON.parse(fs.readFileSync(process.argv[4],'utf8')),report={runs:{},rows:reference.rows};
for(const run of ['v2','v4-xlmr-ml']){
 const tok=await AutoTokenizer.from_pretrained(run,{local_files_only:true});
 const model=await AutoModelForSequenceClassification.from_pretrained(run,{local_files_only:true,dtype:process.env.DECIDER_FP32==='1'&&run==='v2'?'fp32':'q8',session_options:{intraOpNumThreads:1,interOpNumThreads:1}});
 const synthetic=JSON.parse(fs.readFileSync(process.argv[3]+'/'+run+'/parity.json','utf8'));
 for(const r of synthetic){
  const ids=tok(r.text.trim(),{truncation:true,max_length:96}).input_ids.tolist()[0].map(Number);
  if(JSON.stringify(ids)!==JSON.stringify(r.ids))throw Error('synthetic token parity '+run+' '+r.text+' expected='+JSON.stringify(r.ids)+' actual='+JSON.stringify(ids));
 }
 const ps=[],times=[];let mismatch=0,drift=0;
 for(let i=0;i<reference.rows.length;i++){
  const t=performance.now(),input=tok(reference.rows[i].text.trim(),{truncation:true,max_length:96});
  const ids=input.input_ids.tolist()[0].map(Number);
  if(JSON.stringify(ids)!==JSON.stringify(reference.reference[run].ids[i]))mismatch++;
  const logits=(await model(input)).logits.data;
  const p=1/(1+Math.exp(Number(logits[0])-Number(logits[1])));
  ps.push(p);times.push(performance.now()-t);drift=Math.max(drift,Math.abs(p-reference.reference[run].p[i]));
 }
 const sorted=times.slice(5).sort((a,b)=>a-b);
 report.runs[run]={p:ps,times,token_mismatches:mismatch,max_probability_drift:drift,p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.floor(sorted.length*.95)],synthetic_token_parity:synthetic.length};
 console.log(run,JSON.stringify({...report.runs[run],p:undefined,times:undefined}));
 await model.dispose();
}
fs.writeFileSync(process.argv[5],JSON.stringify(report));
