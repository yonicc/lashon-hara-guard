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
      root = el?.closest?.('[data-thread-id], [data-space-id]');
      if (!root) return null;
      key = root.getAttribute('data-thread-id') || root.getAttribute('data-space-id');
      kind = root.getAttribute('data-thread-id') ? 'email_thread' : 'unknown';
      if (root.getAttribute('data-space-id')) platform = 'google-chat';
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
      const context = await builder.buildPacket(scope.id, current);
      if (remember) await builder.ingestMessage(scope.id, current);
      return { ...payload, platform: scope.platform, context };
    });
    pending = work.catch(() => {});
    return work.catch(() => payload); // storage/DOM failure never breaks a check
  }

  function send(payload, callback, el) {
    prepare(payload, el).then(message => chrome.runtime.sendMessage(message, callback));
  }
  globalThis.LHG_CONTEXT_RUNTIME = { prepare, send };
})();
