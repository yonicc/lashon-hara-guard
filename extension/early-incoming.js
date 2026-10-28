// Gmail body guard runs before content scripts at document_idle.
// Default cover is fail-closed until stored on/off settings are available.
(() => {
  const apply = s => {
    const enabled = s.lhgEnabled !== false && s.hideIncoming !== false && s.lhgPlatforms?.gmail !== false;
    document.documentElement?.setAttribute('data-lhg-early', enabled ? 'on' : 'off');
  };
  apply({});
  chrome.storage.local.get(['lhgEnabled', 'hideIncoming', 'lhgPlatforms'], apply);
  chrome.storage.onChanged.addListener(() =>
    chrome.storage.local.get(['lhgEnabled', 'hideIncoming', 'lhgPlatforms'], apply));
})();
