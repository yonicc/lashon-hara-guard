# -*- coding: utf-8 -*-
"""Build text/<key>.txt and manifest.json from raw/<key>.json (Sefaria API responses).

Every se'if gets an exact Sefaria ref, a URL and a short sha256 of its cleaned text, so a rule
card can cite `ref` and a later re-fetch can prove the cited text did not change.
Usage:  python -I sources/chafetz-chaim/build.py"""
import glob, hashlib, json, os, re, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, TEXT = os.path.join(HERE, 'raw'), os.path.join(HERE, 'text')
TAG = re.compile(r'<[^>]+>')
KEY = re.compile(r'p(\d)_prin(\d+)$')


def clean(s):
    return ' '.join(TAG.sub('', s).split())


def flat(node):
    if isinstance(node, str):
        return [node]
    out = []
    for x in node or []:
        out.extend(flat(x))
    return out


def order(path):
    return tuple(int(x) for x in KEY.search(os.path.splitext(os.path.basename(path))[0]).groups())


def seif_url(ref):
    return 'https://www.sefaria.org/' + urllib.parse.quote(ref.replace(' ', '_'), safe=':_,')


def main():
    os.makedirs(TEXT, exist_ok=True)
    manifest = {'source': 'Sefaria (https://www.sefaria.org)', 'license': 'CC-BY-SA',
                'status': 'source_text_only_no_rulings', 'principles': []}
    total = 0
    for path in sorted(glob.glob(os.path.join(RAW, 'p[12]_prin*.json')), key=order):
        key = os.path.splitext(os.path.basename(path))[0]
        raw = open(path, 'rb').read()
        d = json.loads(raw.decode('utf-8'))
        seifim = []
        lines = ['# ' + d['heRef'], '# ' + d['ref'],
                 '# license: %s | version: %s' % (d.get('heLicense'), d.get('heVersionTitle')), '']
        for i, node in enumerate(d.get('he') or [], 1):
            text = clean(' '.join(flat(node)))
            if not text:
                continue
            ref = '%s:%d' % (d['ref'], i)
            seifim.append({'n': i, 'ref': ref, 'url': seif_url(ref), 'chars': len(text),
                           'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]})
            lines += ['[%d] %s' % (i, text), '']
        with open(os.path.join(TEXT, key + '.txt'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines))
        total += len(seifim)
        manifest['principles'].append({'key': key, 'ref': d['ref'], 'heRef': d['heRef'],
                                       'license': d.get('heLicense'), 'version': d.get('heVersionTitle'),
                                       'raw_sha256': hashlib.sha256(raw).hexdigest(),
                                       'seif_count': len(seifim), 'seifim': seifim})
        print(key, len(seifim))
    manifest['seif_total'] = total
    with open(os.path.join(HERE, 'manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('TOTAL', total)


if __name__ == '__main__':
    main()
