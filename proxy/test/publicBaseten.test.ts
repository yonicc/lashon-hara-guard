import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, providerFromEnv, type Env } from '../src/handler.js';
import { BASETEN_URL, PUBLIC_MODEL } from '../src/baseten.js';

const env: Env = { LHG_ACCESS_KEY: 'private-owner', LHG_BRAIN_BASE_URL: 'https://brain.invalid', LHG_BRAIN_TOKEN: 'brain',
  LHG_ACCOUNT_BASE: 'https://accounts.invalid', LHG_ACCOUNT_KEY: 'partner', LHG_BASETEN_KEY: 'secret' };

test('public tokens cannot select another model, destination, account or bypass settlement', async () => {
  for (const model of [undefined, 'claude-sonnet-5.5', 'unknown', 'muse-spark-1.3']) {
    const calls: string[] = [];
    let charged = false;
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const dest = String(url); calls.push(dest);
      const body = JSON.parse(String(init?.body));
      if (dest.endsWith('/validate')) return Response.json({ userId: 'user-1' });
      if (dest.endsWith('/begin')) return Response.json({ ok: true });
      if (dest.endsWith('/finish')) { charged = body.success; return Response.json({ ok: true }); }
      assert.equal(dest, BASETEN_URL);
      assert.equal(body.model, PUBLIC_MODEL);
      assert.equal('account' in body, false);
      assert.equal(init?.redirect, 'manual');
      assert.equal((init?.headers as Record<string,string>).authorization, 'Bearer secret');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ proposedFacts: [], directAssessment: 'no_concern' }) } }] });
    }) as typeof fetch;
    const res = await handle(new Request('https://proxy.test/check', { method:'POST',
      headers: { 'content-type':'application/json', 'x-lhg-key':'lap_test' },
      body: JSON.stringify({text:'Synthetic sample',model,LHG_PUBLIC_CHECK:false,account:'owner',baseUrl:'https://evil.invalid'}) }),
      env, (e,c) => providerFromEnv(e,c,fake), fake);
    assert.equal(res.status,200);
    assert.ok(charged);
    assert.equal(calls.filter(u=>u===BASETEN_URL).length,1);
    assert.ok(!calls.some(u=>u.includes('brain.invalid')));
  }
});

test('public configuration fails closed without Baseten key even when Brain is configured', () => {
  assert.equal(providerFromEnv({...env,LHG_BASETEN_KEY:undefined,LHG_PUBLIC_CHECK:'1'}),null);
});

test('redirects, truncation and malformed JSON fail without following or approving', async () => {
  for (const response of [new Response(null,{status:302,headers:{location:'https://evil.invalid'}}),
    Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),
    Response.json({choices:[{finish_reason:'stop',message:{content:'bad json'}}]})]) {
    const p=providerFromEnv({...env,LHG_PUBLIC_CHECK:'1'},null,(async()=>response) as typeof fetch)!;
    await assert.rejects(p.extract({messageId:'test',platform:'gmail',direction:'outgoing',text:'Synthetic sample',normalizedText:'Synthetic sample',gateCues:[],catalogFactIds:[]}));
  }
});
