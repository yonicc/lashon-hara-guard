// Shared local context bridge. Capture context before queueing/network waits.
// DOM identity and display names stay local; only builder packets cross runtime.
(() => {
  const scopes = new WeakMap();
  let serial = 0;
  const session = globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  let builder;
  let pending = Promise.resolve();
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

  // Gmail thread history (bug 2026-10-28): seed the builder with the older
  // messages already rendered in the opened thread (chronological, before
  // the current one). Runs ONLY for scope.kind === 'email_thread', and only
  // ONCE per conversation scope: every check in the same thread reuses the
  // seeded history (the builder dedups the current message itself in
  // buildPacket). Skips the current message itself and the outgoing draft
  // by text containment. Names stay local: ingestMessage takes display
  // names, the builder only exports anonymised refs + scrubbed text
  // (MAX_TEXT_OUT 300 chars). One billed check per user action is unchanged:
  // seeding only fills the builder's local window before that same packet.
  const seededScopes = new Set();
  async function seedGmailThreadHistory(scope, builder, currentEl, currentText) {
    try {
      if (seededScopes.has(scope.id)) return;
      seededScopes.add(scope.id);
      const S = globalThis.LHG_SELECTORS;
      if (!S || !S.gmail || typeof S.all !== 'function') return;
      const root = S.first(document, S.gmail.threadRoot) || document;
      const bodies = S.all(root, S.gmail.messageBody)
        .filter((el) => el !== currentEl && S.gmailIsMessageBody(el));
      const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
      const curNorm = norm(currentText);
      let n = 0;
      for (const body of bodies) {
        if (n >= 5) break; // builder window is MAX_RECENT (5)
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
        try {
          await builder.ingestMessage(scope.id, {
            text, direction: 'incoming', timestamp: Date.now() - (bodies.length - n) * 60000,
            authorDisplayName: author,
          });
          n++;
        } catch (_) { /* one bad row never breaks the check */ }
      }
    } catch (_) { /* DOM/bulder failure: check proceeds without history */ }
  }

  function prepare(payload, el, remember = false) {
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
    const work = pending.then(async () => {
      builder ||= globalThis.LHG_CONTEXT_BUILDER.createContextBuilder();
      await builder.ingestConversation({ id: scope.id, platform: scope.platform, kind: scope.kind });
      if (scope.kind === 'email_thread') {
        await seedGmailThreadHistory(scope, builder, el, current.text);
      }
      const context = await builder.buildPacket(scope.id, current);
      if (remember) await builder.ingestMessage(scope.id, current);
      return { ...payload, platform: scope.platform, context };
    });
    pending = work.catch(() => {});
    return work.catch(() => payload); // storage/DOM failure never breaks a check
  }

  function send(payload, callback, el) {
    prepare(payload, el).then((message) => chrome.runtime.sendMessage(message, (r) => {
      // lastError stays readable: the callback runs synchronously in here.
      callback(withLocalNames(r, message && message.context && message.context.conversationRef));
    }));
  }

  // Resolve the analysis refs back to display names IN THE PAGE only, so the
  // panel can say who is speaking and about whom. Names never left the page.
  function withLocalNames(r, convId) {
    try {
      const a = r && r.analysis;
      if (!a || !builder || !convId) return r;
      const name = (ref) => (ref && ref !== 'self' ? builder.displayForRef(convId, ref) : '');
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
  globalThis.LHG_CONTEXT_RUNTIME = { prepare, send, withLocalNames, conversationKey };
})();
