const $ = (id) => document.getElementById(id);

// Open the in-page panel without the keyboard shortcut. Chrome only assigns a
// command's suggested key on a fresh install, so an extension that gained the
// command in an update can have NO shortcut (seen on BI-1 2026-10-26). This
// also tells the user whether the content script is running in the tab.
$('openPanel').addEventListener('click', () => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const url = (tab && tab.url) || '';
    if (!tab || !/^https:\/\/(web\.whatsapp\.com|chat\.google\.com|mail\.google\.com)\//.test(url)) {
      $('tabStatus').textContent = 'פתח קודם את WhatsApp Web (או Gmail/Google Chat) ולחץ על אייקון התוסף מתוכו.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'lhg-open-panel' }, () => {
      if (chrome.runtime.lastError) {
        $('tabStatus').textContent =
          'התוסף לא פעיל בלשונית הזו. רענן את העמוד (F5) אחרי טעינה מחדש של התוסף, ונסה שוב.';
      } else {
        $('tabStatus').textContent = 'הפאנל נפתח בעמוד ✓';
        window.close();
      }
    });
  });
});

if (chrome.commands && chrome.commands.getAll) {
  chrome.commands.getAll((cmds) => {
    const c = (cmds || []).find((x) => x.name === 'open-panel');
    $('shortcut').textContent = c && c.shortcut
      ? 'קיצור מקלדת לפאנל: ' + c.shortcut
      : 'לא מוגדר קיצור מקלדת לפאנל. אפשר להגדיר ב־chrome://extensions/shortcuts, או להשתמש בכפתור שלמעלה.';
  });
}

async function load() {
  const s = await chrome.storage.local.get(['proxyUrl', 'accessKey', 'hideIncoming']);
  $('accessKey').value = s.accessKey || '';
  $('proxyUrl').value = s.proxyUrl || '';
  $('hideIncoming').checked = s.hideIncoming !== false; // default on
}

// Takes effect at once in open tabs (incoming.js listens to storage changes).
$('hideIncoming').addEventListener('change', async () => {
  await chrome.storage.local.set({ hideIncoming: $('hideIncoming').checked });
  $('status').textContent = $('hideIncoming').checked ? 'הסתרת הודעות נכנסות: פעילה ✓' : 'הסתרת הודעות נכנסות: כבויה';
});

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
