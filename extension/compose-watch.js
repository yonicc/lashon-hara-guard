// Shared outgoing check while typing (one home for every platform adapter).
// An adapter supplies only what is platform-specific: which element is a
// compose box and how to find the current one. The pause/debounce, warm-up,
// stale-response guard and "cleared after send" handling live here.
// Sending is never blocked and the text is never rewritten.
(() => {
  const PAUSE_MS = 1200;
  const MIN_CHARS = 6;
  const WARM_EVERY_MS = 4 * 60 * 1000; // the gate container sleeps after 5 idle minutes

  // opts: { platform, composeBox(el) -> box|null, findCompose() -> box|null }
  function createComposeWatcher(opts) {
    const P = globalThis.LHG_PANEL;
    let timer = null;
    let lastChecked = '';
    let seq = 0;
    let lastWarm = 0;

    const hide = () => P && P.hide();
    const show = (kind, title, lines) => P && P.show(kind, title, lines);
    const render = (r) => P && P.renderResult(r);
    const textOf = (box) => (box && (box.innerText || box.textContent) || '').trim();

    function warm() {
      const now = Date.now();
      if (now - lastWarm < WARM_EVERY_MS) return;
      lastWarm = now;
      try { chrome.runtime.sendMessage({ type: 'lhg-warm' }); } catch (_e) { /* extension reloaded */ }
    }

    function run(text) {
      if (text === lastChecked) return;
      lastChecked = text;
      const my = ++seq;
      show('checking', '…בודק ניסוח', []);
      const send = globalThis.LHG_CONTEXT_RUNTIME?.send || ((msg, cb) => chrome.runtime.sendMessage(msg, cb));
      send(
        { type: 'lhg-check', text, platform: opts.platform, direction: 'outgoing' },
        (r) => {
          if (my !== seq) return; // the user kept typing: a newer check owns the panel
          if (chrome.runtime.lastError) {
            render({ alert: 'not_checked' });
            return;
          }
          render(r);
        },
        opts.findCompose(),
      );
    }

    function schedule(box) {
      clearTimeout(timer);
      const text = textOf(box);
      if (text.length < MIN_CHARS) {
        lastChecked = '';
        hide();
        return;
      }
      timer = setTimeout(() => run(text), PAUSE_MS);
    }

    document.addEventListener(
      'input',
      (e) => {
        const box = opts.composeBox(e.target);
        if (box) {
          warm();
          schedule(box);
        }
      },
      true,
    );

    // After sending (Enter clears the box) drop any stale panel.
    document.addEventListener(
      'keyup',
      (e) => {
        const box = opts.composeBox(e.target);
        if (box && !textOf(box)) {
          seq++;
          lastChecked = '';
          clearTimeout(timer);
          hide();
        }
      },
      true,
    );

    return { readText: () => textOf(opts.findCompose()) };
  }

  globalThis.LHG_COMPOSE = { createComposeWatcher, MIN_CHARS };
})();
