import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_PACKET_VERSION,
  computeContextVersion,
  sanitizeContextPacket,
} from '../src/contextPacket.js';

function basePacket(): Record<string, unknown> {
  return {
    version: 1,
    platform: 'whatsapp-web',
    direction: 'outgoing',
    conversationRef: 'c1',
    conversationKind: 'group',
    participants: [{ ref: 'self', isSelf: true }, { ref: 'p1' }, { ref: 'p2' }],
    currentAuthorRef: 'self',
    recentMessages: [{ authorRef: 'self', direction: 'outgoing', text: 'hello' }],
    facts: [],
    relationships: [],
  };
}

test('version constant is 1', () => {
  assert.equal(CONTEXT_PACKET_VERSION, 1);
});

test('PII in participant input is dropped: name/phone/email never appear in output', () => {
  const input = basePacket();
  input['participants'] = [
    { ref: 'p1', name: 'אדם לדוגמה', displayName: 'Some Name', phone: '+972501234567', email: 'a@example.com', realId: '123' },
    { ref: 'self', isSelf: true },
  ];
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  assert.equal(out!.participants.length, 2);
  const raw = JSON.stringify(out);
  assert.ok(!raw.includes('אדם לדוגמה'));
  assert.ok(!raw.includes('0501234567') && !raw.includes('972501234567'));
  assert.ok(!raw.includes('a@example.com'));
  assert.ok(!raw.includes('realId'));
  for (const p of out!.participants) {
    assert.ok(!('name' in p) && !('phone' in p) && !('email' in p));
  }
});

test('participants with non-pseudonymous refs are skipped', () => {
  const input = basePacket();
  input['participants'] = [{ ref: '+972501234567' }, { ref: 'John Doe' }, { ref: 'p1' }];
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  assert.deepEqual(out!.participants.map((p) => p.ref), ['p1']);
});

test('recentMessages truncated to exactly 5, each text capped at 300 chars', () => {
  const input = basePacket();
  input['recentMessages'] = Array.from({ length: 8 }, (_, i) => ({
    authorRef: i % 2 === 0 ? 'self' : 'p1',
    direction: 'outgoing',
    text: i === 0 ? 'x'.repeat(500) : `msg ${i}`,
  }));
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  assert.equal(out!.recentMessages.length, 5);
  for (const m of out!.recentMessages) {
    assert.ok(m.text.length <= 300);
  }
  assert.equal(out!.recentMessages[0]!.text.length, 300);
});

test('unknown forwarded stays unknown (undefined), never false', () => {
  const a = sanitizeContextPacket(basePacket());
  assert.ok(a);
  assert.equal(a!.forwarded, undefined);

  const b = basePacket();
  b['forwarded'] = 'maybe';
  assert.equal(sanitizeContextPacket(b)!.forwarded, undefined);

  const c = basePacket();
  c['forwarded'] = true;
  assert.equal(sanitizeContextPacket(c)!.forwarded, true);

  const d = basePacket();
  d['forwarded'] = false;
  assert.equal(sanitizeContextPacket(d)!.forwarded, false);
});

test('sensitive known fact without user provenance + explicit confirmation downgrades to unknown', () => {
  const mk = (fact: Record<string, unknown>) => {
    const input = basePacket();
    input['facts'] = [fact];
    return sanitizeContextPacket(input)!.facts[0]!;
  };
  assert.equal(
    mk({ id: 'family_relation', value: 'x', status: 'known', provenance: 'model_extraction' }).status,
    'unknown',
  );
  assert.equal(
    mk({ id: 'family_relation', value: 'x', status: 'known', provenance: 'user' }).status,
    'unknown',
  );
  assert.equal(
    mk({ id: 'family_relation', value: 'x', status: 'known', provenance: 'user', userConfirmed: true }).status,
    'known',
  );
  assert.equal(
    mk({ id: 'topic', value: 'x', status: 'known', provenance: 'model_extraction' }).status,
    'known',
  );
});

test('non-allowlist keys are dropped at every depth', () => {
  const input = basePacket();
  (input as Record<string, unknown>)['realId'] = 'zzz';
  (input as Record<string, unknown>)['phone'] = '+972501234567';
  input['participants'] = [{ ref: 'p1', nickname: 'x', phone: 'y' }];
  input['facts'] = [{ id: 'topic', value: 'v', status: 'known', provenance: 'user', phone: 'y' }];
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  const o = out as unknown as Record<string, unknown>;
  assert.ok(!('realId' in o) && !('phone' in o) && !('nickname' in o));
  assert.ok(!JSON.stringify(out).includes('972501234567'));
});

test('malformed input never throws: returns null', () => {
  for (const bad of [null, undefined, 'x', 42, true, [], [1, 2], {}]) {
    assert.equal(sanitizeContextPacket(bad), null);
  }
  const wrongVersion = { ...basePacket(), version: 2 };
  assert.equal(sanitizeContextPacket(wrongVersion), null);
  const badDir = { ...basePacket(), direction: 'sideways' };
  assert.equal(sanitizeContextPacket(badDir), null);
  const badAuthor = { ...basePacket(), currentAuthorRef: 'John' };
  assert.equal(sanitizeContextPacket(badAuthor), null);
});

test('packet without context (empty arrays, no event) is still valid', () => {
  const input = basePacket();
  input['recentMessages'] = [];
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  assert.equal(out!.version, 1);
  assert.ok(out!.contextVersion.startsWith('cv1:'));
  assert.equal(out!.event, undefined);
});

test('invalid message direction and conversation kind default to unknown', () => {
  const input = basePacket();
  input['conversationKind'] = 'broadcast';
  input['recentMessages'] = [{ authorRef: 'p1', direction: 'sideways', text: 'hi' }];
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  assert.equal(out!.conversationKind, 'unknown');
  assert.equal(out!.recentMessages[0]!.direction, 'unknown');
});

test('model_extraction never confirms a family relation', () => {
  const input = basePacket();
  input['relationships'] = [
    { subjectRef: 'p1', relation: 'brother', objectRef: 'p2', status: 'known', provenance: 'model_extraction' },
  ];
  const out = sanitizeContextPacket(input);
  assert.ok(out);
  assert.equal(out!.relationships[0]!.status, 'unknown');
});

test('computeContextVersion is deterministic, content-sensitive, text-insensitive', () => {
  const args = {
    platform: 'whatsapp-web',
    conversationKind: 'group' as const,
    participants: [{ ref: 'self', isSelf: true }, { ref: 'p1' }],
    facts: [{ id: 'topic', value: 'v', status: 'known' as const, provenance: 'user' }],
    relationships: [],
  };
  const v1 = computeContextVersion(args);
  const v2 = computeContextVersion(JSON.parse(JSON.stringify(args)));
  assert.equal(v1, v2);

  const changed = computeContextVersion({
    ...args,
    facts: [{ id: 'topic', value: 'other', status: 'known' as const, provenance: 'user' }],
  });
  assert.notEqual(v1, changed);

  const pktA = sanitizeContextPacket({
    ...basePacket(),
    recentMessages: [{ authorRef: 'self', direction: 'outgoing', text: 'text one' }],
  });
  const pktB = sanitizeContextPacket({
    ...basePacket(),
    recentMessages: [{ authorRef: 'self', direction: 'outgoing', text: 'completely different text' }],
  });
  assert.ok(pktA && pktB);
  assert.equal(pktA!.contextVersion, pktB!.contextVersion);
});
