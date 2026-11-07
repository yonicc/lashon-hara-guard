import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Env } from '../src/handler.js';
import { BasetenExtractorProvider } from '../src/baseten.js';
const env:Env = {LHG_ACCESS_KEY:'synthetic',LHG_BRAIN_BASE_URL:'https://synthetic.test',LHG_BRAIN_TOKEN:'unused',LHG_ALWAYS_EXTRACT:'1'};
test('/check keeps 200/not_checked and rules contract, adds safe provider diagnostic', async () => {
  const response = await handle(new Request('https://synthetic.test/check', {
    method:'POST',headers:{'x-lhg-key':'synthetic'},body:JSON.stringify({text:'Synthetic sample', confirmedFacts:{}}),
  }), env, () => new BasetenExtractorProvider('secret-key', (async () => Response.json({
    error:{message:'Model version wpgy40e is deactivated secret-key https://credentials.test/private'},
  }, {status:400})) as typeof fetch));
  const body = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(body.alert, 'not_checked');
  assert.equal(body.status, 'not_checked');
  assert.equal(body.rules.notChecked, true);
  assert.deepEqual(body.rules.findings, []);
  assert.equal(body.checkError.provider, 'baseten');
  assert.equal(body.checkError.status, 400);
  assert.ok(body.checkError.message.length <= 200);
  assert.match(body.checkError.message, /Model version wpgy40e is deactivated/);
  assert.ok(!JSON.stringify(body).includes('secret-key'));
  assert.ok(!JSON.stringify(body).includes('credentials.test'));
});
