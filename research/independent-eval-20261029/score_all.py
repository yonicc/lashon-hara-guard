"""Score extractor + router candidates on the independent sets.
Set B gold = two-labeler adjudicated (sealed/setB_gold_final.jsonl); router scored per head on consensus only.
Set A gold = generator-only labels (sealed/gold_generator.jsonl) - supplementary, single labeler."""
import collections, json, pathlib, sys
R = pathlib.Path(r'D:\lhg-independent-eval'); E = R / 'eval'
REPO = pathlib.Path(r'C:\Users\dev\lashon-hara-guard')
sys.path.insert(0, str(REPO / 'classifier' / 'router'))
import evaluate as RE  # noqa: E402  (one home for to_heads / LABELS)
L = lambda p: [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]
msgs = {r['id']: r for r in L(R / 'messages.jsonl') + L(R / 'setB' / 'messages.jsonl')}
V1 = [a for a, _, _ in json.loads((REPO / 'research/local-extractor/contract.json').read_text(encoding='utf-8'))['facts']]
V2 = [a for a, _, _ in json.loads((REPO / 'research/local-extractor/contract_v2.json').read_text(encoding='utf-8'))['facts']]
goldB = {r['id']: r for r in L(R / 'sealed' / 'setB_gold_final.jsonl')}
goldA = {r['id']: r for r in L(R / 'sealed' / 'gold_generator.jsonl')}

def decode(raw, text, keys):
    try:
        obj = json.loads(raw)
    except Exception:
        return {}, ['invalid_json']
    if not isinstance(obj, dict): return {}, ['not_object']
    acc, err = {}, []
    for k, v in obj.items():
        if k not in keys: err.append('unknown_key'); continue
        if not isinstance(v, list) or len(v) != 2 or type(v[0]) is not bool or not isinstance(v[1], str): err.append('invalid_pair'); continue
        if not v[1].strip() or v[1] not in text: err.append('evidence_not_verbatim'); continue
        acc[k] = v
    return acc, err

def extractor(model, keys, gold, scope):
    raw = {r['id']: r for r in L(E / f'{model}.raw.jsonl')}
    c = collections.Counter(); per = collections.defaultdict(collections.Counter); errs = collections.Counter()
    for i, g in gold.items():
        gf = {k: v[0] for k, v in g['facts_v2'].items() if k in scope}
        pred, e = decode(raw[i]['raw'], msgs[i]['text'], keys)
        pred = {k: v for k, v in pred.items() if k in scope}
        errs.update(e); c['format_error_rows'] += bool(e); c['hit_limit'] += bool(raw[i].get('hit_limit'))
        for k in set(gf) | set(pred):
            if k in gf and k in pred:
                t = 'tp' if pred[k][0] is gf[k] else 'wrong'
            elif k in pred: t = 'unsupported'
            else: t = 'missed'
            c[t] += 1; per[k][t] += 1
        if not gf:
            c['nofact_rows'] += 1; c['nofact_rows_with_pred'] += bool(pred)
    tp, fp, fn = c['tp'], c['wrong'] + c['unsupported'], c['wrong'] + c['missed']
    out = {'precision': round(tp / (tp + fp), 3) if tp + fp else None, 'recall': round(tp / (tp + fn), 3) if tp + fn else None,
           **dict(c), 'errors': dict(errs),
           'per_fact': {k: {'P': round(v['tp'] / (v['tp'] + v['wrong'] + v['unsupported']), 2) if v['tp'] + v['wrong'] + v['unsupported'] else None,
                            'R': round(v['tp'] / (v['tp'] + v['wrong'] + v['missed']), 2) if v['tp'] + v['wrong'] + v['missed'] else None}
                        for k, v in sorted(per.items())}}
    return out

def router(probs, runs, gold, consensus):
    out = {}
    s2 = json.loads((REPO / 'classifier/results/router/summary_r2.json').read_text(encoding='utf-8'))['candidates']
    s3 = json.loads((REPO / 'classifier/results/router/summary_r3-supervisor.json').read_text(encoding='utf-8'))['candidates']
    for run in runs:
        th = (s2.get(run) or s3.get(run))['thresholds']
        res = {}
        for j, h in enumerate(RE.LABELS):
            c = collections.Counter()
            for i, g in gold.items():
                if consensus:
                    y = g['router_consensus'][h]
                    if y is None: continue
                else:
                    r = g.get('router'); r = r.get('heads', []) if isinstance(r, dict) else ([r] if isinstance(r, str) else (r or []))
                    y = h in r
                p = RE.to_heads(probs[run]['probs'][i])[j] >= th[h]
                c[('tp' if y else 'fp') if p else ('fn' if y else 'tn')] += 1
            res[h] = {'P': round(c['tp'] / (c['tp'] + c['fp']), 3) if c['tp'] + c['fp'] else None,
                      'R': round(c['tp'] / (c['tp'] + c['fn']), 3) if c['tp'] + c['fn'] else None, **dict(c)}
        out[run] = res
    return out

report = {}
for name, gold in (('setB', goldB), ('setA_generator_only', goldA)):
    report[name] = {
        'current_8facts': extractor('current', V1, gold, V1),
        'e10v2_on_8facts': extractor('e10v2', V2, gold, V1),
        'e10v2_all_18': extractor('e10v2', V2, gold, V2)}
pp = E / 'router.probs.json'
if pp.exists():
    probs = json.loads(pp.read_text(encoding='utf-8'))
    runs = list(probs)
    report['router_setB_consensus'] = router(probs, runs, goldB, True)
    report['router_setA_generator_only'] = router(probs, runs, goldA, False)
(E / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
for k, v in report.items():
    print('==', k)
    for m, r in v.items():
        if 'precision' in r:
            print(f"  {m:18} P={r['precision']} R={r['recall']} tp={r.get('tp',0)} wrong={r.get('wrong',0)} unsup={r.get('unsupported',0)} missed={r.get('missed',0)} nofact_fp={r.get('nofact_rows_with_pred',0)}/{r.get('nofact_rows',0)} fmt={r.get('format_error_rows',0)} {r['errors']}")
        else:
            print(f"  {m:30} " + '  '.join(f"{h}: P={x['P']} R={x['R']}" for h, x in r.items()))
