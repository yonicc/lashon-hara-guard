import test from 'node:test';
import assert from 'node:assert/strict';
import { providerHttpError, sanitizeProviderMessage, providerFailure } from '../src/extractor/providerError.js';
import { BrainSendExtractorProvider } from '../src/extractor/brainSend.js';

test('provider body logged redacted; compact message retains actual deactivation cause', async () => {
  const logs: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args) => { logs.push(args); };
  try {
    const error = await providerHttpError(Response.json({
      error:{message:'Model version wpgy40e is deactivated'},
      token:'synthetic-secret', url:'https://user:password@example.test/?key=hidden',
      authorization:'Bearer another-secret',
    }, {status:400}), 'baseten', ['synthetic-secret']);
    assert.equal(error.detail.message, 'Model version wpgy40e is deactivated');
    assert.equal(error.detail.status, 400);
    const logged = JSON.stringify(logs);
    for (const secret of ['synthetic-secret', 'another-secret', 'user:password', 'key=hidden']) assert.ok(!logged.includes(secret), secret);
    assert.match(logged, /deactivated/);
    assert.ok(sanitizeProviderMessage('x'.repeat(1000)).length <= 200);
    assert.ok(!sanitizeProviderMessage('api_key=secret123 password="private" Bearer abc https://host.test/secret').includes('secret123'));
  } finally { console.warn = original; }
});

test('Brain errors preserve HTTP detail and never retry a deterministic 400', async () => {
  let calls = 0;
  const provider = new BrainSendExtractorProvider({
    baseUrl:'https://synthetic.test', token:'secret', agentKind:'baseten',
    fetchImpl: (async () => { calls++; return Response.json({detail:'Model version wpgy40e is deactivated'}, {status:400}); }) as typeof fetch,
  });
  await assert.rejects(provider.extract({messageId:'s', platform:'gmail', direction:'outgoing',
    text:'Synthetic message', normalizedText:'Synthetic message', gateCues:[], catalogFactIds:[]}), error => {
    const detail = providerFailure(error, provider.id);
    assert.equal(detail.provider, 'baseten');
    assert.equal(detail.status, 400);
    assert.match(detail.message, /deactivated/);
    return true;
  });
  assert.equal(calls, 1);
});
