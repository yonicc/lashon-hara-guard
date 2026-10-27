# Chafetz Chaim — source text layer

The Hebrew text of **Chafetz Chaim**, Part One (Hilchot Issurei Lashon Hara, principles 1–10) and
Part Two (Hilchot Issurei Rechilut, principles 1–9), as served by the Sefaria API.

- **Attribution / license:** text from [Sefaria](https://www.sefaria.org), version "Chofetz Chaim",
  license **CC-BY-SA** (per `heLicense` in each raw file). Keep this attribution with any copy.
- `raw/` — the API responses (ref, heRef, license, version, `he`). Never hand-edit.
- `text/` — one readable file per principle, one `[n]` paragraph per se'if.
- `manifest.json` — per se'if: exact Sefaria `ref`, `url`, `chars`, short `sha256` of the cleaned text.
- `fetch.py` re-fetches `raw/` from Sefaria; `build.py` regenerates `text/` + `manifest.json`.

## Status and limits
- This is **source text only**. No rule here is a ruling; rule cards that cite it live under
  `rules/` and stay `draft` until a qualified human review approves them (docs/03, docs/08).
- Not included yet: the introduction (Petichah: lavin/asin/arurin), the Be'er Mayim Chaim commentary
  and the illustrations (Tziyurim). Rules that depend on them must say so.
