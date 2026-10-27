// Shared by options.html (full settings) and popup.html (quick switches):
// every binding below is skipped when its element is absent. Switches live
// in settings.js, the language and all texts in i18n.js; open tabs follow
// both live through chrome.storage.onChanged.
(() => {
  const I = globalThis.LHG_I18N;
  const S = globalThis.LHG_SETTINGS;
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
