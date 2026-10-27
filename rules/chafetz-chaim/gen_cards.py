# -*- coding: utf-8 -*-
"""Draft one rule card per Chafetz Chaim se'if with Muse Spark Open (Baseten) via the Brain.

Reads sources/chafetz-chaim/manifest.json + text/, writes cards/<key>.json (resumable: a se'if
whose card already exists with the same text sha256 is skipped). Every card is reviewStatus=draft.
The model only drafts: quotes are kept only if they occur verbatim in the se'if (niqqud-insensitive),
fact ids only if they exist in facts.json; everything else is flagged for human review.

Env:  LHG_BRAIN_BASE_URL (default https://br.ysho.uk/dash)
      LHG_BRAIN_TOKEN_FILE  path to a file holding a brk_ token with chat:send (never commit it)
      LHG_CARD_AGENT / LHG_CARD_MODEL / LHG_CARD_ACCOUNT (default baseten / muse-spark-open-1026 / yoni)
Usage: python -I rules/chafetz-chaim/gen_cards.py [--only p1_prin1:1,p2_prin9:3] [--workers 6]"""
import argparse, concurrent.futures as cf, datetime, json, os, re, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, 'sources', 'chafetz-chaim')
CARDS = os.path.join(HERE, 'cards')
BASE = os.environ.get('LHG_BRAIN_BASE_URL', 'https://br.ysho.uk/dash').rstrip('/')
AGENT = os.environ.get('LHG_CARD_AGENT', 'baseten')
MODEL = os.environ.get('LHG_CARD_MODEL', 'meta-models/muse-spark-open-1026')
ACCOUNT = os.environ.get('LHG_CARD_ACCOUNT', 'yoni')
KINDS = ['prohibition', 'aggravation', 'definition', 'condition', 'exception', 'listener_duty',
         'repair', 'motivation', 'other']
NIQQUD = re.compile('[֑-ׇ]')


def norm(s):
    """Niqqud/cantillation-free, punctuation-light, single-spaced - for quote matching only."""
    s = NIQQUD.sub('', s).replace('־', ' ')
    s = re.sub(r'[\"\'׳״()\[\],.:;!?\-]', ' ', s)
    return ' '.join(s.split())


def load_texts():
    out = {}
    for name in os.listdir(os.path.join(SRC, 'text')):
        key = name[:-4]
        for line in open(os.path.join(SRC, 'text', name), encoding='utf-8'):
            m = re.match(r'\[(\d+)\] (.*)', line)
            if m:
                out[(key, int(m.group(1)))] = m.group(2).strip()
    return out


SYSTEM = """You are drafting a structured study card for ONE se'if of Sefer Chafetz Chaim, for an app that \
warns chat users about messages that may be Lashon Hara or Rechilut. You are NOT a posek: you summarise \
what the se'if itself says, you do not rule on any case, and you never add content that is not in the se'if.
Return ONLY one JSON object, no prose, no code fence, with exactly these keys:
{"kind": one of %(kinds)s,
 "titleHe": "<=8 Hebrew words naming the topic of this se'if",
 "summaryHe": "1-2 Hebrew sentences: what this se'if says, attributed to the source (e.g. 'לפי הסעיף ...')",
 "quotesHe": ["1-3 short excerpts copied EXACTLY, word for word, from the se'if text below (<=25 words each)"],
 "appliesTo": "speaker" | "listener" | "both" | "general",
 "conditionsHe": ["conditions the se'if states for its law to apply"],
 "exceptionsHe": ["cases the se'if itself excludes or treats differently"],
 "factsNeeded": ["ids from the FACT LIST below that a chat app would need to know to apply this se'if"],
 "proposedNewFacts": [{"id": "dotted.snake_id", "questionHe": "..."}],
 "relevanceToChat": "high" | "medium" | "low",
 "uncertainHe": ["points where the se'if is ambiguous or depends on the Be'er Mayim Chaim / other sources"]}
Rules: use empty arrays when nothing applies; never invent a fact id - put new ones in proposedNewFacts; \
quotes must be verbatim from the se'if (niqqud may be omitted); write Hebrew."""


def prompt_for(heref, n, text, facts):
    flist = '\n'.join('- %s: %s' % (f['id'], f['questionHe']) for f in facts)
    return 'SOURCE: %s, סעיף %d\n\nSE\'IF TEXT:\n%s\n\nFACT LIST:\n%s' % (heref, n, NIQQUD.sub('', text), flist)


