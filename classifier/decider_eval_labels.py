"""Freeze an agent-only, score-blind concern annotation of docs/47 Set B.
This adds a different target (linguistic concern) without changing fact/router gold.
Concern is negative information, ridicule or insinuation about identifiable people;
protective purpose does not make the linguistic concern false. Ambiguous means
the message refers to an omitted allegation without enough content to judge.
Reviewed all 300 messages before observing classifier scores, 2026-10-29.
No human review; only two clear negatives: precision is not population accuracy.
"""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
source=root/"research/independent-eval-20261029/setB/messages.jsonl"
negative={21:"Identity clarification only; no negative description.",105:"Supportive plan to speak; willingness to listen is not negative."}
ambiguous={
8:"Stress about brother without the missing grievance.",45:"Refers to a joke without its content.",
56:"Curiosity about a date without the missing information.",65:"Deposit issue without a stated grievance.",
103:"Forwards an unspecified former tenant account.",122:"Unspecified story about institution manager.",
154:"Commission disclosure and old refunds issue without a concrete negative claim.",
156:"Missing teacher reply; fear depends on absent context.",
203:"Unspecified bus driver story; explicitly no confirmation.",
234:"Unspecified comments to a child; counseling intervention without actual wording.",
236:"Explicitly declines to confirm an unspecified account about the sexton."
}
rows=[]
for line in source.read_text(encoding="utf-8").splitlines():
 r=json.loads(line);i=int(r["id"].rsplit("-",1)[1])
 rows.append({"id":r["id"],"gold":"no_concern" if i in negative else "ambiguous" if i in ambiguous else "concern",
 "why":negative.get(i,ambiguous.get(i,"Negative description, reported misconduct, ridicule or insinuation about an identifiable person; no ruling about permissibility.")),
 "review_status":"agent_only_human_review_pending"})
out=root/"classifier/data/decider_setB_concern_v1.jsonl"
assert not out.exists(),"Labels already frozen"
out.write_bytes(("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in rows)).encode("utf-8"))
print(json.dumps({"n":len(rows),"source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),"labels_sha256":hashlib.sha256(out.read_bytes()).hexdigest(),"counts":{k:sum(r["gold"]==k for r in rows) for k in ("concern","no_concern","ambiguous")}}))
