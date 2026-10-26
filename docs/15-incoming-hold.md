# 15 — Hold incoming chat messages until checked (extension 0.7.0)

Owner decision 2026-10-27: incoming chat messages stay hidden until they pass
the check; a warning needs the user's explicit approval to be shown. This
implements the incoming flow of docs/01 (steps 1, 4, 5) and IN-01 / IN-02.

## Behaviour (`extension/incoming.js`, shared by WhatsApp Web and Google Chat)

| Check result | What the user sees |
|---|---|
| pending | neutral placeholder "הודעה נכנסת נבדקת לפני הצגה…" instead of the content |
| `none` (no alert) | revealed automatically |
| `warn` / `unsure` | stays hidden; placeholder names the mechanism; buttons "הצג בכל זאת" and "למה?" (opens the panel with the who/about-whom/why details) |
| `not_checked`, `not_configured`, timeout, queue overflow | stays hidden; button "הצג בלי בדיקה" — a failure is never an implicit approval |

After "show", a small reminder tag stays next to a flagged message.
The setting "הסתר הודעות צ׳אט נכנסות עד שייבדקו" (`hideIncoming`, default on)
in the options page turns this off; then only tags are shown, as before.

## Scope and limits

- **Chat only.** Opened Gmail e-mails (`kind: 'email'` rows) are tagged, not held.
- **What counts as live:** the first scan is a baseline (history, never sent,
  never held). Later, more than `BURST_LIMIT` (3) new rows in one scan — opening
  another chat, scrolling up — are treated as history too: not held, not sent.
  Live messages arrive one or two at a time.
- **Before paint:** `LHG_INCOMING.observe` scans in the animation frame after a
  DOM addition, so a new message is covered before it is first painted. On a
  heavy page (a scan costing > 8 ms) scans keep a gap of ~4x their cost (max
  250 ms); there a very short flash is possible. Not verified per site yet —
  docs/01 requires a per-site proof (first load, scroll, previews,
  notifications). **Not covered:** chat-list previews and desktop
  notifications still show the text.
- **Re-mounts:** state is kept per message id (`weakId`: platform + text), so a
  virtualised re-render is covered again. Two identical texts share one state.
- Hiding uses `.lhg-held` (children `display:none`, own text `font-size:0`)
  plus a `.lhg-hold` placeholder; it never changes the page's row positions.
  Clicks on the placeholder do not reach the page (no open/quote/react).
- Rate: one check per 2.1 s, queue of 12; overflow becomes "לא נבדק" (held).