def call(token, system, user, timeout=180):
    body = {'agent_kind': AGENT, 'account': ACCOUNT, 'model': MODEL, 'stream': False,
            'system_prompt': system, 'messages': [{'role': 'system', 'content': system},
                                                 {'role': 'user', 'content': user}]}
    req = urllib.request.Request(BASE + '/api/v1/chat/completions', data=json.dumps(body).encode(),
                                 method='POST', headers={'Authorization': 'Bearer ' + token,
                                                         'Content-Type': 'application/json',
                                                         'User-Agent': 'lhg-cards/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    if 'reply' in d:
        return d['reply']
    return d['choices'][0]['message']['content']


def parse(reply):
    s = reply.strip()
    s = re.sub(r'^```(?:json)?\s*|\s*```$', '', s)
    i, j = s.find('{'), s.rfind('}')
    return json.loads(s[i:j + 1])


def as_list(v):
    return [x for x in v if isinstance(x, str) and x.strip()] if isinstance(v, list) else []


def build_card(seif, raw, text, fact_ids):
    issues = []
    kind = raw.get('kind') if raw.get('kind') in KINDS else 'other'
    if kind != raw.get('kind'):
        issues.append('kind_invalid:%s' % raw.get('kind'))
    ntext = norm(text)
    quotes = []
    for q in as_list(raw.get('quotesHe')):
        if norm(q) and norm(q) in ntext:
            quotes.append(q.strip())
        else:
            issues.append('quote_not_verbatim')
    facts = [f for f in as_list(raw.get('factsNeeded')) if f in fact_ids]
    proposed = [p for p in raw.get('proposedNewFacts') or [] if isinstance(p, dict) and p.get('id')]
    for f in as_list(raw.get('factsNeeded')):
        if f not in fact_ids:
            issues.append('unknown_fact:%s' % f)
            proposed.append({'id': f, 'questionHe': ''})
    if not quotes:
        issues.append('no_verified_quote')
    applies = raw.get('appliesTo') if raw.get('appliesTo') in ('speaker', 'listener', 'both', 'general') else 'general'
    rel = raw.get('relevanceToChat') if raw.get('relevanceToChat') in ('high', 'medium', 'low') else 'medium'
    return {'id': 'cc.%s.%d' % (seif['key'], seif['n']), 'ref': seif['ref'], 'url': seif['url'],
            'textSha256': seif['sha256'], 'kind': kind, 'titleHe': str(raw.get('titleHe', '')).strip(),
            'summaryHe': str(raw.get('summaryHe', '')).strip(), 'quotesHe': quotes, 'appliesTo': applies,
            'conditionsHe': as_list(raw.get('conditionsHe')), 'exceptionsHe': as_list(raw.get('exceptionsHe')),
            'factsNeeded': facts, 'proposedNewFacts': proposed, 'relevanceToChat': rel,
            'uncertainHe': as_list(raw.get('uncertainHe')), 'reviewIssues': issues,
            'reviewStatus': 'draft', 'draftedBy': '%s/%s' % (AGENT, MODEL),
            'draftedAt': datetime.date.today().isoformat()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    token = open(os.environ['LHG_BRAIN_TOKEN_FILE'], encoding='utf-8').read().strip()
    manifest = json.load(open(os.path.join(SRC, 'manifest.json'), encoding='utf-8'))
    vocab = json.load(open(os.path.join(HERE, 'facts.json'), encoding='utf-8'))['facts']
    fact_ids = {f['id'] for f in vocab}
    texts = load_texts()
    system = SYSTEM % {'kinds': KINDS}
    only = {tuple(x.split(':')) for x in a.only.split(',') if x}
    os.makedirs(CARDS, exist_ok=True)

    jobs = []
    for p in manifest['principles']:
        path = os.path.join(CARDS, p['key'] + '.json')
        existing = {c['id']: c for c in json.load(open(path, encoding='utf-8'))} if os.path.exists(path) else {}
        for s in p['seifim']:
            seif = dict(s, key=p['key'])
            cid = 'cc.%s.%d' % (p['key'], s['n'])
            if only and (p['key'], str(s['n'])) not in only:
                continue
            if cid in existing and existing[cid]['textSha256'] == s['sha256'] and not only:
                continue
            jobs.append((p, seif))
    print('jobs', len(jobs), flush=True)

    def work(job):
        p, seif = job
        text = texts[(p['key'], seif['n'])]
        last = None
        for attempt in range(3):
            t = time.time()
            try:
                reply = call(token, system, prompt_for(p['heRef'], seif['n'], text, vocab))
                return seif, build_card(seif, parse(reply), text, fact_ids), round(time.time() - t, 1), None
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as e:
                last = '%s: %s' % (type(e).__name__, str(e)[:200])
                time.sleep(3 * (attempt + 1))
        return seif, None, 0, last

    results = {}
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for seif, card, secs, err in ex.map(work, jobs):
            if card:
                results.setdefault(seif['key'], []).append(card)
                print('OK', card['id'], secs, 's', card['kind'], len(card['reviewIssues']), flush=True)
            else:
                print('FAIL', seif['key'], seif['n'], err, flush=True)

    order = lambda c: int(c['id'].rsplit('.', 1)[1])
    for key, cards in results.items():
        path = os.path.join(CARDS, key + '.json')
        merged = {c['id']: c for c in (json.load(open(path, encoding='utf-8')) if os.path.exists(path) else [])}
        merged.update({c['id']: c for c in cards})
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(sorted(merged.values(), key=order), f, ensure_ascii=False, indent=1)
            f.write('\n')
    print('DONE', sum(len(v) for v in results.values()), 'cards', flush=True)


if __name__ == '__main__':
    main()
