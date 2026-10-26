import test from 'node:test';
import assert from 'node:assert/strict';

// Live integration test — OFF by default. Requires:
//   LHG_BRAIN_LIVE=1 LHG_BRAIN_BASE_URL=... LHG_BRAIN_TOKEN=... [LHG_BRAIN_MODEL=...] [LHG_BRAIN_ACCOUNT=...]
// No network is touched unless the flag is set. Never commit secrets.
const LIVE = process.env['LHG_BRAIN_LIVE'] === '1';

test('brainSend live: single stateless turn against a real Brain', { skip: !LIVE }, async () => {
  const { BrainSendExtractorProvider, brainSendOptionsFromEnv } = await import('../src/index.js');
  const opts = brainSendOptionsFromEnv();
  assert.ok(opts, 'live test needs LHG_BRAIN_BASE_URL + LHG_BRAIN_TOKEN');
  const provider = new BrainSendExtractorProvider({ ...opts!, timeoutMs: 60000 });
  const raw = await provider.extract({
    messageId: 'live1', platform: 'whatsapp-web', direction: 'outgoing',
    text: 'השיעור הזה מבזבז לנו את הזמן',
    normalizedText: 'השיעור הזה מבזבז לנו את הזמן',
    gateCues: ['cue:third_person'],
    catalogFactIds: ['message.criticizes_lesson_content'],
  });
  assert.ok(raw && typeof raw === 'object', 'expected a JSON object from the model');
});
