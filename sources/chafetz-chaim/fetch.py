# -*- coding: utf-8 -*-
"""Re-fetch the Chafetz Chaim principles (Part One: Lashon Hara 1-10, Part Two: Rechilut 1-9)
from the Sefaria API into raw/<key>.json, in the exact shape the committed files have.

Usage:  python -I sources/chafetz-chaim/fetch.py
Then compare with `git diff --stat sources/chafetz-chaim/raw` - any change in the source text
must be reviewed before rules that cite it are touched. Regenerate text/ and manifest.json from
raw/ with build.py."""
import json, os, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')

REFS = [('p1_prin%d' % i, 'Chafetz Chaim, Part One, The Prohibition Against Lashon Hara, Principle %d' % i)
        for i in range(1, 11)] + \
       [('p2_prin%d' % i, 'Chafetz Chaim, Part Two, The Prohibition Against Rechilut, Principle %d' % i)
        for i in range(1, 10)]


def get(ref):
    url = 'https://www.sefaria.org/api/texts/' + urllib.parse.quote(ref) + '?context=0&pad=0'
    req = urllib.request.Request(url, headers={'User-Agent': 'lashon-hara-guard-sources/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def main():
    os.makedirs(RAW, exist_ok=True)
    for key, ref in REFS:
        d = get(ref)
        with open(os.path.join(RAW, key + '.json'), 'w', encoding='utf-8') as f:
            json.dump({'ref': d.get('ref'), 'heRef': d.get('heRef'),
                       'heLicense': d.get('heLicense'), 'heVersionTitle': d.get('heVersionTitle'),
                       'sections': d.get('sections'), 'he': d.get('he')}, f, ensure_ascii=False)
        print('OK', key, d.get('heRef'))


if __name__ == '__main__':
    main()
