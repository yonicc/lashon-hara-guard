import type { Env } from './handler.js';
import { MAX_TEXT_CHARS } from './limits.js';
import { throttle } from './throttle.js';
type AccessEnv = Env & { LHG_ACCOUNT_BASE?: string; LHG_ACCOUNT_KEY?: string };
export async function accountCall(env: AccessEnv, mode: string, body: unknown, fetchImpl: typeof fetch): Promise<Response> {
 if (!env.LHG_ACCOUNT_BASE || !env.LHG_ACCOUNT_KEY) return new Response('{"error":"accounts_unavailable"}', {status:503});
 try {
  const response = await fetchImpl(env.LHG_ACCOUNT_BASE + '/api/partner/lap/' + mode, {
   method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.LHG_ACCOUNT_KEY},
   body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'manual',
  });
  if(response.status>=300&&response.status<400)return new Response('{"error":"accounts_unavailable"}',{status:503});
  return response;
 } catch { return new Response('{"error":"accounts_unavailable"}',{status:503}); }
}
export async function personalCheck(
 request:Request,env:AccessEnv,
 next:(request:Request,env:Env)=>Promise<Response>,fetchImpl:typeof fetch,
):Promise<Response>{
 const url=new URL(request.url),token=request.headers.get('x-lhg-key')||'';
 if(request.method!=='POST'||!['/check','/warm'].includes(url.pathname)||!token.startsWith('lap_'))return next(request,env);
 const err=(code:string,status:number)=>new Response(JSON.stringify({error:code}),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}});
 // Reject malformed work before reserving funds.
 if(url.pathname==='/check'){
  let body:unknown;try{body=await request.clone().json();}catch{return err('bad_json',400);}
  if(!body||typeof body!=='object'||typeof (body as {text?:unknown}).text!=='string')return err('text_required',400);
  const text=(body as {text:string}).text.trim();
  if(!text)return err('text_required',400);
  if(text.length>MAX_TEXT_CHARS)return err('text_too_long',413);
 }
 const ref=crypto.randomUUID(),mode=url.pathname==='/warm'?'validate':'begin';
 // Resolve current account before charging, so rotating tokens cannot evade limits.
 const auth=await accountCall(env,'validate',{token},fetchImpl);
 if(!auth.ok){
  let code='access_denied';try{code=((await auth.json()) as {error:string}).error||code;}catch{}
  return err(code,auth.status);
 }
 const identity=await auth.json() as {userId:string};
 if(typeof identity.userId!=='string'||!identity.userId)return err('accounts_unavailable',503);
 const blocked=await throttle(env.LIMITER,'account:'+identity.userId);
 if(blocked)return blocked;
 if(mode==='begin'){
  const reservation=await accountCall(env,'begin',{token,ref},fetchImpl);
  if(!reservation.ok){
   let code='access_denied';try{code=((await reservation.json()) as {error:string}).error||code;}catch{}
   return err(code,reservation.status);
  }
 }
 // Stable account key makes all devices share the same rate limit.
 const headers=new Headers(request.headers);headers.set('x-lhg-key',identity.userId);
 const authorized=new Request(request,{headers});
 let response:Response;
 try { response=await next(authorized,{...env,LHG_ACCESS_KEY:identity.userId,LIMITER:undefined,LHG_PUBLIC_CHECK:'1'}); }
 catch { response=err('check_failed',503); }
 if(mode==='validate')return response;
 let success=false;
 if(response.ok){try{const body=await response.clone().json() as {status?:string};success=body.status==='extracted'||body.status==='skipped_local_gate';}catch{}}
 // Completion is idempotent. Preserve unresolved holds for audited admin recovery.
 let settled=await accountCall(env,'finish',{ref,success},fetchImpl);
 if(settled.status>=500)settled=await accountCall(env,'finish',{ref,success},fetchImpl);
 return settled.ok?response:err('settlement_unavailable',503);
}
