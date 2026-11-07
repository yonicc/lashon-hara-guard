import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalCheck } from '../src/accountAccess.js';
import type { Env } from '../src/handler.js';
const env:Env={LHG_BRAIN_BASE_URL:'https://brain.test',LHG_BRAIN_TOKEN:'unused',LHG_ACCESS_KEY:'legacy',LHG_ACCOUNT_BASE:'https://center.test',LHG_ACCOUNT_KEY:'synthetic'};
function request(key='lap_synthetic'){return new Request('https://proxy.test/check',{method:'POST',headers:{'x-lhg-key':key},body:JSON.stringify({text:'synthetic'})});}
for(const receipt of [{status:'captured',chargedAgorot:7},{status:'captured',chargedAgorot:0},{status:'released',chargedAgorot:0}]){
 test('wire receipt preserves actual settlement '+JSON.stringify(receipt),async()=>{
  const fetcher=(async(u:any)=>Response.json(String(u).endsWith('/finish')?receipt:{userId:'synthetic'})) as typeof fetch;
  const failed=receipt.status==='released';
  const payload={status:failed?'failed':'extracted',alert:failed?'not_checked':'warn',rules:{findings:[]},confirmedFacts:[],checkError:failed?{code:'provider_error'}:undefined};
  const r=await personalCheck(request(),env,async()=>Response.json(payload,{headers:{'x-synthetic':'kept'}}),fetcher);
  assert.equal(r.headers.get('x-synthetic'),'kept');
  assert.deepEqual(await r.json(),{...JSON.parse(JSON.stringify(payload)),billing:receipt});
 });
}
test('unknown settlement never implies zero; retry captures only once',async()=>{
 for(const mode of ['old','malformed','unavailable','retry']){
  let n=0;
  const fetcher=(async(u:any)=>{
   if(!String(u).endsWith('/finish'))return Response.json({userId:'synthetic'});
   n++;
   if(mode==='unavailable'||mode==='retry'&&n===1)return Response.json({},{status:503});
   return Response.json(mode==='old'?{status:'captured'}:mode==='malformed'?{status:'released',chargedAgorot:3}:{status:'captured',chargedAgorot:3});
  }) as typeof fetch;
  const r=await personalCheck(request(),env,async()=>Response.json({status:'extracted'}),fetcher);
  assert.deepEqual((await r.json() as any).billing,mode==='retry'?{status:'captured',chargedAgorot:3}:{status:'unknown',chargedAgorot:null});
  assert.equal(n,mode==='retry'||mode==='unavailable'?2:1);
 }
});
test('legacy checks do not charge central wallet',async()=>{
 const r=await personalCheck(request('legacy'),env,async()=>Response.json({status:'extracted'}),(async()=>{throw Error('unexpected central call');}) as typeof fetch);
 assert.deepEqual((await r.json() as any).billing,{status:'not_charged',chargedAgorot:0});
});
