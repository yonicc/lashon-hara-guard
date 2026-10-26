// Google adapter (MVP, incoming only): Google Chat spaces and opened Gmail
// threads. Newly arriving messages get a subtle tag; old thread history is
// only a baseline and is never sent. Nothing is blocked or rewritten.
(() => {
  const S = globalThis.LHG_SELECTORS;
  if (!S || !globalThis.LHG_INCOMING) return;

  const onChat = location.hostname === 'chat.google.com';
  const MAP = onChat ? S.googleChat : S.gmail;
  const PLATFORM = onChat ? 'google-chat' : 'gmail';
  const MIN_CHARS = 6;

  function findRows(root) {
    const rows = onChat ? S.all(root, MAP.messageRow) : S.all(root, MAP.messageBody);
    return rows
      .map((el) => ({ el, text: S.extractText(el, MAP.messageText) }))
      .filter((r) => r.text && r.text.length >= MIN_CHARS);
  }

  const scanner = globalThis.LHG_INCOMING.createScanner({ platform: PLATFORM, findRows });
  scanner.scan(); // baseline: opened history is marked seen, never sent

  let t = null;
  const requestScan = () => {
    clearTimeout(t);
    t = setTimeout(() => scanner.scan(), 800);
  };
  new MutationObserver(requestScan).observe(document.body, { childList: true, subtree: true });
  setInterval(() => scanner.scan(), 15000);
})();
