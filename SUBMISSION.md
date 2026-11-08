# Lashon Hara Guard — Hackathon Submission

**Track:** Indie · **Theme:** Build for Your World
**Version:** 0.17.2 (Chrome + Firefox) · **Repo:** public, this repository

## What it does

Lashon Hara Guard is a browser extension that helps a sender pause before
sending a message that could be hurtful gossip (*lashon hara*). While you
compose in Gmail, WhatsApp Web or Google Chat, it checks the draft and,
when needed, asks a short clarifying question instead of guessing. Incoming
messages stay hidden until you explicitly approve a manual check.

It never issues a halachic ruling and never says "permitted". At most it
raises a gentle warning or suggests asking a rabbi — in Simple mode, only
the rabbi questions themselves, as an open bullet list; in PRO mode, with
sources and open doubts.

## How it works

1. A small gate classifier (Oracle, Modal fallback) scores the text locally
   first; below the threshold no cloud model is called at all.
2. Otherwise `muse-spark-1.3` extracts proposed facts with verbatim quotes.
   Missing context stays *unknown*, never *false*.
3. A rules engine over source-linked draft cards asks up to five catalog
   clarifying questions, or produces a referral-to-a-rabbi question list.

## Meta models in this project

- **Live:** `muse-spark-1.3` is the fact extractor in every `/check`.
- **Build:** `muse-spark-open` generated the 177 source cards (508 verified
  quotes kept, 15 non-verbatim removed); Muse Spark, Wonder and Image
  models built parts of the context layer, extractor, illustrations and
  explainer video. Details: `docs/31-model-contributions.md`.

## Sources and credits

The Chafetz Chaim text (Part One, Lashon Hara 1–10; Part Two, Rechilut 1–9)
is taken from [Sefaria](https://www.sefaria.org/Chafetz_Chaim), Hebrew version
"Chofetz Chaim", which Sefaria sourced from
[Hebrew Wikisource](https://he.wikisource.org/wiki/%D7%97%D7%A4%D7%A5_%D7%97%D7%99%D7%99%D7%9D),
licensed **CC BY-SA**. Source layer: `sources/chafetz-chaim/`. The extension
carries the same attribution (`extension/vendor/chafetz-chaim-sefaria-LICENSE.txt`,
the options page and the referral view).

## Try it (judges)

1. Download the build: https://lhg.ysho.uk/downloads/
2. Chrome: `chrome://extensions` → Developer mode → *Load unpacked*.
   Firefox: load the Firefox ZIP as a temporary add-on.
3. Open the extension options and paste the access token provided in the
   submission's judge notes (token label: "שופטים"). Checks on this token
   are billing-exempt; the daily safety cap still applies.
4. Open Gmail or WhatsApp Web, press `Ctrl+Shift+L`, and check a draft.

Privacy: see `PRIVACY.md` — checks send message text to the checking
service for remote processing; no message text is stored in account or
token metadata.
