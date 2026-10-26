import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handle, type Env } from '../src/handler.js';
import { buildUserContent, type ExtractorRequest } from '../../engine/src/index.js';

const env: Env = { LHG_BRAIN_BASE_URL: '', LHG_BRAIN_TOKEN: '', LHG_ACCESS_KEY: 'synthetic-key' };

function browser() {
  let receiver: Function;
  const requests: ExtractorRequest[] = [];
  const wire: any[] = [];
  const root = {};
  let title = 'Synthetic Room A';
  const sb: any = {
    console, setTimeout, clearTimeout, AbortController,
    document: {},
    chrome: {
      storage: { local: { get: async () => ({ accessKey: env.LHG_ACCESS_KEY }) } },
      runtime: {
        onMessage: { addListener: (fn: Function) => { receiver = fn; } },
        sendMessage: (msg: unknown, cb: Function) => receiver(msg, {}, cb),
      },
    },
    fetch: async (url: string, init: RequestInit) => {
      wire.push(JSON.parse(String(init.body)));
      return handle(new Request(url, init), env, () => ({
        id: 'test', modelVersion: 'test',
        extract: async req => { requests.push(req); return { proposedFacts: [], directAssessment: 'unsure' }; },
      }));
    },
  };
  vm.createContext(sb);
  for (const file of ['context-dom.js', 'context-store.js', 'context-builder.js', 'context-runtime.js', 'background.js']) {
    vm.runInContext(readFileSync(new URL('../../extension/' + file, import.meta.url), 'utf8'), sb, { filename: file });
  }
  sb.LHG_SELECTORS = {
    whatsapp: { chatRoot: ['root'], conversationTitle: ['title'] },
    first: (_doc: unknown, selectors: string[]) => selectors[0] === 'root' ? root : { textContent: title },
  };
  const bubble = (name = 'Synthetic Person') => ({
    getAttribute: (key: string) => key === 'data-pre-plain-text' ? '[10:00, 01/01/2026] ' + name + ':' : null,
    querySelector: () => null, querySelectorAll: () => [],
  });
  const payload = (text: string, direction = 'incoming') => ({ type: 'lhg-check', text, platform: 'whatsapp-web', direction });
  const prepare = (text: string, name = 'Synthetic Person') => sb.LHG_CONTEXT_RUNTIME.prepare(payload(text), bubble(name), true);
  const send = (msg: unknown) => new Promise<any>(resolve => sb.chrome.runtime.sendMessage(msg, resolve));
  return { sb, requests, wire, bubble, payload, prepare, send, setTitle: (v: string) => { title = v; } };
}

test('real builder -> background -> proxy -> extractor preserves redacted bounded context', async () => {
  const b = browser();
  for (let i = 0; i < 7; i++) await b.prepare('history ' + i + ' Synthetic Person synthetic@example.test 050-2222222');
  const current = await b.prepare('current message');
  const response = await b.send(current);
  assert.equal(response.alert, 'unsure');
  const ctx = b.requests[0]!.context!;
  assert.equal(ctx.recentMessages!.length, 5);
  assert.equal(ctx.currentAuthorRef, 'p1');
  assert.equal(ctx.forwarded, undefined);
  assert.equal(ctx.participantCount, undefined);
  assert.equal(ctx.recentMessages![0]!.text.startsWith('history 2'), true);
  const serialized = JSON.stringify(b.wire[0].context);
  for (const secret of ['Synthetic Person', 'Synthetic Room A', 'synthetic@example.test', '050-2222222', 'current message']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.match(buildUserContent(b.requests[0]!), /CONTEXT/);
  assert.equal(b.wire.length, 1, 'local observation never calls network');
});

test('queued snapshots stay in their original conversation; switching starts empty', async () => {
  const b = browser();
  await b.prepare('previous room history');
  const old = b.prepare('queued old room');
  b.setTitle('Synthetic Room B');
  const next = b.prepare('new room message');
  const [a, c] = await Promise.all([old, next]);
  assert.notEqual(a.context.conversationRef, c.context.conversationRef);
  assert.equal(a.context.recentMessages.length, 1);
  assert.equal(c.context.recentMessages.length, 0);
  await b.send(a);
  assert.equal(b.requests[0]!.context!.conversationRef, a.context.conversationRef);
});

test('outgoing and missing-builder paths both reach background without leaking local metadata', async () => {
  const b = browser();
  await b.prepare('prior message');
  await new Promise(resolve => b.sb.LHG_CONTEXT_RUNTIME.send(b.payload('outgoing draft', 'outgoing'), resolve, b.bubble()));
  assert.equal(b.requests[0]!.context!.currentAuthorRef, 'self');
  assert.equal(b.requests[0]!.direction, 'outgoing');
  b.sb.LHG_CONTEXT_BUILDER = undefined;
  await new Promise(resolve => b.sb.LHG_CONTEXT_RUNTIME.send(b.payload('fallback message'), resolve, null));
  assert.equal(b.requests[1]!.context, undefined);
});

test('unknown Google thread identity falls back; explicit spaces stay separate from mail', async () => {
  const b = browser();
  const payload = { ...b.payload('synthetic message'), platform: 'gmail' };
  const noScope = await b.sb.LHG_CONTEXT_RUNTIME.prepare(payload, null, true);
  assert.equal(noScope.context, undefined);
  const space = { getAttribute: (key: string) => key === 'data-space-id' ? 'private-space-id' : null };
  const msg = await b.sb.LHG_CONTEXT_RUNTIME.prepare(payload, { closest: () => space }, true);
  assert.equal(msg.platform, 'google-chat');
  assert.equal(msg.context.currentAuthorRef, 'unknown');
  assert.equal(JSON.stringify(msg.context).includes('private-space-id'), false);
  await b.send(msg);
  assert.equal(b.requests[0]!.context!.currentAuthorRef, 'unknown');
});

test('proxy strips hostile fields and enforces confirmation on facts and relationships', async () => {
  const b = browser();
  const msg = await b.prepare('synthetic current');
  Object.assign(msg.context, {
    displayName: 'SECRET', facts: [
      { id: 'family_relation', value: 'parent', status: 'known', provenance: 'model_extraction' },
      { id: 'health', value: 'synthetic', status: 'known', provenance: 'user_confirmed' },
      { id: 'topic', value: 'candidate', status: 'candidate', provenance: 'content' },
    ],
    relationships: [{ subjectRef: 'p1', objectRef: 'self', relation: 'parent', status: 'known', provenance: 'site_metadata' }],
  });
  await b.send(msg);
  const ctx = b.requests[0]!.context!;
  assert.equal(JSON.stringify(ctx).includes('SECRET'), false);
  assert.deepEqual(ctx.facts!.map(f => f.status), ['unknown', 'known', 'candidate']);
  assert.equal(ctx.relationships![0]!.status, 'unknown');
});
