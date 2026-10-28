// The setup page alone may download the fixed, canonical local models.
// No preference changes happen here; activation is a separate user action.
(() => {
  function create({ client, mode, probe }) {
    let busy = false;
    return {
      inspect: () => client.inspect(),
      async install(selected, progress, signal) {
        const ids = mode.LOCAL_ENGINES[selected];
        if (!ids || busy) throw new Error('setup_invalid_or_busy');
        busy = true;
        try {
          const installed = await client.inspect();
          for (const id of ids) {
            if (signal.aborted) throw new Error('setup_cancelled');
            if (!installed[id]) await client.pull(id, progress, signal);
          }
          if (signal.aborted) throw new Error('setup_cancelled');
          progress({ phase: 'testing' });
          // Exercise each engine separately; a union warning must not hide a failed peer.
          for (const id of ids) {
            if (signal.aborted) throw new Error('setup_cancelled');
            const result = await probe(id);
            if (!result || result.error || !['none', 'warn', 'unsure'].includes(result.alert) || result.rules?.notChecked)
              throw new Error('setup_probe_failed');
          }
          if (signal.aborted) throw new Error('setup_cancelled');
          return { ready: true, mode: selected };
        } finally { busy = false; }
      },
    };
  }
  globalThis.LHG_OLLAMA_SETUP = { create };
  if (!globalThis.chrome?.runtime?.onConnect) return;
  const service = create({
    client: globalThis.LHG_OLLAMA_CLIENT.create(),
    mode: globalThis.LHG_CHECK_MODE,
    probe: id => globalThis.LHG_OLLAMA_ENGINE.check({
      text: 'I checked the invoice.', platform: 'setup', direction: 'outgoing', lang: 'en',
    }, id, globalThis.LHG_OLLAMA_CLIENT.create()),
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'lhg-ollama-setup' ||
        port.sender?.url !== chrome.runtime.getURL('ollama-setup.html')) return;
    let abort;
    const send = data => { try { port.postMessage(data); } catch (_) {} };
    port.onDisconnect.addListener(() => abort?.abort());
    port.onMessage.addListener(msg => {
      if (msg?.action === 'ping') return; // heartbeat keeps the visible setup operation alive in MV3
      if (msg?.action === 'cancel') { abort?.abort(); return; }
      if (msg?.action === 'inspect') {
        service.inspect().then(models => send({ phase: 'connected', models }),
          error => send({ phase: error.message === 'ollama_http_403' ? 'blocked' : 'offline' }));
      }
      if (msg?.action === 'install' && !abort) {
        abort = new AbortController();
        service.install(msg.mode, send, abort.signal)
          .then(result => send({ phase: 'ready', ...result }),
            () => send({ phase: abort.signal.aborted ? 'cancelled' : 'failed' }))
          .finally(() => { abort = null; });
      }
    });
  });
})();
