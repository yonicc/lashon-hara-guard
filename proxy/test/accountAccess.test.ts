import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalCheck, accountCall } from '../src/accountAccess.js';
import type { Env } from '../src/handler.js';
const env:Env={LHG_BRAIN_BASE_URL:'https://brain.test',LHG_BRAIN_TOKEN:'unused',LHG_ACCESS_KEY:'legacy',LHG_ACCOUNT_BASE:'https://center.test',LHG_ACCOUNT_KEY:'partner-secret'};
test('account calls use Worker-supported manual redirects and reject 3xx without forwarding credentials',async()=>{
 let calls=0;
 const fetcher=(async(_url:any,options:any)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://untrusted.test'}});}) as typeof fetch;
 const result=await accountCall(env,'validate',{token:'lap_test'},fetcher);
 assert.equal(result.status,503);assert.equal(calls,1);
});
const request=(path='/check',body:unknown={text:'synthetic'})=>new Request('https://proxy.test'+path,{method:'POST',headers:{'x-lhg-key':'lap_test'},body:JSON.stringify(body)});
function mock(denied=false){const calls:Array<{path:string,body:any}>=[];return {calls,fetch:(async(url:any,opts:any)=>{const path=new URL(String(url)).pathname;calls.push({path,body:JSON.parse(opts.body)});return new Response(JSON.stringify(denied?{error:'no_access'}:{ok:true,userId:'same-account'}),{status:denied?403:200});}) as typeof fetch};}
test('personal token authorizes before provider and captures only completed work',async()=>{
 const m=mock();const r=await personalCheck(request(),env,async(req,settings)=>{assert.equal(req.headers.get('x-lhg-key'),'same-account');assert.equal(settings.LHG_ACCESS_KEY,'same-account');return new Response('{"status":"extracted"}');},m.fetch);
 assert.equal(r.status,200);assert.equal(m.calls.length,2);assert.equal(m.calls[1]!.body.success,true);
 assert.ok(!JSON.stringify(m.calls).includes('synthetic'),'account center never sees text');
});
test('provider failure releases; central refusal never invokes provider',async()=>{
 const m=mock();await personalCheck(request(),env,async()=>{throw Error('provider unavailable');},m.fetch);assert.equal(m.calls[1]!.body.success,false);
 const no=mock(true);let invoked=false;const r=await personalCheck(request(),env,async()=>{invoked=true;return new Response();},no.fetch);
 assert.equal(r.status,403);assert.equal(invoked,false);
});
test('malformed messages reserve nothing and warm validates without charging',async()=>{
 const m=mock();assert.equal((await personalCheck(request('/check',{text:''}),env,async()=>new Response(),m.fetch)).status,400);assert.equal(m.calls.length,0);
 await personalCheck(request('/warm'),env,async()=>new Response('{}'),m.fetch);assert.equal(m.calls.length,1);assert.match(m.calls[0]!.path,/validate$/);
});
test('unsettled work reports unavailable and retries only idempotent settlement',async()=>{
 const m=mock(),fetcher=(async(u:any,o:any)=>String(u).endsWith('/finish')?new Response('{}',{status:503}):m.fetch(u,o)) as typeof fetch;
 const r=await personalCheck(request(),env,async()=>new Response('{"status":"extracted"}'),fetcher);assert.equal(r.status,503);
});
