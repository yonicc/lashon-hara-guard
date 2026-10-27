import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Env } from '../src/handler.js';

const base: Env = { LHG_BRAIN_BASE_URL:'https://brain.test', LHG_BRAIN_TOKEN:'unused',
 LHG_ACCESS_KEY:'legacy', LHG_ACCOUNT_BASE:'https://center.test', LHG_ACCOUNT_KEY:'unused' };
const req = (path:string, token='lap_test', ip='192.0.2.1') => new Request('https://proxy.test'+path,
 {method:'POST',headers:{'x-lhg-key':token,'cf-connecting-ip':ip},body:JSON.stringify({text:'synthetic'})});
const neverProvider = () => { throw Error('provider must not run'); };

test('edge rejects both routes before account calls, even with rotating tokens', async()=>{
 for(const path of ['/check','/warm']){
  let calls=0;
  const env={...base, EDGE_LIMITER:{async limit({key}:{key:string}){assert.equal(key,'ip:192.0.2.1');return {success:false};}}};
  const fetcher=(async()=>{calls++;throw Error('must not fetch');}) as typeof fetch;
  const r=await handle(req(path),env,neverProvider,fetcher);
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(calls,0);
 }
});
test('all tokens/devices of an account share warm/check limit before reservations or gate calls',async()=>{
 const keys:string[]=[], paths:string[]=[];
 const env={...base,LIMITER:{async limit({key}:{key:string}){keys.push(key);return {success:false};}}};
 const fetcher=(async(url:any)=>{
  paths.push(new URL(String(url)).pathname);
  assert.ok(String(url).endsWith('/validate'));
  return Response.json({userId:'account-12345678901234567890'});
 }) as typeof fetch;
 for(const [path,token,ip] of [['/warm','lap_one','192.0.2.1'],['/check','lap_two','192.0.2.2']]){
  assert.equal((await handle(req(path!,token!,ip!),env,neverProvider,fetcher)).status,429);
 }
 assert.deepEqual(keys,['account:account-12345678901234567890','account:account-12345678901234567890']);
 assert.deepEqual(paths,['/api/partner/lap/validate','/api/partner/lap/validate']);
});
test('accepted check limits exactly once and before begin, then settles',async()=>{
 const order:string[]=[];
 const env={...base,EDGE_LIMITER:{async limit(){order.push('edge');return {success:true};}},
  LIMITER:{async limit(){order.push('account-limit');return {success:true};}},
  LHG_GATE_ORACLE_URL:'https://gate.test',LHG_GATE_ORACLE_KEY:'unused'};
 const fetcher=(async(url:any)=>{
  if(String(url)==='https://gate.test'){order.push('gate');return Response.json({p:0});}
  const mode=String(url).split('/').pop()!;order.push(mode);
  return Response.json({userId:'account'});
 }) as typeof fetch;
 const provider=()=>({id:'fixture',modelVersion:'fixture',async extract(){throw Error('gate should skip');}});
 assert.equal((await handle(req('/check'),env,provider,fetcher)).status,200);
 assert.deepEqual(order,['edge','validate','account-limit','begin','gate','finish']);
});
test('legacy warm is throttled too and limiter outages fail closed',async()=>{
 for(const path of ['/warm','/check']){
  const r=await handle(req(path,'legacy'),{...base,LIMITER:{async limit(){return {success:false};}}},neverProvider);
  assert.equal(r.status,429);
 }
 const r=await handle(req('/warm'),{...base,EDGE_LIMITER:{async limit(){throw Error('down');}}},neverProvider);
 assert.equal(r.status,503);
});
test('preflight and health do not consume limits',async()=>{
 const env={...base,EDGE_LIMITER:{async limit(){throw Error('must not run');}},LIMITER:{async limit(){throw Error('must not run');}}};
 assert.equal((await handle(new Request('https://proxy.test/check',{method:'OPTIONS'}),env)).status,204);
 assert.equal((await handle(new Request('https://proxy.test/health'),env)).status,200);
});
