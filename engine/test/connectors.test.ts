import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_ADAPTERS,
  FIXTURES,
  createRegistry,
  type NormalizedMessage,
} from '../src/index.js';

const registry = createRegistry(ALL_ADAPTERS);

test('registry: all four platforms registered; adding a platform is one module', () => {
  assert.deepEqual(registry.list(), ['android', 'facebook-messenger', 'google', 'whatsapp-web']);
  assert.throws(() => registry.get('telegram'), /adapter_not_found/);
  assert.throws(() => registry.register(ALL_ADAPTERS[0]!), /adapter_already_registered/);
});

test('fixtures: every platform normalizes to the engine MessageEnvelope shape', () => {
  for (const [platformId, events] of Object.entries(FIXTURES)) {
    assert.ok(events.length >= 1, platformId);
    for (const raw of events) {
      const m: NormalizedMessage = registry.normalize(platformId, raw);
      assert.equal(m.platform, platformId);
      assert.ok(m.id && m.conversationId && typeof m.text === 'string');
      assert.ok(m.direction === 'outgoing' || m.direction === 'incoming');
      assert.ok(m.audienceSnapshot !== undefined);
      assert.ok(['dm', 'group', 'channel', 'thread', 'email', 'unknown'].includes(m.channelKind));
    }
  }
});

test('whatsapp-web: group participants and forwarded flag survive normalization', () => {
  const [group, dm] = FIXTURES['whatsapp-web']!.map((r) => registry.normalize('whatsapp-web', r));
  assert.equal(group!.channelKind, 'group');
  assert.equal(group!.audienceSnapshot.participantCount, 5);
  assert.equal(dm!.channelKind, 'dm');
  assert.equal(dm!.forwarded, true);
});

test('google: mail keeps To/CC/BCC + subject; chat keeps space participants', () => {
  const [chat, mail] = FIXTURES['google']!.map((r) => registry.normalize('google', r));
  assert.equal(chat!.channelKind, 'group');
  assert.equal(mail!.channelKind, 'email');
  assert.deepEqual(mail!.audienceSnapshot.to, ['p-a@example.invalid']);
  assert.deepEqual(mail!.audienceSnapshot.cc, ['p-b@example.invalid']);
  assert.equal(mail!.audienceSnapshot.bccCount, 1);
  assert.equal(mail!.subject, 'סיכום שיעור (סינתטי)');
});

test('facebook-messenger: unknown forwarded stays unknown (undefined), never false', () => {
  const m = registry.normalize('facebook-messenger', FIXTURES['facebook-messenger']![0]!);
  assert.equal(m.channelKind, 'group');
  assert.equal(m.forwarded, undefined);
});

test('android: capabilities honestly report no hold-send / partial participants', () => {
  const adapter = registry.get('android');
  assert.equal(adapter.capabilities.canHoldSend, false);
  assert.equal(adapter.capabilities.observeCompose, false);
  assert.equal(adapter.capabilities.participants, false);
  const noParts = registry.normalize('android', FIXTURES['android']![1]!);
  assert.equal(noParts.channelKind, 'unknown');
  assert.equal(noParts.forwarded, undefined);
});

test('capabilities: every adapter declares the uniform capability shape', () => {
  for (const a of ALL_ADAPTERS) {
    assert.equal(typeof a.capabilities.observeCompose, 'boolean', a.platformId);
    assert.equal(typeof a.capabilities.observeIncoming, 'boolean', a.platformId);
    assert.equal(typeof a.capabilities.canHoldSend, 'boolean', a.platformId);
    assert.ok(Array.isArray(a.capabilities.audienceKinds), a.platformId);
  }
});
