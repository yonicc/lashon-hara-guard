"""Consolidate proposedNewFacts from Chafetz Chaim cards into a small vocabulary.

Run from this directory:  python -I consolidate_facts.py
facts.json is canonical for questions and safety metadata. Generate the marked
FACT_CATALOG region and validate/extend fact-merge-map.json. Never modify cards.
Use --check in verification: fails on drift without writing anything.
"""
import argparse, json, pathlib

HERE = pathlib.Path(__file__).parent
REPO = HERE.parent.parent
CATALOG = REPO / 'engine/src/lessonScenario.ts'
FIELDS = ('id', 'questionHe', 'priority', 'sensitivity', 'persistent', 'confirmedByUserOnly')

def catalog_text(facts):
    text = CATALOG.read_text(encoding='utf-8')
    begin = '  // BEGIN GENERATED CHAFETZ CHAIM FACTS (consolidate_facts.py; edit facts.json).'
    finish = '  // END GENERATED CHAFETZ CHAIM FACTS'
    assert text.count(begin) == text.count(finish) == 1, 'missing/duplicate generation markers'
    start = text.index(begin) + len(begin)
    end = text.index(finish, start)
    rows = ['  ' + json.dumps({k: f[k] for k in FIELDS if k in f}, ensure_ascii=False) + ',' for f in facts]
    block = '\n' + '\n'.join(rows) + '\n'
    return text[:start] + block + text[end:]



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='validate without writing')
    args = parser.parse_args()
    facts_path = HERE / "facts.json"
    data = json.loads(facts_path.read_text(encoding="utf-8"))
    facts = data["facts"]
    ids = [f["id"] for f in facts]
    assert len(ids) == len(set(ids)), "duplicate vocabulary ids"
    for f in facts:
        assert all(k in f for k in FIELDS[:5]), f
        assert f["sensitivity"] in ("low", "medium", "high"), f
    have = set(ids)
    merge_path = HERE / "fact-merge-map.json"
    # Fail closed on malformed maps instead of silently discarding reviewed decisions.
    merge_map = json.loads(merge_path.read_text(encoding="utf-8"))
    for cf in sorted((HERE / "cards").glob("*.json")):
        for card in json.loads(cf.read_text(encoding="utf-8")):
            for proposal in card.get("proposedNewFacts") or []:
                pid = proposal["id"] if isinstance(proposal, dict) else proposal
                if pid not in merge_map:
                    merge_map[pid] = {"action": "reject", "reason": "הצעה חדשה דורשת קריאת מקור ואיחוד ידני; אין למזג לפי דמיון במזהה"}
    for pid, decision in merge_map.items():
        assert decision["action"] in ("new", "merge", "reject"), (pid, decision)
        if decision["action"] in ("new", "merge"):
            assert decision.get("target") in have, (pid, decision)
    expected = {
        merge_path: json.dumps(merge_map, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        CATALOG: catalog_text(facts),
    }
    drift = [str(path.relative_to(REPO)) for path, text in expected.items() if path.read_text(encoding="utf-8") != text]
    if args.check:
        assert not drift, "Regenerate with consolidate_facts.py: " + ", ".join(drift)
    else:
        for path, text in expected.items():
            if path.read_text(encoding="utf-8") != text:
                path.write_text(text, encoding="utf-8")
    print(f"facts={len(facts)} map={len(merge_map)} drift={len(drift)}; cards untouched")

if __name__ == "__main__":
    main()
