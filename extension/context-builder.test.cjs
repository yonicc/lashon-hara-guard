'use strict';
// PART1: helpers + leak test + recent-window test (ASCII only, synthetic data).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const NOW = 1700000000000;
const MIN = 60000;
const VALID = ['candidate', 'known', 'unknown'];

function loadSandbox() {
  const sandbox = { console: console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['context-store.js', 'context-builder.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox);
  }
  assert.ok(sandbox.LHG_CONTEXT_BUILDER);
  assert.equal(sandbox.LHG_CONTEXT_BUILDER.PACKET_VERSION, 1);
  assert.equal(sandbox.LHG_CONTEXT_BUILDER.MAX_RECENT, 5);
  return sandbox;
}

function freshBuilder(sandbox) {
  return sandbox.LHG_CONTEXT_BUILDER.createContextBuilder({ store: {}, now: () => NOW });
}

function noLeak(packet, secrets) {
  const json = JSON.stringify(packet);
  for (const s of secrets) {
    assert.ok(!json.includes(s), 'packet must not contain ' + s);
  }
}

function validStatuses(packet) {
  for (const f of packet.facts || []) {
    assert.ok(VALID.includes(f.status), 'fact status: ' + f.status);
  }
  for (const r of packet.relationships || []) {
    assert.ok(VALID.includes(r.status), 'rel status: ' + r.status);
  }
  assert.ok(!JSON.stringify(packet).includes('"status":false'), 'unknown never false');
}

test('v1 refs only: names phones emails never leave', async () => {
  const b = freshBuilder(loadSandbox());
  await b.ingestConversation({ id: 'c1', kind: 'direct', platform: 'gmail', direction: 'incoming' });
  assert.equal(await b.ingestParticipant('c1', { displayName: 'Synthetic Self', isSelf: true }), 'self');
  assert.equal(await b.ingestParticipant('c1', { displayName: 'Synthetic Friend', roles: ['friend'] }), 'p1');
  await b.ingestMessage('c1', { authorRef: 'self', direction: 'outgoing', text: 'hello Synthetic Friend', timestamp: NOW - 10 * MIN });
  await b.ingestMessage('c1', { authorRef: 'p1', direction: 'incoming', text: 'call 050-2222222 or me@example.com', timestamp: NOW - 5 * MIN });
  const p = await b.buildPacket('c1', { authorRef: 'p1', direction: 'incoming', text: 'new reply', timestamp: NOW, platform: 'gmail' });
  assert.equal(p.version, 1);
  assert.equal(p.conversationRef, 'c1');
  assert.equal(p.currentAuthorRef, 'p1');
  assert.equal(JSON.stringify(p.participants), JSON.stringify([{ ref: 'self', isSelf: true }, { ref: 'p1', roles: ['friend'] }]));
  assert.ok(!('participantCount' in p));
  assert.equal(p.recentMessages.length, 2);
  assert.ok(p.recentMessages[1].text.includes('[phone]'), p.recentMessages[1].text);
  assert.ok(p.recentMessages[1].text.includes('[email]'));
  assert.ok(p.recentMessages[0].text.includes('[name]'), p.recentMessages[0].text);
  noLeak(p, ['Synthetic Self', 'Synthetic Friend', '050-2222222', 'me@example.com', 'example.com']);
  validStatuses(p);
});

test('recent window: exactly 5 chronological, current excluded', async () => {
  const b = freshBuilder(loadSandbox());
  await b.ingestConversation({ id: 'c2', kind: 'group', platform: 'test', direction: 'incoming' });
  await b.ingestParticipant('c2', { displayName: 'Synthetic Self', isSelf: true });
  await b.ingestParticipant('c2', { displayName: 'Synthetic Other' });
  const ids = [];
  for (let i = 1; i <= 7; i++) {
    ids.push(await b.ingestMessage('c2', {
      authorRef: i % 2 ? 'p1' : 'self',
      direction: i % 2 ? 'incoming' : 'outgoing',
      text: 'synthetic message ' + i, timestamp: NOW - (8 - i) * MIN,
    }));
  }
  const p = await b.buildPacket('c2', { authorRef: 'self', direction: 'outgoing', text: 'synthetic current 8', timestamp: NOW });
  assert.equal(p.recentMessages.length, 5);
  assert.equal(JSON.stringify(p.recentMessages.map((m) => m.text)), JSON.stringify(['synthetic message 3', 'synthetic message 4', 'synthetic message 5', 'synthetic message 6', 'synthetic message 7']));
  assert.equal(p.recentMessages[4].ageMinutes, 1);
  assert.equal(p.participantCount, undefined, 'visible authors do not prove total audience size');
  const dup = await b.buildPacket('c2', { id: ids[6], authorRef: 'p1', direction: 'incoming', text: 'synthetic message 7', timestamp: NOW - 1 * MIN });
  assert.equal(dup.recentMessages.length, 5);
  assert.equal(JSON.stringify(dup.recentMessages.map((m) => m.text)), JSON.stringify(['synthetic message 2', 'synthetic message 3', 'synthetic message 4', 'synthetic message 5', 'synthetic message 6']));
});

test('classroom: teacher confirmed as father only after user confirm', async () => {
  const b = freshBuilder(loadSandbox());
  await b.ingestConversation({ id: 'class1', kind: 'group', platform: 'whatsapp', direction: 'incoming' });
  await b.ingestParticipant('class1', { displayName: 'Synthetic Self', isSelf: true });
  assert.equal(await b.ingestParticipant('class1', { displayName: 'Synthetic Teacher', roles: ['teacher'] }), 'p1');
  await b.ingestParticipant('class1', { displayName: 'Synthetic Student One' });
  await b.ingestParticipant('class1', { displayName: 'Synthetic Student Two' });
  await b.ingestParticipant('class1', { displayName: 'Synthetic Student Three' });
  await b.ingestMessage('class1', { authorRef: 'p1', direction: 'incoming', text: 'welcome to class', timestamp: NOW - 30 * MIN });
  const fid = await b.proposeFact('class1', { value: 'teacher is father of self', sensitive: true, provenance: 'content' });
  const rid = await b.proposeRelationship('class1', { subjectRef: 'p1', relation: 'parent_of', objectRef: 'self', provenance: 'content' });
  let p = await b.buildPacket('class1', { authorRef: 'self', direction: 'outgoing', text: 'thanks', timestamp: NOW });
  assert.equal(p.facts.length, 1);
  assert.equal(p.facts[0].status, 'candidate');
  assert.equal(p.facts[0].provenance, 'content');
  assert.equal(p.relationships[0].status, 'candidate');
  assert.equal(p.participants.length, 5);
  assert.equal(p.participantCount, undefined, 'observed authors are not the full audience');
  await b.confirmFact('class1', fid);
  await b.confirmRelationship('class1', rid);
  p = await b.buildPacket('class1', { authorRef: 'self', direction: 'outgoing', text: 'thanks', timestamp: NOW });
  assert.equal(p.facts[0].status, 'known');
  assert.equal(p.facts[0].provenance, 'user_confirmed');
  assert.equal(p.relationships[0].status, 'known');
  assert.equal(p.relationships[0].subjectRef, 'p1');
  assert.equal(p.relationships[0].objectRef, 'self');
  noLeak(p, ['Synthetic Teacher', 'Synthetic Student']);
  validStatuses(p);
});

test('markUnknown never becomes false; bumps contextVersion', async () => {
  const b = freshBuilder(loadSandbox());
  await b.ingestConversation({ id: 'c3', kind: 'direct', platform: 'test', direction: 'incoming' });
  const v0 = b.getContextVersion('c3');
  const fid = await b.proposeFact('c3', { value: 'v', sensitive: true, provenance: 'content' });
  const v1 = b.getContextVersion('c3');
  assert.ok(v1 > v0, 'propose bumps version');
  await b.markUnknown('c3', 'fact', fid);
  const p = await b.buildPacket('c3', { authorRef: 'self', direction: 'outgoing', text: 'hi', timestamp: NOW });
  assert.equal(p.facts[0].status, 'unknown');
  assert.notEqual(p.facts[0].status, false);
  assert.ok(b.getContextVersion('c3') > v1);
  validStatuses(p);
});

test('non-sensitive candidate fact stays candidate without confirm', async () => {
  const b = freshBuilder(loadSandbox());
  await b.ingestConversation({ id: 'c4', kind: 'direct', platform: 'test', direction: 'incoming' });
  await b.proposeFact('c4', { value: 'met at synthetic place', provenance: 'content' });
  const p = await b.buildPacket('c4', { authorRef: 'self', direction: 'outgoing', text: 'hi', timestamp: NOW });
  assert.equal(p.facts[0].status, 'candidate');
  validStatuses(p);
});

test('deleteConversation clears builder state', async () => {
  const b = freshBuilder(loadSandbox());
  await b.ingestConversation({ id: 'c5', kind: 'direct', platform: 'test', direction: 'incoming' });
  const v0 = b.getContextVersion('c5');
  await b.ingestParticipant('c5', { displayName: 'Synthetic Self', isSelf: true });
  await b.ingestMessage('c5', { authorRef: 'self', direction: 'outgoing', text: 'hi', timestamp: NOW });
  assert.ok(b.getContextVersion('c5') > v0);
  await b.deleteConversation('c5');
  assert.equal(b.getContextVersion('c5'), 0);
  const p = await b.buildPacket('c5', { authorRef: 'self', direction: 'outgoing', text: 'hi again', timestamp: NOW });
  assert.equal(p.recentMessages.length, 0);
  assert.equal(p.facts.length, 0);
});

test('packet without context is still valid; DOM helpers optional', async () => {
  const sb = loadSandbox();
  const b = freshBuilder(sb);
  await b.ingestConversation({ id: 'c6', kind: 'direct', platform: 'gmail', direction: 'incoming' });
  const p = await b.buildPacket('c6', { authorDisplayName: 'Synthetic New Person', direction: 'incoming', text: 'hello there', timestamp: NOW, platform: 'gmail' });
  assert.equal(p.version, 1);
  assert.equal(p.conversationRef, 'c6');
  assert.equal(p.conversationKind, 'direct');
  assert.equal(p.currentAuthorRef, 'p1');
  assert.equal(p.recentMessages.length, 0);
  validStatuses(p);
  noLeak(p, ['Synthetic New Person']);
  assert.equal(JSON.stringify(b.readDomHints(null)), '{}');
});
