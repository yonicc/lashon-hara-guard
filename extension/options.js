const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(['proxyUrl', 'accessKey']);
  $('accessKey').value = s.accessKey || '';
  $('proxyUrl').value = s.proxyUrl || '';
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    accessKey: $('accessKey').value.trim(),
    proxyUrl: $('proxyUrl').value.trim(),
  });
  $('status').textContent = 'נשמר ✓';
});

$('test').addEventListener('click', () => {
  $('status').textContent = '…בודק';
  chrome.runtime.sendMessage(
    { type: 'lhg-check', text: 'וואו, איזה גאון, שוב הגיע באיחור של שעה', platform: 'options-test' },
    (r) => {
      if (!r) return ($('status').textContent = 'אין תשובה מהתוסף');
      if (r.alert === 'warn') $('status').textContent = 'החיבור תקין ✓ (הודעת הבדיקה זוהתה כאירונית)';
      else if (r.alert === 'not_configured') $('status').textContent = 'מפתח הגישה חסר או שגוי';
      else if (r.alert === 'not_checked') $('status').textContent = 'אין חיבור: ' + (r.error || '');
      else $('status').textContent = 'התקבלה תשובה: ' + JSON.stringify(r);
    },
  );
});

load();
