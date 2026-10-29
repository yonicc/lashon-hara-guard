import collections, hashlib, json, pathlib, sys
R = pathlib.Path(r'D:\lhg-independent-eval')
B = R / 'blind_supervisor'
mine_path = B / 'setB_supervisor_blind.jsonl'
parts = sorted(B.glob('setB_part*.jsonl'))
lines = []
for p in parts:
    lines += [l for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]
mine_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('frozen', mine_path.name, hashlib.sha256(mine_path.read_bytes()).hexdigest(), len(lines))
msgs = {j['id']: j for j in map(json.loads, (R / 'setB' / 'messages.jsonl').read_text(encoding='utf-8').splitlines()) if j}
mine = {j['id']: j for j in map(json.loads, lines)}
assert set(mine) == set(msgs), (len(mine), len(msgs))
bad = [(i, a) for i, j in mine.items() for a, (v, q) in j['facts_v2'].items() if q not in msgs[i]['text']]
print('my non-verbatim evidence:', bad)
gold = [json.loads(l) for l in (R / 'sealed' / 'setB_gold_generator.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
gold = {j['id']: j for j in gold}
def heads(x):
    r = x.get('router')
    if isinstance(r, str): r = [] if r == 'none' else [r]
    return set(h for h in (r or []) if h != 'none')
fact = collections.Counter(); per = collections.defaultdict(collections.Counter); dis = []
for i in sorted(msgs):
    m, g = mine[i]['facts_v2'], gold[i].get('facts_v2', {})
    for a in set(m) | set(g):
        if a in m and a in g:
            k = 'agree' if m[a][0] == g[a][0] else 'value_conflict'
        elif a in m: k = 'mine_only'
        else: k = 'gold_only'
        fact[k] += 1; per[a][k] += 1
        if k != 'agree':
            dis.append({'id': i, 'kind': 'fact', 'alias': a, 'type': k, 'mine': m.get(a), 'gold': g.get(a), 'text': msgs[i]['text']})
rt = collections.Counter(); exact = 0
for i in msgs:
    hm, hg = heads(mine[i]), heads(gold[i])
    exact += hm == hg
    for h in ('mem_recent', 'mem_search', 'ask_user'):
        rt[(h, h in hm, h in hg)] += 1
    if hm != hg:
        dis.append({'id': i, 'kind': 'router', 'mine': sorted(hm), 'gold': sorted(hg), 'text': msgs[i]['text']})
print('facts', dict(fact))
tot = sum(fact.values()); print('fact agreement %.3f' % (fact['agree'] / tot))
for a in sorted(per): print(' ', a, dict(per[a]))
print('router exact set match', exact, '/', len(msgs))
for h in ('mem_recent', 'mem_search', 'ask_user'):
    both = rt[(h, True, True)]; mo = rt[(h, True, False)]; go = rt[(h, False, True)]
    print(' ', h, 'both', both, 'mine_only', mo, 'gold_only', go)
(B / 'setB_disagreements.jsonl').write_text('\n'.join(json.dumps(d, ensure_ascii=False) for d in dis) + '\n', encoding='utf-8')
print('disagreements', len(dis), 'facts', sum(d['kind'] == 'fact' for d in dis))
