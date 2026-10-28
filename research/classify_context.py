import json, re, collections
d=json.load(open('engine/src/chafetzChaim/sourceCoverage.json',encoding='utf-8'))
secs=d['sections']
C_KW=['קרוב','משפחה','נמען','שומע','קהל','תועלת','מטרה','פרסום','ידוע','היסטור','בעבר','יחס','בן זוג','הורים','אחים','מוניטין','חזקה','רגיל','הרגל','שונא','אוהב']
B_KW=['שיחה','הודעות קודמות','שרשור','הקשר','רמז','אופן האמירה','טון','צחוק','הקשר חברתי']
def cls(s):
    if s['disposition']=='blocked' or s.get('chatFeasibility')=='external_evidence': return 'D'
    if s.get('chatFeasibility')=='not_message_decision': return 'N'
    txt=(s.get('unimplementedHe') or '')+' '+(s.get('implementedScopeHe') or '')
    if any(k in txt for k in C_KW): return 'C'
    if any(k in txt for k in B_KW): return 'B'
    return 'A'
rows=[]
for s in secs:
    rows.append({'key':s['key'],'cat':cls(s),'disp':s['disposition'],'feas':s.get('chatFeasibility'),'blocker':(s.get('blocker') or {}).get('category')})
print('TOTAL', collections.Counter(r['cat'] for r in rows))
per=collections.OrderedDict()
for r in rows:
    rule=r['key'].split(':')[0]
    per.setdefault(rule, collections.Counter())[r['cat']]+=1
for k,v in per.items(): print(k, dict(v), 'n=', sum(v.values()))
json.dump(rows, open('C:/Users/dev/lhg-worktrees/rnd-ctx/research/context-map.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
print('D keys:', ','.join(r['key'] for r in rows if r['cat']=='D')[:1500])
