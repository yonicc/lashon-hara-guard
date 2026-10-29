// Shared by options.html (full settings) and popup.html (quick switches):
// every binding below is skipped when its element is absent. Switches live
// in settings.js, the language and all texts in i18n.js; open tabs follow
// both live through chrome.storage.onChanged.
(() => {
  const I = globalThis.LHG_I18N;
  const S = globalThis.LHG_SETTINGS;
  const M = globalThis.LHG_CHECK_MODE;
  const P = globalThis.LHG_CHECK_PRESETS; // options page only (the popup does not load it)
  const t = (k, v) => (I ? I.t(k, v) : k);
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const say = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const PANEL_GEOM_KEY = 'lhgPanelGeom'; // panel.js GEOM_KEY (panel.js is not loaded here)

  let shortcut = null; // chrome.commands value, re-rendered on a language switch

  function renderTexts() {
    if (I) I.apply(document);
    document.title = t('opt.pageTitle');
    say('langToggle', t('lang.other'));
    const lt = $('langToggle');
    if (lt) lt.title = t('lang.otherTitle');
    for (const b of document.querySelectorAll('[data-lang]')) {
      b.classList.toggle('active', !!I && b.getAttribute('data-lang') === I.lang());
    }
    if (shortcut !== null) {
      say('shortcut', shortcut ? t('opt.shortcut', { k: shortcut }) : t('opt.noShortcut'));
    }
    renderMode();
  }

  function renderSwitches(s) {
    if (!s) return;
    const en = $('enabled');
    if (en) en.checked = s.lhgEnabled;
    const box = $('platforms');
    if (box) box.classList.toggle('off', !s.lhgEnabled);
    for (const el of document.querySelectorAll('[data-platform]')) {
      el.checked = s.lhgPlatforms[el.getAttribute('data-platform')] !== false;
    }
    const hide = $('hideIncoming');
    if (hide) hide.checked = s.hideIncoming;
    if ($('memoryEnabled')) $('memoryEnabled').checked = s.lhgMemoryEnabled === true;
    if ($('routerEnabled')) $('routerEnabled').checked = s.lhgRouterEnabled === true;
    settingsNow = s;
    renderPresets();
  }

  // --- language ---------------------------------------------------------------
  on('langToggle', 'click', () => { if (I) I.setLang(I.lang() === 'he' ? 'en' : 'he'); });
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.addEventListener('click', () => { if (I) I.setLang(b.getAttribute('data-lang')); });
  }
  if (I) I.onChange(renderTexts);

  // --- switches ---------------------------------------------------------------
  if (S) {
    on('enabled', 'change', () => {
      const v = $('enabled').checked;
      S.set({ lhgEnabled: v });
      say('generalStatus', v ? t('status.on') : t('status.off'));
    });
    for (const el of document.querySelectorAll('[data-platform]')) {
      el.addEventListener('change', () => S.setPlatform(el.getAttribute('data-platform'), el.checked));
    }
    on('hideIncoming', 'change', () => {
      const v = $('hideIncoming').checked;
      S.set({ hideIncoming: v });
      say('generalStatus', v ? t('status.hideOn') : t('status.hideOff'));
    });
    S.onChange(renderSwitches);
    S.ready().then(renderSwitches);
  }

  // --- panel ------------------------------------------------------------------
  // --- check mode (check-mode.js is the one home of modes and models) --------
  let modePrefs = M ? M.normalize({}) : null;
  let localReady = {}; // { 'local-fast': bool, ... } from the background worker
  let localKnown = false; // the background answered (until then: no install badges)
  let settingsNow = null; // LHG_SETTINGS state, for the memory part of a preset

  // --- presets grid (check-presets.js is the one home of the presets) ------
  function buildPresetGrid(grid) {
    const el = (tag, cls, attrs) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
      return n;
    };
    const scale = el('div', 'preset-scale');
    scale.append(el('span', 'scale-start'), el('span', 'scale-end'));
    grid.appendChild(scale);
    for (const col of P.COLS) grid.appendChild(el('div', 'preset-colhead', { 'data-col': col }));
    for (const row of P.ROWS) {
      grid.appendChild(el('div', 'preset-rowhead', { 'data-row': row }));
      for (const col of P.COLS) {
        const p = P.PRESETS.find((x) => x.col === col && x.row === row);
        const b = el('button', 'preset', { type: 'button', 'data-preset': p.id, 'data-col': col, 'data-row': row, 'aria-pressed': 'false' });
        const badge = el('span', 'preset-badge');
        badge.hidden = true;
        const meta = el('dl', 'preset-meta');
        for (const k of P.AXES) {
          const m = el('div', 'meta', { 'data-k': k, 'data-level': String(p.levels[k]) });
          m.append(el('dt'), el('dd'));
          meta.appendChild(m);
        }
        b.append(el('span', 'preset-name'), badge, meta);
        b.addEventListener('click', () => choosePreset(p.id));
        grid.appendChild(b);
      }
    }
  }
  function renderPresets() {
    const grid = $('presetGrid');
    if (!P || !M || !grid || !modePrefs) return;
    if (!grid.childElementCount) buildPresetGrid(grid);
    const q = (sel) => grid.querySelector(sel);
    q('.scale-start').textContent = t('preset.scaleStart');
    q('.scale-end').textContent = t('preset.scaleEnd');
    for (const h of grid.querySelectorAll('.preset-colhead')) h.textContent = t('preset.col.' + h.getAttribute('data-col'));
    for (const h of grid.querySelectorAll('.preset-rowhead')) h.textContent = t('preset.row.' + h.getAttribute('data-row'));
    const active = settingsNow ? P.presetOf(modePrefs, settingsNow) : null;
    for (const b of grid.querySelectorAll('button.preset')) {
      const id = b.getAttribute('data-preset');
      b.setAttribute('aria-pressed', String(id === active));
      b.querySelector('.preset-name').textContent = t('preset.' + id + '.name');
      b.title = id === 'B' ? t('preset.B.hint') : '';
      const badge = b.querySelector('.preset-badge');
      badge.hidden = !(localKnown && P.needsInstall(id, localReady));
      badge.textContent = t('preset.badge');
      for (const m of b.querySelectorAll('.meta')) {
        const k = m.getAttribute('data-k');
        m.querySelector('dt').textContent = t('preset.k.' + k);
        m.querySelector('dd').textContent = t('preset.' + id + '.' + k);
      }
    }
    const custom = $('presetCustom');
    if (custom) custom.hidden = !settingsNow || active !== null;
  }
  function choosePreset(id) {
    if (P.needsInstall(id, localReady)) {
      // Switching now would leave messages unchecked: install first, choose after.
      try { chrome.tabs.create({ url: chrome.runtime.getURL('ollama-setup.html') }); } catch (_e) { location.href = 'ollama-setup.html'; }
      say('presetStatus', t('preset.installFirst'));
      return;
    }
    const patch = P.patchFor(id);
    if (patch.settings && S) { S.set(patch.settings); settingsNow = { ...(settingsNow || {}), ...patch.settings }; }
    saveMode(patch.mode);
    say('presetStatus', t('preset.applied', { name: t('preset.' + id + '.name') }));
  }

  function renderMode() {
    if (!M || !modePrefs) return;
    renderPresets();
    for (const r of document.querySelectorAll('input[name="checkMode"]')) r.checked = r.value === modePrefs.lhgCheckMode;
    for (const b of document.querySelectorAll('[data-mode-badge]')) {
      const mode = b.getAttribute('data-mode-badge');
      b.textContent = mode === 'cloud' ? '' : t(localReady[mode] ? 'mode.experimental' : 'mode.notInstalled');
    }
    if ($('cloudFallback')) $('cloudFallback').checked = modePrefs.lhgCloudFallback;
    const sel = $('cloudModel');
    if (sel) {
      if (sel.options.length !== M.CLOUD_MODELS.length) {
        sel.textContent = '';
        for (const m of M.CLOUD_MODELS) sel.appendChild(new Option(m.label, m.id));
      }
      for (const o of sel.options) {
        const m = M.CLOUD_MODELS.find((x) => x.id === o.value);
        o.textContent = o.value === M.DEFAULT_CLOUD_MODEL ? t('mode.defaultModel', { m: m.label }) : m.label;
      }
      sel.value = modePrefs.lhgCloudModel;
    }
    const local = modePrefs.lhgCheckMode !== 'cloud';
    const quick = $('modeQuick');
    if (quick) quick.hidden = !local;
    if (!local) say('modeStatus', t('mode.statusCloud'));
    else if (localReady[modePrefs.lhgCheckMode]) say('modeStatus', t('mode.statusLocal'));
    else say('modeStatus', t(modePrefs.lhgCloudFallback ? 'mode.statusFallback' : 'mode.statusUnchecked'));
  }
  function saveMode(patch) {
    modePrefs = M.normalize({ ...modePrefs, ...patch });
    chrome.storage.local.set(modePrefs, renderMode);
    renderMode();
  }
  if (M && (document.querySelector('input[name="checkMode"]') || $('useCloud'))) {
    chrome.storage.local.get(M.KEYS, (s) => { modePrefs = M.normalize(s || {}); renderMode(); });
    try {
      chrome.runtime.sendMessage({ type: 'lhg-check-mode-status' }, (r) => {
        void chrome.runtime.lastError;
        localReady = (r && typeof r === 'object') ? r : {};
        localKnown = true;
        renderMode();
      });
    } catch (_e) { /* no background: every local mode stays "not installed" */ }
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area && area !== 'local') return;
        if (!ch || !M.KEYS.some((k) => k in ch)) return;
        const merged = { ...modePrefs };
        for (const k of M.KEYS) if (k in ch) merged[k] = ch[k].newValue;
        modePrefs = M.normalize(merged);
        renderMode();
      });
    }
    for (const r of document.querySelectorAll('input[name="checkMode"]')) {
      r.addEventListener('change', () => { if (r.checked) saveMode({ lhgCheckMode: r.value }); });
    }
    on('cloudFallback', 'change', () => saveMode({ lhgCloudFallback: $('cloudFallback').checked }));
    on('useCloud', 'click', () => saveMode({ lhgCheckMode: 'cloud' })); // one click back to the cloud
    on('cloudModel', 'change', () => saveMode({ lhgCloudModel: $('cloudModel').value }));
  }

  on('memoryEnabled', 'change', () => S?.set({lhgMemoryEnabled:$('memoryEnabled').checked}));
  on('routerEnabled', 'change', () => S?.set({lhgRouterEnabled:$('routerEnabled').checked}));
  on('routerImport','change',async()=>{
    say('routerStatus',t('memory.working'));
    try {
      await (await import('./memory-router-model.mjs')).importRouter($('routerImport').files);
      const ready=await chrome.runtime.sendMessage({type:'lhg-memory',op:'router_install'});
      if(!ready?.ok) throw Error('router-unavailable');
      say('routerStatus',t('router.ready'));
    } catch {say('routerStatus',t('memory.failed'));}
    finally {$('routerImport').value='';}
  });
  on('memoryView', 'click', () => chrome.tabs.create({ url: chrome.runtime.getURL('memory-viewer.html') }));
  on('memoryImport','change',async()=>{
    say('memoryStatus',t('memory.working'));
    try {
      await (await import('./memory-embedding.mjs')).importModel($('memoryImport').files);
      const r=await chrome.runtime.sendMessage({type:'lhg-memory',op:'install'});
      say('memoryStatus',t(r?.ok?'memory.ready':'memory.failed'));
    } catch {say('memoryStatus',t('memory.failed'));}
    finally {$('memoryImport').value='';}
  });
  for (const [id, op] of [['memoryInstall','install'],['memoryClear','clear']]) {
    on(id,'click',async()=>{
      $(id).disabled=true;
      say('memoryStatus',t('memory.working'));
      try {
        if(op==='install') await (await import('./memory-embedding.mjs')).installModel();
        const result=await chrome.runtime.sendMessage({type:'lhg-memory',op});
        say('memoryStatus',t(result?.ok ? (op==='clear'?'memory.cleared':'memory.ready') : 'memory.failed'));
      } catch {say('memoryStatus',t('memory.failed'));}
      finally {$(id).disabled=false;}
    });
  }

  // Open the in-page panel without the keyboard shortcut. Chrome only assigns a
  // command's suggested key on a fresh install, so an extension that gained the
  // command in an update can have NO shortcut (seen on BI-1 2026-10-26). This
  // also tells the user whether the content script is running in the tab.
  on('openPanel', 'click', () => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      const url = (tab && tab.url) || '';
      if (!tab || !/^https:\/\/(web\.whatsapp\.com|chat\.google\.com|mail\.google\.com)\//.test(url)) {
        say('tabStatus', t('opt.needTab'));
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'lhg-open-panel' }, () => {
        if (chrome.runtime.lastError) {
          say('tabStatus', t('opt.noScript'));
        } else {
          say('tabStatus', t('opt.opened'));
          window.close();
        }
      });
    });
  });
  on('resetPanel', 'click', () => {
    chrome.storage.local.remove(PANEL_GEOM_KEY, () => say('tabStatus', t('opt.resetDone')));
  });
  on('openOptions', 'click', () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    window.close();
  });
  if ($('shortcut') && chrome.commands && chrome.commands.getAll) {
    chrome.commands.getAll((cmds) => {
      const c = (cmds || []).find((x) => x.name === 'open-panel');
      shortcut = (c && c.shortcut) || '';
      renderTexts();
    });
  }

  // --- account ----------------------------------------------------------------
  if ($('accessKey')) {
    chrome.storage.local.get(['proxyUrl', 'accessKey'], (s) => {
      $('accessKey').value = (s && s.accessKey) || '';
      $('proxyUrl').value = (s && s.proxyUrl) || '';
    });
  }
  on('save', 'click', () => {
    chrome.storage.local.set({
      accessKey: $('accessKey').value.trim(),
      proxyUrl: $('proxyUrl').value.trim(),
    }, () => say('status', t('opt.saved')));
  });
  on('test', 'click', () => {
    say('status', t('opt.testing'));
    chrome.runtime.sendMessage(
      // Synthetic test text (data, not UI): Hebrew irony the checker flags.
      { type: 'lhg-check', text: 'וואו, איזה גאון, שוב הגיע באיחור של שעה', platform: 'options-test' },
      (r) => {
        if (!r) return say('status', t('opt.noReply'));
        if (r.alert === 'warn') say('status', t('opt.testOk'));
        else if (r.alert === 'not_configured') say('status', t('opt.keyBad'));
        else if (r.alert === 'not_checked') say('status', t('opt.noConn', { e: r.error || '' }));
        else say('status', t('opt.reply', { r: JSON.stringify(r) }));
      },
    );
  });

  renderTexts();
  if (I) I.ready().then(renderTexts);
})();
