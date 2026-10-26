'use strict';
// context-store.js tests — plain node:test, no build step, memory fallback.
// Synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const DAY_MS = 24 * 60 * 60 * 1000;

function loadStore() {
  const sandbox = { console: console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'context-store.js'), 'utf8'),
    sandbox
  );
  assert.ok(sandbox.LHG_CONTEXT_STORE, 'LHG_CONTEXT_STORE must be exposed');
  return sandbox.LHG_CONTEXT_STORE;
}

test('store meta: lhg-context v1 with five stores and documented limits', () => {
  const S = loadStore();
  assert.equal(S.DB_NAME, 'lhg-context');
  assert.equal(S.DB_VERSION, 1);
  assert.deepEqual(
    Object.keys(S.STORES).sort(),
    ['conversations', 'facts', 'messages', 'participants', 'relationships']
  );
  assert.equal(S.MAX_MESSAGES_PER_CONVERSATION, 30);
  assert.equal(S.MAX_TEXT_LOCAL, 1000);
  assert.equal(S.RETENTION_DAYS, 14);
  assert.equal(S.backend(), 'memory');
});

test('conversations round-trip', async () => {
  const S = loadStore();
  await S.putConversation({ id: 'c1', platform: 'gmail', kind: 'direct' });
  const got = await S.getConversation('c1');
  assert.equal(got.id, 'c1');
  assert.equal(got.platform, 'gmail');
  const list = await S.listConversations();
  assert.ok(list.some((c) => c.id === 'c1'));
});

test('message text truncated locally with hash of full text', async () => {
  const S = loadStore();
  await S.putConversation({ id: 'c1', platform: 'test', kind: 'direct' });
  const full = 'x'.repeat(1500);
  const saved = await S.putMessage({
    conversationId: 'c1',
    authorRef: 'p1',
    direction: 'incoming',
    text: full,
    createdAt: 1000,
  });
  assert.equal(saved.text.length, 1000);
  assert.equal(saved.textHash, S.hashText(full));
  assert.equal(saved.textHash, S.hashText(full), 'hash is deterministic');
});

test('per-conversation cap keeps the last 30 messages', async () => {
  const S = loadStore();
  await S.putConversation({ id: 'c2', platform: 'test', kind: 'group' });
  for (let i = 1; i <= 33; i++) {
    await S.putMessage({
      conversationId: 'c2',
      authorRef: i % 2 ? 'p1' : 'self',
      direction: i % 2 ? 'incoming' : 'outgoing',
      text: 'synthetic message ' + i,
      createdAt: i,
    });
  }
  const rows = await S.getMessages('c2');
  assert.equal(rows.length, 30);
  assert.equal(rows[0].createdAt, 4);
  assert.equal(rows[29].createdAt, 33);
});

test('pruneMessages removes messages older than 14 days', async () => {
  const S = loadStore();
  const now = 1700000000000;
  await S.putConversation({ id: 'c3', platform: 'test', kind: 'direct' });
  await S.putMessage({
    conversationId: 'c3', authorRef: 'p1', direction: 'incoming',
    text: 'old synthetic', createdAt: now - 15 * DAY_MS,
  });
  await S.putMessage({
    conversationId: 'c3', authorRef: 'p1', direction: 'incoming',
    text: 'fresh synthetic', createdAt: now - 1 * DAY_MS,
  });
  const removed = await S.pruneMessages('c3', 14, now);
  assert.equal(removed, 1);
  const rows = await S.getMessages('c3');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'fresh synthetic');
});

test('deleteConversation removes the conversation and all derivatives', async () => {
  const S = loadStore();
  for (const cid of ['cA', 'cB']) {
    await S.putConversation({ id: cid, platform: 'test', kind: 'direct' });
    await S.putParticipant({ conversationId: cid, ref: 'p1', displayName: 'Synthetic Friend' });
    await S.putMessage({ conversationId: cid, authorRef: 'p1', direction: 'incoming', text: 'hi', createdAt: 5 });
    await S.putFact({ conversationId: cid, id: cid + '|f1', value: 'v', status: 'candidate', provenance: 'content' });
    await S.putRelationship({
      conversationId: cid, id: cid + '|r1',
      subjectRef: 'p1', relation: 'friend', objectRef: 'self',
      status: 'candidate', provenance: 'content',
    });
  }
  await S.deleteConversation('cA');
  assert.ok(!(await S.getConversation('cA')), 'deleted conversation is gone');
  assert.equal((await S.getMessages('cA')).length, 0);
  assert.equal((await S.getParticipants('cA')).length, 0);
  assert.equal((await S.getFacts('cA')).length, 0);
  assert.equal((await S.getRelationships('cA')).length, 0);
  // The other conversation is untouched.
  assert.ok(await S.getConversation('cB'));
  assert.equal((await S.getMessages('cB')).length, 1);
  assert.equal((await S.getParticipants('cB')).length, 1);
  assert.equal((await S.getFacts('cB')).length, 1);
  assert.equal((await S.getRelationships('cB')).length, 1);
});

test('purgeExpired sweeps old messages across conversations', async () => {
  const S = loadStore();
  const now = 1700000000000;
  for (const cid of ['cX', 'cY']) {
    await S.putConversation({ id: cid, platform: 'test', kind: 'direct' });
    await S.putMessage({
      conversationId: cid, authorRef: 'p1', direction: 'incoming',
      text: 'stale', createdAt: now - 20 * DAY_MS,
    });
  }
  const removed = await S.purgeExpired(14, now);
  assert.equal(removed, 2);
  assert.equal((await S.getMessages('cX')).length, 0);
  assert.equal((await S.getMessages('cY')).length, 0);
});

test('display names are stored locally only (retrievable, never exported by store)', async () => {
  const S = loadStore();
  await S.putConversation({ id: 'cL', platform: 'test', kind: 'direct' });
  await S.putParticipant({
    conversationId: 'cL', ref: 'p1',
    displayName: 'Synthetic Name 050-1234567',
  });
  const parts = await S.getParticipants('cL');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].displayName, 'Synthetic Name 050-1234567');
});

test('putMessage rejects without conversation and author', async () => {
  const S = loadStore();
  await assert.rejects(S.putMessage({ text: 'no refs' }));
});
