(() => {
  const I = globalThis.LHG_I18N, M = globalThis.LHG_CHECK_MODE;
  const $ = id => document.getElementById(id);
  let selected = 'local-fast', readyMode = null, busy = false, connected = false, disconnected = false;
  let statusKey = 'setup.checking', statusVars = {};
  function render() {
    I.apply();
    $('status').textContent = I.t(statusKey, statusVars);
    $('choices').disabled = busy || !connected;
    $('connect').disabled = busy || disconnected;
    $('activate').disabled = busy || readyMode !== selected;
    $('cancel').hidden = !busy;
  }
  function say(key, vars = {}) { statusKey = key; statusVars = vars; render(); }
  for (const mode of M.MODES.filter(id => M.LOCAL_ENGINES[id])) {
    const label = document.createElement('label');
    label.className = 'mode-opt';
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'setupMode'; radio.value = mode;
    radio.checked = mode === selected;
    radio.addEventListener('change', () => { selected = mode; readyMode = null; render(); });
    const span = document.createElement('span');
    span.setAttribute('data-i18n', 'mode.' + mode);
    label.append(radio, span); $('modes').append(label);
  }
  const port = chrome.runtime.connect({ name: 'lhg-ollama-setup' });
  // Chrome 114+ requires messages (an idle port alone does not extend worker lifetime).
  const heartbeat = setInterval(() => port.postMessage({ action: 'ping' }), 20000);
  window.addEventListener('pagehide', () => { clearInterval(heartbeat); port.disconnect(); });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; clearInterval(heartbeat);
    busy = false; connected = false; readyMode = null; disconnected = true;
    $('progress').hidden = true;
    say('setup.disconnected');
  });
  port.onMessage.addListener(msg => {
    if (msg.phase === 'connected') connected = true;
    if (['offline', 'blocked'].includes(msg.phase)) connected = false;
    if (msg.phase === 'blocked') $('help').open = true;
    if (msg.id) {
      const ids = M.LOCAL_ENGINES[selected];
      $('progress').hidden = false;
      if (msg.percent === null) $('progress').removeAttribute('value');
      else $('progress').value = msg.percent;
      say('setup.downloading', { n: ids.indexOf(msg.id) + 1, count: ids.length,
        percent: msg.percent === null ? '' : msg.percent + '%' });
      return;
    }
    if (['ready', 'failed', 'cancelled'].includes(msg.phase)) {
      busy = false; $('progress').hidden = true;
      readyMode = msg.phase === 'ready' ? msg.mode : null;
    }
    if (msg.phase === 'testing') $('progress').removeAttribute('value');
    say('setup.' + msg.phase);
  });
  $('connect').addEventListener('click', () => {
    readyMode = null; say('setup.checking'); port.postMessage({ action: 'inspect' });
  });
  $('download').addEventListener('click', () => {
    busy = true; readyMode = null;
    $('progress').hidden = false; $('progress').removeAttribute('value');
    say('setup.downloading', { n: 1, count: M.LOCAL_ENGINES[selected].length, percent: '' });
    port.postMessage({ action: 'install', mode: selected });
  });
  $('cancel').addEventListener('click', () => port.postMessage({ action: 'cancel' }));
  $('activate').addEventListener('click', async () => {
    if (busy || readyMode !== selected) return;
    busy = true; render();
    try {
      await chrome.storage.local.set({ lhgCheckMode: readyMode, lhgCloudFallback: false });
      readyMode = null; say('setup.active');
    } catch (_) { say('setup.failed'); }
    finally { busy = false; render(); }
  });
  $('origin').value = chrome.runtime.getURL('').replace(/\/$/, '');
  $('copyOrigin').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('origin').value); $('copyStatus').textContent = I.t('setup.copied'); }
    catch (_) { $('copyStatus').textContent = I.t('setup.copyFailed'); }
  });
  $('language').addEventListener('click', () => I.setLang(I.lang() === 'he' ? 'en' : 'he'));
  I.onChange(render);
  I.ready().then(render);
  render();
  port.postMessage({ action: 'inspect' });
})();
