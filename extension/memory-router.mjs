// Bounded, read-only context routing. The model never chooses scope or arguments.
export const HEADS=Object.freeze(['mem_recent','mem_search','ask_user']);
// Calibrated on the shipped emb8 artifact in summary_r2_int8.json (historical run name).
export const THRESHOLDS=Object.freeze([0.0336,0.1139,0.0367]);
export function headsFromLogits(logits) {
  if(logits?.length!==3 || !Array.from(logits).every(Number.isFinite)) throw Error('invalid-router-output');
  return HEADS.filter((_,i)=>1/(1+Math.exp(-logits[i]))>=THRESHOLDS[i]);
}
export async function bounded(work,ms) {
  let timer;
  try {return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('router-timeout')),ms);
  })]);} finally {clearTimeout(timer);}
}
export async function expandMemory({memory,scope,text,route,now=Date.now}) {
  // No fallback identity, no model writes, no tool loop. Failure means plain check.
  try {
    if(typeof text!=='string'||!text.trim()) throw Error('empty-text');
    const started=performance.now();
    const tools=memory.tools(scope); // validates and binds identity before inference
    const labels=await bounded(()=>route(text.slice(0,10000)),150);
    if(!Array.isArray(labels)||labels.some(l=>!HEADS.includes(l))) throw Error('invalid-heads');
    const candidates=[],seen=new Set(),trace=[];
    // Search first so older relevant evidence survives the shared five-excerpt cap.
    for(const [label,name,args] of [
      ['mem_search','search_history',{query:text.slice(0,300),top_k:3}],
      ['mem_recent','get_recent',{k:5}]
    ]) {
      if(!labels.includes(label)) continue;
      const left=400-(performance.now()-started);
      if(left<=0) break;
      try {
        const rows=await bounded(()=>tools[name](args),Math.min(50,left));
        trace.push({getter:name,status:rows.length?'ok':'unknown'});
        for(const row of rows) {
          if(seen.has(row.ref)||row.text===text.slice(0,300)||candidates.length>=5) continue;
          seen.add(row.ref);
          // Keep draft/context/message provenance. No source IDs or claimed author identity.
          candidates.push({text:String(row.text).slice(0,300),direction:row.direction,
            kind:row.kind,provenance:row.provenance,status:'candidate',
            ageMinutes:Number.isFinite(row.observedAt)?Math.max(0,Math.round((now()-row.observedAt)/60000)):undefined});
        }
      } catch {trace.push({getter:name,status:'unknown'});}
    }
    return {status:'ok',labels:[...new Set(labels)],candidates,trace,
      // Only the existing catalog/engine may decide which questions to ask.
      askUser:labels.includes('ask_user')?'unknown':undefined};
  } catch {return {status:'unknown',candidates:[]};}
}
