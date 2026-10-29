// Shared local context bridge. Capture context before queueing/network waits.
// DOM identity and display names stay local; only builder packets cross runtime.
(() => {
  const scopes = new WeakMap();
  let serial = 0;
  const session = globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  let builder;
  const packetBuilders = new WeakMap();
  let pending = Promise.resolve();
  const loopStates = new Map(), elementTokens = new WeakMap();
  chrome.runtime?.onMessage?.addListener((msg, sender, reply) => {
    if (msg?.type !== 'lhg-context-loop') return;
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const state = loopStates.get(msg.token);
    const current = !!state && state.current();
    if (!current) { reply({ current: false }); return; }
    if (msg.op === 'current') {
      state.progress?.(msg.round);
      if (!state.progress) {
        const label = state.el?.querySelector?.(':scope > .lhg-hold > span, :scope > .lhg-tag');
        if (label) label.textContent = globalThis.LHG_I18N?.t('checkingRound', { n: msg.round }) || '';
      }
      reply({ current: true }); return;
    }
    if (msg.op === 'merge' && state.builder && state.context) {
      state.context = state.builder.mergeMemory(state.context, msg.candidates);
      reply({ current: true, context: state.context }); return;
    }
    reply({ current: false });
  });
  // Bound persisted message retention as well as the builder's memory window.
  try { Promise.resolve(globalThis.LHG_CONTEXT_STORE?.purgeExpired?.()).catch(() => {}); } catch (_) {}

  function scopeFor(platform, el) {
    const S = globalThis.LHG_SELECTORS;
    let root = null;
    let key = '';
    let kind = 'unknown';
    if (platform === 'whatsapp-web') {
      root = S?.first(document, S.whatsapp.chatRoot);
      const title = S?.first(document, S.whatsapp.conversationTitle);
      if (!root || !title) return null;
      key = title.getAttribute?.('title') || title.textContent || '';
    } else {
      // Require an explicit thread/space ID; a URL or page-wide root alone can
      // mix Gmail mail with embedded Chat. Missing identity => single-message.
      // Google Chat (incl. the Gmail chat iframe) marks the conversation with
      // data-group-id ("dm/…" / "space/…"); data-space-id is the older name.
      root = el?.closest?.('[data-thread-id], [data-space-id], [data-group-id]');
      // Outgoing checks pass the compose box, which may sit outside the
      // message list: fall back to the single conversation in this frame.
      if (!root && platform === 'google-chat' && globalThis.top !== globalThis) {
        const all = document.querySelectorAll('[data-group-id]');
        const ids = new Set(Array.from(all, (n) => n.getAttribute('data-group-id')));
        if (ids.size === 1) root = all[0];
      }
      if (!root && platform === 'gmail') {
        // Gmail's thread view has no data-thread-id on the message nodes.
        // The thread root ([role="main"] div[role="list"] or [role="main"])
        // is the conversation identity; location.href pins it to one thread
        // (folder-list rows are excluded by gmailIsMessageBody downstream).
        try {
          root = S?.first(document, S.gmail.threadRoot) || null;
        } catch (_) { root = null; }
      }
      if (!root) return null;
      key = root.getAttribute('data-thread-id') || root.getAttribute('data-space-id') || root.getAttribute('data-group-id');
      if (!key && platform === 'gmail' && root && typeof location !== 'undefined' && location.href) {
        key = 'gmail:' + String(location.href).split('?')[0];
      }
      if (!key) return null;
      kind = root.getAttribute && root.getAttribute('data-thread-id') ? 'email_thread' : kind;
      if ((!kind || kind === 'unknown') && platform === 'gmail') kind = 'email_thread';
      if (root.getAttribute && (root.getAttribute('data-space-id') || root.getAttribute('data-group-id'))) platform = 'google-chat';
    }
    if (!key) return null;
    let scope = scopes.get(root);
    if (!scope || scope.key !== key || scope.platform !== platform) {
      if (scope && builder) {
        const oldId = scope.id;
        pending = pending.then(() => builder.deleteConversation(oldId)).catch(() => {});
      }
      scope = { key, id: 'c-' + session + '-' + (++serial), platform, kind };
      scopes.set(root, scope);
    }
    return scope;
  }

  // Snapshot loaded prior bodies synchronously, in DOM chronology. Rebuild
  // for each check so late expansion and edits cannot freeze out history.
  // The existing packet budget remains five scrubbed 300-character excerpts.
  // If no older bodies are mounted, use the current mail/reply's quote.
  function gmailHistory(currentEl, currentText) {
    const history = [];
    try {
      const S = globalThis.LHG_SELECTORS;
      if (!S || !S.gmail || typeof S.all !== 'function') return history;
      const root = S.first(document, S.gmail.threadRoot) || document;
      const bodies = S.all(root, S.gmail.messageBody)
        .filter((el) => S.gmailIsMessageBody(el));
      const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
      const curNorm = norm(currentText);
      let n = 0;
      for (const body of bodies) {
        // Never use later messages to judge an earlier incoming message.
        if (body === currentEl || body.contains?.(currentEl)) break;
        let text = '';
        try { text = norm(S.textWithout(body, S.gmail.quotedPart)); } catch (_) { continue; }
        if (!text || text.length < 6) continue;
        if (curNorm && (text === curNorm || curNorm.includes(text))) continue;
        let author = '';
        try {
          const container = S.closestMatch(body, S.gmail.messageContainer);
          const sender = container && S.first(container, S.gmail.messageSender);
          author = (sender && (sender.getAttribute('name') || sender.getAttribute('email') || sender.getAttribute('data-hovercard-id') || sender.textContent)) || '';
          author = norm(author).slice(0, 80);
        } catch (_) { author = ''; }
        history.push({ text, direction: 'incoming', authorDisplayName: author });
        n++;
      }
      // Quote fallback is available even when Gmail did not mount older bodies.
      // Preserve it as quoted history; do not invent sender attribution.
      for (const quote of history.length ? [] : S.all(currentEl, ['.gmail_quote'])) {
        const text = norm(quote.textContent);
        if (text.length >= 6 && !history.some(m => norm(m.text).includes(text) || text.includes(norm(m.text)))) {
          history.push({ text, direction: 'incoming', authorDisplayName: '' });
        }
      }
    } catch (_) { /* only DOM that is loaded can be captured */ }
    return history;
  }
  async function seedGmailThreadHistory(scope, target, history) {
    for (let i = 0; i < history.length; i++) {
      await target.ingestMessage(scope.id, { ...history[i], id: 'gmail-' + i,
        timestamp: Date.now() - (history.length - i) * 60000 });
    }
  }

  function prepare(payload, el, remember = false) {
    if (el && typeof el === 'object') {
      const token = session + '-loop-' + (++serial);
      elementTokens.set(el, token);
      const textNow = () => globalThis.LHG_SELECTORS?.textWithout?.(el) ?? el.textContent;
      const raw = textNow(), captured = contentKey(payload.platform, el, payload.text);
      loopStates.set(token, { el, current: () => elementTokens.get(el) === token &&
        el.isConnected !== false && textNow() === raw &&
        contentKey(payload.platform, el, payload.text) === captured });
      // Bound registrations; old queued checks safely stop when evicted.
      if (loopStates.size > 200) loopStates.delete(loopStates.keys().next().value);
      payload = { ...payload, loopToken: token };
    }
    const identity = globalThis.LHG_MEMORY?.scopeFor?.(payload.platform, el);
    const source = el?.closest?.('[data-message-id], [data-legacy-message-id], [data-id]');
    const messageId = source?.getAttribute('data-message-id') || source?.getAttribute('data-legacy-message-id') || source?.getAttribute('data-id');
    payload = { ...payload, ...(identity ? { cacheIdentity: { ...identity, ...(messageId ? { messageId } : {}) } } : {}) };
    globalThis.LHG_MEMORY?.context(payload.platform, el, payload.text, payload.direction);
    // Resolve DOM identity synchronously, before another conversation can open.
    let scope, hints;
    try {
      scope = scopeFor(payload.platform, el);
      hints = globalThis.LHG_LOCAL_CONTEXT?.attach?.(el) || {};
    } catch (_) { return Promise.resolve(payload); }
    if (!scope || !globalThis.LHG_CONTEXT_BUILDER) return Promise.resolve(payload);
    const current = {
      text: payload.text, direction: payload.direction, timestamp: Date.now(),
      isSelf: payload.direction === 'outgoing',
      ...(payload.direction === 'outgoing' ? { authorRef: 'self' } : {}),
      authorDisplayName: hints.authorDisplayName || '',
      replyToAuthorDisplayName: hints.quoted?.authorDisplayName || '',
      ...(typeof hints.forwarded === 'boolean' ? { forwarded: hints.forwarded } : {}),
    };
    const history = scope.kind === 'email_thread' ? gmailHistory(el, current.text) : null;
    const work = pending.then(async () => {
      // Gmail is rebuilt from a synchronous DOM snapshot on every check:
      // newly expanded messages must not be frozen out by a one-time seed.
      if (history) builder = globalThis.LHG_CONTEXT_BUILDER.createContextBuilder();
      else builder ||= globalThis.LHG_CONTEXT_BUILDER.createContextBuilder();
      await builder.ingestConversation({ id: scope.id, platform: scope.platform, kind: scope.kind });
      if (scope.kind === 'email_thread') {
        await seedGmailThreadHistory(scope, builder, history);
      }
      let context = await builder.buildPacket(scope.id, current);
      const localBuilder = builder;
      let routerHeads = [];
      if (identity && globalThis.LHG_SETTINGS?.get().lhgMemoryEnabled === true &&
          globalThis.LHG_SETTINGS?.get().lhgRouterEnabled === true) {
        let timer;
        try {
          const checkPrefs = await chrome.storage?.local?.get?.('lhgCheckMode');
          const response = await Promise.race([
            chrome.runtime.sendMessage({type:'lhg-memory',
              op: !checkPrefs?.lhgCheckMode || checkPrefs.lhgCheckMode === 'cloud' ? 'route_context' : 'plan_context',
              scope:identity,text:payload.text}),
            new Promise(resolve => { timer=setTimeout(()=>resolve(null),450); })
          ]);
          if (response?.ok && response.result?.status === 'ok') {
            routerHeads = response.result.labels || [];
            context = localBuilder.mergeMemory(context,response.result.candidates);
          }
        } catch (_) { /* router failure leaves the normal packet unchanged */ }
        finally {clearTimeout(timer);}
      }
      packetBuilders.set(context, localBuilder);
      const state = loopStates.get(payload.loopToken);
      if (state) { state.builder = localBuilder; state.context = context; }
      if (remember && !history) await builder.ingestMessage(scope.id, current);
      // Ephemeral conversation refs, version counters and wall-clock ages do
      // not define content identity. Keep all semantic packet fields.
      const cacheContext = JSON.parse(JSON.stringify(context, (key, value) =>
        ['conversationRef', 'contextVersion', 'ageMinutes'].includes(key) ? undefined : value));
      let historyFingerprint;
      if (history) {
        const raw = JSON.stringify(history);
        if (globalThis.crypto?.subtle) {
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
          historyFingerprint = Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
        } else historyFingerprint = globalThis.LHG_CONTEXT_STORE?.hashText?.(raw);
      }
      return { ...payload, routerHeads, platform: scope.platform, context,
        cacheContext: history ? { ...cacheContext, historyFingerprint } : cacheContext };
    });
    pending = work.catch(() => {});
    return work.catch(() => payload); // storage/DOM failure never breaks a check
  }

  function send(payload, callback, el, controls = {}) {
    prepare(payload, el).then((message) => {
      const state = loopStates.get(message.loopToken);
      if (state) {
        const before = state.current;
        state.current = () => before() && (!controls.current || controls.current());
        state.progress = controls.progress;
      }
      sendPrepared(message, callback);
    });
  }
  function sendPrepared(message, callback) {
    chrome.runtime.sendMessage(message, (r) => {
      loopStates.delete(message.loopToken);
      // lastError stays readable: the callback runs synchronously in here.
      callback(withLocalNames(r, message && message.context && message.context.conversationRef, packetBuilders.get(message.context)));
    });
  }

  // Resolve the analysis refs back to display names IN THE PAGE only, so the
  // panel can say who is speaking and about whom. Names never left the page.
  function withLocalNames(r, convId, localBuilder = builder) {
    try {
      const a = r && r.analysis;
      if (!a || !localBuilder || !convId) return r;
      const name = (ref) => (ref && ref !== 'self' ? localBuilder.displayForRef(convId, ref) : '');
      return { ...r, localNames: { speaker: name(a.speakerRef), subject: name(a.subjectRef) } };
    } catch (_) {
      return r;
    }
  }
  // Local conversation identity (platform + DOM key) for per-conversation
  // state kept in this browser only (LHG_RULES answers). null = unknown.
  function conversationKey(platform, el) {
    try {
      const scope = scopeFor(platform, el);
      return scope ? scope.platform + ':' + scope.key : null;
    } catch (_) {
      return null;
    }
  }
  function contentKey(platform, el, text) {
    return JSON.stringify([globalThis.LHG_MEMORY?.scopeFor?.(platform, el),
      text, platform === 'gmail' ? gmailHistory(el, text) : null]);
  }
  globalThis.LHG_CONTEXT_RUNTIME = { prepare, send, sendPrepared, withLocalNames, conversationKey, contentKey };
})();
