"""Precision/recall of proposedFacts (docs/18 step 2) against a synthetic gold set.

Usage: py -I classifier/eval_facts.py <eval-endpoint-url> <access-key-file> <dataset.json> <out.json> <label>

The endpoint is a TEMPORARY eval worker run with `wrangler dev --remote` (see
docs/20-fact-extraction-eval.md): it runs the real engine runExtraction with the
production extractor + Worker secrets and returns validated proposedFacts. No
message text is written to the output besides the synthetic gold set's ids.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

URL, KEYFILE, DATASET, OUT, LABEL = sys.argv[1:6]
KEY = open(KEYFILE, encoding='utf-8').read().strip()
CONFIRMED_BY_USER_ONLY = {'speaker.is_minor', 'audience.is_close_to_speaker_or_subject'}


def scored(fid: str) -> bool:
    if fid in CONFIRMED_BY_USER_ONLY:
        return False
    return fid.startswith(('toelet.', 'speaker.', 'audience.')) or fid == 'message.purpose'


def call(text: str) -> dict:
    body = json.dumps({'text': text}).encode()
    for attempt in range(3):
        req = urllib.request.Request(URL, data=body, method='POST', headers={
            'content-type': 'application/json', 'x-eval': KEY, 'user-agent': 'lhg-eval'})
        try:
            return json.load(urllib.request.urlopen(req, timeout=120))
        except (urllib.error.URLError, TimeoutError) as e:  # transient only
            err = repr(e)
            time.sleep(2 + attempt * 3)
    return {'error': err}


def main() -> None:
    items = json.load(open(DATASET, encoding='utf-8'))['items']
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda it: call(it['text']), items))

    per_id = defaultdict(lambda: {'tp': 0, 'fp_unsupported': 0, 'wrong_value': 0, 'fn': 0})
    rows, latencies, sent_counts, dropped = [], [], set(), defaultdict(int)
    tp = fp = fn = wrong = errors = not_checked = 0
    for it, r in zip(items, results):
        if 'error' in r or r.get('status') != 'extracted':
            errors += 'error' in r
            not_checked += r.get('status') == 'not_checked'
            rows.append({'id': it['id'], 'status': r.get('status'), 'error': r.get('error') or r.get('errors')})
            for fid in it['expect']:
                if scored(fid):
                    fn += 1
                    per_id[fid]['fn'] += 1
            continue
        latencies.append(r['ms'])
        sent_counts.add(r.get('sentIdCount'))
        for d in r.get('droppedFacts', []):
            dropped[d.get('reason')] += 1
        proposed = {f['id']: f['value'] for f in r.get('proposedFacts', [])}
        expect, ok = it['expect'], set(it.get('ok', []))
        row = {'id': it['id'], 'ms': r['ms'], 'tp': [], 'unsupported': [], 'wrong': [], 'missed': []}
        for fid, val in proposed.items():
            if not scored(fid):
                continue
            if fid in expect:
                if expect[fid] == '*' or expect[fid] == val:
                    tp += 1; per_id[fid]['tp'] += 1; row['tp'].append(fid)
                else:
                    wrong += 1; per_id[fid]['wrong_value'] += 1; row['wrong'].append(f'{fid}={val}')
            elif fid not in ok:
                fp += 1; per_id[fid]['fp_unsupported'] += 1; row['unsupported'].append(f'{fid}={val}')
        for fid in expect:
            if scored(fid) and fid not in proposed:
                fn += 1; per_id[fid]['fn'] += 1; row['missed'].append(fid)
        rows.append(row)

    proposed_scored = tp + fp + wrong
    expected_total = tp + wrong + fn
    lat = sorted(latencies)
    summary = {
        'label': LABEL, 'items': len(items), 'errors': errors, 'not_checked': not_checked,
        'sentIdCounts': sorted(x for x in sent_counts if x is not None),
        'tp': tp, 'unsupported': fp, 'wrong_value': wrong, 'missed': fn,
        'precision': round(tp / proposed_scored, 3) if proposed_scored else None,
        'recall': round(tp / expected_total, 3) if expected_total else None,
        'latency_ms': {'median': lat[len(lat) // 2] if lat else None,
                       'p90': lat[int(len(lat) * 0.9)] if lat else None,
                       'mean': round(sum(lat) / len(lat)) if lat else None},
        'dropped_reasons': dict(dropped),
    }
    json.dump({'summary': summary, 'per_id': per_id, 'rows': rows},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
