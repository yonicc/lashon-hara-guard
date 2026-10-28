// Local memory viewer (memory-viewer.html, opened from the options page).
// Talks only to memory-background.js, which admits these operations from this
// page and options.html alone. Privacy (owner's decision 2026-10-28): stored
// text is masked by default; one click reveals one entry, "Show all" reveals
// every entry until the page is reloaded. Nothing about it is persisted.
(() => {
  const I = globalThis.LHG_I18N;
  const S = globalThis.LHG_SETTINGS;
  const t = (k, v) => (I ? I.t(k, v) : k);
  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  const PLATFORMS = ['gmail', 'google-chat', 'whatsapp-web'];
  const state = {
    stats: null, platform: '', conv: '', offset: 0, total: 0, items: [],
    query: '', results: null, showAll: false, revealed: new Set(),
    enabled: true, model: null, error: false,
  };

  const ask = async (op, extra = {}) => {
    const r = await chrome.runtime.sendMessage({ type: 'lhg-memory', op, ...extra });
    if (!r || !r.ok) throw Error((r && r.error) || 'memory-unavailable');
    return r.result;
  };
  const scopeId = (s) => JSON.stringify([s.platform, s.accountId, s.conversationId]);
  const selectedScope = () => {
    if (!state.conv || !state.stats) return null;
    const c = state.stats.conversationList.find((x) => scopeId(x.scope) === state.conv);
    return c ? c.scope : null;
  };
  const date = (ms) => (ms == null ? '-' : new Date(ms).toLocaleString(I && I.lang() === 'he' ? 'he-IL' : 'en-GB'));
  const shorten = (s, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  // The mask carries no content: a fixed run of dots, never the text's length.
  const MASK = '•'.repeat(24);
  const keyOf = (it) => scopeId(it.scope) + '\n' + it.ref;
  const filterArgs = () => {
    const a = {};
    if (state.platform) a.platform = state.platform;
    const scope = selectedScope();
    if (scope) a.scope = scope;
    return a;
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderNotice() {
    const n = $('viewerNotice');
    const lines = [];
    if (state.error) lines.push(t('viewer.unavailable'));
    if (!state.enabled) lines.push(t('viewer.off'));
    if (state.model === false) lines.push(t('viewer.noModel'));
    n.textContent = lines.join('\n');
    n.hidden = lines.length === 0;
    $('searchBtn').disabled = state.model === false;
  }

  function renderStats() {
    const s = state.stats;
    if (!s) { $('statsLine').textContent = state.error ? '' : t('viewer.loading'); return; }
    $('statsLine').textContent = s.messages ? t('viewer.statsLine', { m: s.messages, c: s.conversations, k: s.chunks, n: s.chars }) : t('viewer.empty');
    $('statsRange').textContent = s.messages ? t('viewer.range', { a: date(s.oldest), b: date(s.newest) }) : '';
    $('statsPlatforms').textContent = PLATFORMS.filter((p) => s.byPlatform[p].messages)
      .map((p) => t('viewer.platformLine', { p: t('plat.' + p), m: s.byPlatform[p].messages, c: s.byPlatform[p].conversations })).join('\n');
  }

  function renderFilters() {
    const pf = $('platformFilter');
    pf.textContent = '';
    pf.appendChild(new Option(t('viewer.allPlatforms'), ''));
    for (const p of PLATFORMS) pf.appendChild(new Option(t('plat.' + p), p));
    pf.value = state.platform;
    const cf = $('conversationFilter');
    cf.textContent = '';
    cf.appendChild(new Option(t('viewer.allConversations'), ''));
    for (const c of (state.stats ? state.stats.conversationList : [])) {
      if (state.platform && c.scope.platform !== state.platform) continue;
      cf.appendChild(new Option(t('viewer.convOption', {
        p: t('plat.' + c.scope.platform), a: shorten(c.scope.accountId), c: shorten(c.scope.conversationId), m: c.messages,
      }), scopeId(c.scope)));
    }
    if (!selectedScope() || (state.platform && selectedScope().platform !== state.platform)) state.conv = '';
    cf.value = state.conv;
    $('deleteConversation').disabled = !selectedScope();
  }

  function renderItem(it) {
    const row = el('div', 'mem-item');
    const meta = el('div', 'mem-meta');
    const bits = [t('viewer.kind.' + it.kind), t('viewer.dir.' + it.direction), t('plat.' + it.scope.platform),
      t('viewer.observed', { d: date(it.observedAt) }), t('viewer.expires', { d: date(it.expiresAt) }), t('viewer.chars', { n: it.chars })];
    if (typeof it.score === 'number') bits.unshift(t('viewer.score', { s: it.score.toFixed(3) }));
    meta.textContent = bits.join(' · ');
    const shown = state.showAll || state.revealed.has(keyOf(it));
    const text = el('div', 'mem-text' + (shown ? '' : ' masked'), shown ? (it.match || it.text) : MASK);
    text.title = t('viewer.reveal');
    text.setAttribute('role', 'button');
    text.addEventListener('click', () => {
      const k = keyOf(it);
      if (state.revealed.has(k)) state.revealed.delete(k); else state.revealed.add(k);
      renderEntries();
    });
    const del = el('button', 'btn soft mem-delete', t('viewer.delete'));
    del.type = 'button';
    del.addEventListener('click', () => deleteEntry(it));
    row.append(meta, text, del);
    return row;
  }

  function renderEntries() {
    const box = $('entries');
    box.textContent = '';
    const searching = state.results !== null;
    const items = searching ? state.results : state.items;
    for (const it of items) box.appendChild(renderItem(it));
    $('toggleAll').textContent = t(state.showAll ? 'viewer.hideAll' : 'viewer.showAll');
    $('searchClear').hidden = !searching;
    $('prevPage').hidden = $('nextPage').hidden = searching;
    $('prevPage').disabled = state.offset === 0;
    $('nextPage').disabled = state.offset + PAGE >= state.total;
    $('pageInfo').textContent = searching ? t('viewer.results', { n: items.length })
      : (state.total ? t('viewer.page', { a: state.offset + 1, b: Math.min(state.offset + PAGE, state.total), n: state.total }) : t('viewer.empty'));
  }

  function renderAll() {
    if (I) I.apply(document);
    document.title = t('viewer.title');
    $('langToggle').textContent = t('lang.other');
    renderNotice(); renderStats(); renderFilters(); renderEntries();
  }

  async function loadList() {
    const r = await ask('list', { args: { ...filterArgs(), offset: state.offset, limit: PAGE } });
    state.total = r.total; state.items = r.items;
  }

  async function reload() {
    $('viewerStatus').textContent = t('viewer.loading');
    try {
      state.stats = await ask('stats');
      renderFilters();
      if (state.offset >= (state.stats.messages || 0)) state.offset = 0;
      await loadList();
      if (state.results !== null) await runSearch(false);
      state.error = false;
      $('viewerStatus').textContent = '';
    } catch (_e) {
      state.error = true;
      $('viewerStatus').textContent = '';
    }
    renderAll();
  }

  async function runSearch(render = true) {
    const q = $('searchQuery').value.trim();
    if (!q) { state.results = null; if (render) renderEntries(); return; }
    $('viewerStatus').textContent = t('viewer.loading');
    try {
      state.results = await ask('search', { args: { ...filterArgs(), query: q, top_k: 20 } });
      $('viewerStatus').textContent = '';
    } catch (_e) {
      state.results = null;
      $('viewerStatus').textContent = t('viewer.searchFailed');
    }
    if (render) renderEntries();
  }

  async function deleteEntry(it) {
    if (!globalThis.confirm(t('viewer.confirmMessage'))) return;
    try {
      await ask('delete_message', { scope: it.scope, sourceId: it.ref });
      state.revealed.delete(keyOf(it));
      await reload();
      $('viewerStatus').textContent = t('viewer.deleted');
    } catch (_e) { state.error = true; renderNotice(); }
  }

  async function deleteConversation() {
    const scope = selectedScope();
    if (!scope) return;
    const c = state.stats.conversationList.find((x) => scopeId(x.scope) === state.conv);
    if (!globalThis.confirm(t('viewer.confirmConversation', { m: c.messages }))) return;
    try {
      await ask('delete_conversation', { scope });
      state.conv = ''; state.offset = 0;
      await reload();
      $('viewerStatus').textContent = t('viewer.deleted');
    } catch (_e) { state.error = true; renderNotice(); }
  }

  async function checkModel() {
    try { state.model = await (await import('./memory-embedding.mjs')).modelInstalled(); }
    catch (_e) { state.model = false; }
    renderNotice();
  }

  // --- wiring ------------------------------------------------------------------
  $('langToggle').addEventListener('click', () => { if (I) I.setLang(I.lang() === 'he' ? 'en' : 'he'); });
  if (I) I.onChange(renderAll);
  $('refresh').addEventListener('click', reload);
  $('platformFilter').addEventListener('change', () => {
    state.platform = $('platformFilter').value; state.conv = ''; state.offset = 0; reload();
  });
  $('conversationFilter').addEventListener('change', () => {
    state.conv = $('conversationFilter').value; state.offset = 0;
    if (selectedScope()) state.platform = selectedScope().platform;
    reload();
  });
  $('deleteConversation').addEventListener('click', deleteConversation);
  $('searchBtn').addEventListener('click', () => runSearch());
  $('searchQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  $('searchClear').addEventListener('click', () => { $('searchQuery').value = ''; state.results = null; renderEntries(); });
  $('toggleAll').addEventListener('click', () => { state.showAll = !state.showAll; state.revealed.clear(); renderEntries(); });
  $('prevPage').addEventListener('click', async () => { state.offset = Math.max(0, state.offset - PAGE); await reload(); });
  $('nextPage').addEventListener('click', async () => { state.offset += PAGE; await reload(); });
  if (S) {
    const follow = (s) => { state.enabled = !!s && s.lhgMemoryEnabled === true; renderNotice(); };
    S.onChange(follow);
    S.ready().then(follow);
  }

  globalThis.LHG_MEMORY_VIEWER = { state, reload, runSearch, MASK };
  renderAll();
  const started = Promise.all([I ? I.ready() : null, reload(), checkModel()]).then(renderAll);
  globalThis.LHG_MEMORY_VIEWER.started = started;
})();
