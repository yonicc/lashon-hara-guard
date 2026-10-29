"""Final Set B gold = adjudicated union of two independent labelers.
Facts: agreed facts kept; disagreements resolved per ADJ below.
Router: per-head consensus only; a head the labelers disagree on is marked null (excluded from router scoring)."""
import hashlib, json, pathlib
R = pathlib.Path(r'D:\lhg-independent-eval')
B = R / 'blind_supervisor'
load = lambda p: {j['id']: j for j in (json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip())}
msgs, mine, gold = load(R / 'setB' / 'messages.jsonl'), load(B / 'setB_supervisor_blind.jsonl'), load(R / 'sealed' / 'setB_gold_generator.jsonl')
# (id, alias) -> 'mine' | 'gold' | 'omit'
ADJ = {('lhg-indB-0015', 'purpose'): 'mine', ('lhg-indB-0062', 'purpose'): 'mine',
       ('lhg-indB-0066', 'purpose'): 'mine', ('lhg-indB-0149', 'purpose'): 'mine',
       ('lhg-indB-0091', 'rejects'): 'gold', ('lhg-indB-0273', 'firsthand'): 'gold',
       ('lhg-indB-0162', 'medium_written'): 'omit'}
def heads(x):
    r = x.get('router')
    if isinstance(r, str): r = [] if r == 'none' else [r]
    return set(h for h in (r or []) if h != 'none')
v1 = ['purpose', 'intent', 'revenge', 'firsthand', 'verified', 'rebuke', 'rejects', 'no_alternative']
out = []
for i in sorted(msgs):
    m, g = mine[i]['facts_v2'], gold[i].get('facts_v2', {})
    facts = {}
    for a in sorted(set(m) | set(g)):
        if a in m and a in g and m[a][0] == g[a][0]:
            facts[a] = g[a]
        else:
            pick = ADJ[(i, a)]
            if pick != 'omit': facts[a] = (m if pick == 'mine' else g)[a]
    for a, (v, q) in facts.items(): assert q in msgs[i]['text'], (i, a)
    hm, hg = heads(mine[i]), heads(gold[i])
    router = {h: (h in hm) if (h in hm) == (h in hg) else None for h in ('mem_recent', 'mem_search', 'ask_user')}
    out.append({'id': i, 'facts_v2': facts, 'facts_v1': {a: facts[a] for a in v1 if a in facts}, 'router_consensus': router})
p = R / 'sealed' / 'setB_gold_final.jsonl'
p.write_text('\n'.join(json.dumps(o, ensure_ascii=False) for o in out) + '\n', encoding='utf-8')
print(p, len(out), hashlib.sha256(p.read_bytes()).hexdigest())
for h in ('mem_recent', 'mem_search', 'ask_user'):
    vals = [o['router_consensus'][h] for o in out]
    print(h, 'pos', vals.count(True), 'neg', vals.count(False), 'excluded', vals.count(None))
