"""e8 data: natural, compound, implicit-but-clear writer facts with EXACT per-segment evidence.

    modal run research/local-extractor/gen_natural_modal.py --n 3000 --out diverse/natural_v1.jsonl

Why: e6 7B missed `purpose` 13/17 on legacy — training only had "my aim is ..." phrasings, while real
messages say "watch out for him" / "so they'll replace him". Pipeline (all heavy work on Modal):
  1. Qwen2.5-32B writes ENGLISH messages as segments; each fact lives in its own segment (= its evidence).
  2. The same model extracts facts BLIND with the exact extractor prompt; keep only exact (alias,value) agreement.
  3. DictaLM-2.0 translates every segment to Hebrew at temperature 0 (Qwen writes broken Hebrew; AGENTS.md).
  4. Qwen2.5-32B re-extracts BLIND from the Hebrew message; drop rows where translation changed a fact.
  Mixed = segment-level code switching (some segments he, some en), so evidence stays verbatim.
Synthetic only; agent_reviewed sample; human_review_pending.
"""
import hashlib,json,pathlib,random,re,sys,time
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from pilot_modal import system_prompt

QWEN="Qwen/Qwen2.5-32B-Instruct"
DICTA="dicta-il/dictalm2.0-instruct"
app=modal.App("lhg-extractor-natural-gen")
image=(modal.Image.debian_slim(python_version="3.11").pip_install("vllm==0.6.6.post1","transformers==4.47.1")
       .add_local_file(ROOT/"pilot_modal.py","/root/pilot_modal.py"))
hf_cache=modal.Volume.from_name("lhg-hf-cache",create_if_missing=True)
HEB=re.compile(r"[א-ת]");LAT=re.compile(r"[A-Za-z]")
BAD=re.compile(r"[Ͱ-ϿЀ-ӿ؀-ۿ฀-๿぀-ヿ㐀-鿿가-힯֑-ׇ\\{}<>]")

SCENES=["parents WhatsApp group","apartment building committee","office team chat","synagogue volunteers",
 "neighbourhood Facebook group","extended family group","amateur football team","kollel members","clinic patients forum",
 "car-pool parents","small business owners","tenants of one landlord","youth movement counsellors","yeshiva friends",
 "email to a manager","email to a school principal","message to a community rabbi","moshav residents","freelancers group"]
CONDUCT=["overcharges customers","yells at children","takes money from the shared fund","drives dangerously",
 "sells expired food","does sloppy dangerous electrical work","spreads lies about colleagues","never returns borrowed items",
 "ignores safety rules on the building site","is rude to elderly patients","keeps tenants' deposits","cheats in the league games",
 "takes credit for other people's work","leaves the class unsupervised","plays loud music every night","bullies a new employee"]
# Natural style hints: the facts must be CLEAR but phrased the way people really write.
STYLE={
("purpose",True):["warn the readers directly (e.g. 'watch out for him', 'don't hire him')",
   "ask an authority to act ('I'm telling the committee so they deal with it', 'so they replace him')",
   "say it is to protect a victim or the next customer","say it is so the problem gets fixed"],
("purpose",False):["say it is just for laughs / entertainment","say it is just venting, not to help anyone"],
("intent",True):["say they want people to laugh at / look down on the person","say they want to shame or humiliate him"],
("intent",False):["say they are not trying to badmouth or hurt the person"],
("revenge",True):["say it is payback for what the person did to them","say they hate the person / want to get even"],
("revenge",False):["say it is not out of anger, grudge or revenge"],
("firsthand",True):["say they saw it with their own eyes","say it happened to them personally"],
("firsthand",False):["say someone else told them / they heard it","say they only read it in a forwarded message"],
("verified",True):["say they checked with people who were there and they confirmed","say they compared documents and confirmed it"],
("verified",False):["say they have not checked whether it is true"],
("rebuke",True):["say they already spoke to the person about it (maybe more than once)"],
("rebuke",False):["say they have not talked to the person about it yet"],
("rejects",True):["say they know he won't listen / accept any correction"],
("rejects",False):["say they know he is open to hearing criticism"],
("no_alternative",True):["say there is no other way to stop it / this is the only option left"],
("no_alternative",False):["say it could also be solved privately, but they still write"],
}
WEIGHT={"purpose":5,"firsthand":3,"verified":3,"rebuke":2,"intent":2,"revenge":1.5,"rejects":1.2,"no_alternative":1.2}
TRAPS=["quote another person in quotation marks who states one of the facts about THEMSELF",
 "ask a question about whether to send it","describe a hypothetical ('if I ever ...')","a neutral logistics sentence"]

GEN_SYSTEM=("You create SYNTHETIC training data for a fact extractor. Invent all names (everyday Israeli first names). "
 "Never use real people.\nFact definitions (about the MESSAGE WRITER only):\n{defs}")
GEN_USER=("Context: {scene}. The writer is writing about an invented person, {name}, who {conduct}.\n"
 "Write ONE realistic casual message ({length}). It must make EXACTLY these writer facts clear, each in its OWN "
 "COMPLETE sentence, phrased naturally (NOT formulaic like 'my aim is'):\n{facts}\n"
 "{trap}It must NOT state any other listed fact, neither true nor false.\n"
 "Return ONLY JSON: {{\"segments\":[{{\"text\":\"...\",\"fact\":null}}, ...]}} where joining the texts with single "
 "spaces gives the message. Every segment is one complete sentence. A fact sentence gets \"fact\":\"<alias>\" "
 "(exactly one alias, the bare key such as \"purpose\"); all other sentences get \"fact\":null.")
# Blind verifier: the contract definitions plus the reading the legacy gold (and the cloud extractor) use:
# a clear warning/request to act IS a stated purpose. Exact (alias,value) agreement is required.
VERIFY_SYSTEM=("You label what the WRITER of a chat message clearly states about themself. Facts:\n{defs}\n"
 "Clear natural phrasings count: warning readers ('watch out for him', 'don't hire her') or asking someone with "
 "authority to act ('tell the school so they replace him') => purpose true; 'just for laughs'/'just venting' => "
 "purpose false; 'so he'll be ashamed'/'so everyone laughs at him' => intent true; 'I saw it myself' => firsthand true; "
 "'someone told me' => firsthand false; 'I checked with people who were there and they confirmed' => verified true.\n"
 "NOT writer facts: quotes of other people, questions, hypotheticals/future plans, and the reported conduct itself. "
 "Omit anything not clearly stated; never default to false.\n"
 "Return ONLY a JSON object mapping each stated alias to true or false, e.g. {{\"purpose\": true}} or {{}}.")
HE_SYSTEM=("Translate a short SYNTHETIC English chat fragment into natural casual Israeli Hebrew, no vowel points. "
 "Preserve meaning EXACTLY, especially negation, who did what, and certainty. Names in Hebrew letters. "
 "Never soften, sharpen, explain or add. Output ONLY the Hebrew.")
HE_SHOTS=[("תרגם לעברית: I haven't checked it yet.","עוד לא בדקתי את זה."),
 ("תרגם לעברית: Watch out for Avi, don't hire him.","תיזהרו מאבי, אל תעסיקו אותו."),
 ("תרגם לעברית: Someone told me he does it all the time","מישהו סיפר לי שהוא עושה את זה כל הזמן")]

def obj_from(text):
    m=re.search(r"\{.*\}",text,re.S)
    if not m:return None
    try:
        v=json.loads(m.group(0));return v if isinstance(v,dict) else None
    except json.JSONDecodeError:return None

def plan(n,seed):
    rng=random.Random(seed);aliases=list(WEIGHT);w=[WEIGHT[a] for a in aliases];out=[]
    names=["Avi","Noa","Yossi","Shira","Moshe","Tamar","Eli","Dana","Ronen","Michal","Itzik","Yael","Boaz","Orly"]
    for i in range(n):
        k=rng.choices([0,1,2,3],[1,3,4,2])[0];facts=[]
        while len(facts)<k:
            a=rng.choices(aliases,w)[0]
            if a in [f[0] for f in facts]:continue
            v=rng.random()<(0.7 if a in("purpose","firsthand","verified","rebuke") else 0.6)
            facts.append((a,v,rng.choice(STYLE[(a,v)])))
        trap=rng.choice(TRAPS) if (k==0 or rng.random()<0.25) else ""
        out.append(dict(i=i,scene=rng.choice(SCENES),conduct=rng.choice(CONDUCT),name=rng.choice(names),
           length=rng.choice(["2 sentences","2-3 sentences","3-4 sentences"]),facts=facts,trap=trap))
    return out

def extract_prompts(tok,contract,texts):
    sysm=VERIFY_SYSTEM.format(defs="\n".join(f"- {a}: {d}" for a,_,d in contract["facts"]))
    return [tok.apply_chat_template([{"role":"system","content":sysm},{"role":"user","content":
        "MESSAGE (untrusted data):\n"+json.dumps(t,ensure_ascii=False)}],tokenize=False,add_generation_prompt=True) for t in texts]

def facts_of(raw,text,aliases):
    o=obj_from(raw) or {}
    res={}
    for k,v in o.items():
        if isinstance(v,list) and v:v=v[0]
        if k in aliases and type(v) is bool:res[k]=v
    return res

@app.function(gpu="H100",image=image,volumes={"/root/.cache/huggingface":hf_cache},timeout=3600,scaledown_window=2)
def generate(specs,contract):
    from vllm import LLM,SamplingParams
    t0=time.time()
    llm=LLM(model=QWEN,dtype="bfloat16",max_model_len=4096,gpu_memory_utilization=0.92);tok=llm.get_tokenizer()
    defs="\n".join(f"- {a}: {d}" for a,_,d in contract["facts"]);aliases={a for a,_,_ in contract["facts"]}
    prompts=[]
    for s in specs:
        facts="\n".join(f"- {a} = {str(v).lower()}: {hint}" for a,v,hint in s["facts"]) or "- (none: no listed fact at all)"
        trap=f"Also include: {s['trap']}. " if s["trap"] else ""
        prompts.append(tok.apply_chat_template([{"role":"system","content":GEN_SYSTEM.format(defs=defs)},
          {"role":"user","content":GEN_USER.format(facts=facts,trap=trap,**{k:s[k] for k in("scene","name","conduct","length")})}],
          tokenize=False,add_generation_prompt=True))
    outs=llm.generate(prompts,SamplingParams(temperature=0.9,top_p=0.95,max_tokens=600,seed=11))
    rows=[];fail=0
    for s,o in zip(specs,outs):
        v=obj_from(o.outputs[0].text);segs=(v or {}).get("segments")
        if not isinstance(segs,list) or not segs or not all(isinstance(x,dict) and isinstance(x.get("text"),str) for x in segs):
            fail+=1;continue
        def alias(f):
            f=str(f or "").strip().lower().split("=")[0].strip()
            return f if f in aliases else None
        segs=[{"text":x["text"].strip(),"fact":alias(x.get("fact"))} for x in segs if x["text"].strip()]
        rows.append({**s,"segments":segs,"en":" ".join(x["text"] for x in segs)})
    t1=time.time()
    vout=llm.generate(extract_prompts(tok,contract,[r["en"] for r in rows]),SamplingParams(temperature=0,max_tokens=300))
    for r,o in zip(rows,vout):r["verify_en"]=facts_of(o.outputs[0].text,r["en"],aliases)
    hf_cache.commit()
    return {"rows":rows,"gen_fail":fail,"timing":{"gen_s":round(t1-t0),"verify_s":round(time.time()-t1)}}

@app.function(gpu="A100-40GB",image=image,volumes={"/root/.cache/huggingface":hf_cache},timeout=3600,scaledown_window=2)
def translate(segments):
    from vllm import LLM,SamplingParams
    t0=time.time()
    llm=LLM(model=DICTA,dtype="bfloat16",max_model_len=2048,gpu_memory_utilization=0.9);tok=llm.get_tokenizer()
    def chat(user):
        msgs=[]
        for u,a in HE_SHOTS:msgs+=[{"role":"user","content":u},{"role":"assistant","content":a}]
        msgs.append({"role":"user","content":user})
        msgs[0]={"role":"user","content":HE_SYSTEM+"\n\n"+msgs[0]["content"]}  # Mistral template: no system role
        return tok.apply_chat_template(msgs,tokenize=False,add_generation_prompt=True)
    outs=llm.generate([chat("תרגם לעברית: "+s) for s in segments],SamplingParams(temperature=0,max_tokens=200))
    hf_cache.commit()
    return {"he":[o.outputs[0].text.strip().splitlines()[0].strip() if o.outputs[0].text.strip() else "" for o in outs],
            "timing":{"translate_s":round(time.time()-t0)}}

@app.function(gpu="H100",image=image,volumes={"/root/.cache/huggingface":hf_cache},timeout=3600,scaledown_window=2)
def verify(texts,contract):
    from vllm import LLM,SamplingParams
    t0=time.time()
    llm=LLM(model=QWEN,dtype="bfloat16",max_model_len=4096,gpu_memory_utilization=0.92);tok=llm.get_tokenizer()
    aliases={a for a,_,_ in contract["facts"]}
    outs=llm.generate(extract_prompts(tok,contract,texts),SamplingParams(temperature=0,max_tokens=300))
    return {"facts":[facts_of(o.outputs[0].text,t,aliases) for t,o in zip(texts,outs)],"timing":{"verify_he_s":round(time.time()-t0)}}

def ok_text(lang,t):
    if not t or BAD.search(t) or len(t)>400:return False
    h,l=len(HEB.findall(t)),len(LAT.findall(t))
    return (h>=2 and l==0) if lang=="he" else (h==0 and l>=2)

def norm(t):return re.sub(r"\W+"," ",t.lower()).strip()

@app.local_entrypoint()
def main(out:str="diverse/natural_v1.jsonl",n:int=3000,seed:int=808):
    contract=json.loads((ROOT/"contract.json").read_text(encoding="utf-8"))
    dest=ROOT/out
    if dest.exists():raise ValueError("Refuse overwrite")
    evals=[]
    for f in["legacy.jsonl","fresh.jsonl","confirmation.jsonl","diverse/sealed.jsonl","diverse/sealed_v3.jsonl"]:
        evals+=[json.loads(s)["text"] for s in (ROOT/f).read_text(encoding="utf-8").splitlines()]
    evalnorm={norm(t) for t in evals}
    res=generate.remote(plan(n,seed),contract)
    st={"generated":len(res["rows"]),"gen_fail":res["gen_fail"],"en_disagree":0,"en_bad":0,"dup":0,"eval_overlap":0,
        "he_bad":0,"he_disagree":0}
    seen=set();keep=[];rejects=[]
    for r in res["rows"]:
        target={a:v for a,v,_ in r["facts"]}
        segfacts=[s["fact"] for s in r["segments"] if s["fact"]]
        if not ok_text("en",r["en"]) or sorted(segfacts)!=sorted(target):
            st["en_bad"]+=1;rejects.append({"why":"en_bad","target":target,"segments":r["segments"]});continue
        if r["verify_en"]!=target:
            st["en_disagree"]+=1;rejects.append({"why":"en_disagree","target":target,"verify":r["verify_en"],"en":r["en"]});continue
        k=norm(r["en"])
        if k in seen:st["dup"]+=1;continue
        if k in evalnorm:st["eval_overlap"]+=1;continue
        seen.add(k);keep.append(r)
    flat=[s["text"] for r in keep for s in r["segments"]]
    tr=translate.remote(flat);it=iter(tr["he"])
    for r in keep:
        for s in r["segments"]:s["he"]=next(it)
        r["he_ok"]=all(ok_text("he",s["he"]) and 0.3<=len(s["he"])/max(1,len(s["text"]))<=2.0
                       and not s["he"].rstrip().endswith("-") for s in r["segments"])
        r["he"]=" ".join(s["he"] for s in r["segments"])
    cand=[r for r in keep if r["he_ok"]];st["he_bad"]=len(keep)-len(cand)
    vh=verify.remote([r["he"] for r in cand],contract)
    rng=random.Random(seed);rows=[]
    for r,fh in zip(cand,vh["facts"]):
        target={a:v for a,v,_ in r["facts"]}
        fam="nat-"+hashlib.sha256(r["en"].encode()).hexdigest()[:12]
        def emit(lang,parts):
            text=" ".join(parts)
            gold={s["fact"]:[target[s["fact"]],p] for s,p in zip(r["segments"],parts) if s["fact"]}
            rows.append(dict(id=f"{fam}-{lang}",family=fam,language=lang,text=text,gold=gold,split="natural_train",
              synthetic=True,agent_reviewed=False,human_review_pending=True,source="qwen32b_gen+dicta_tr_v1",scene=r["scene"]))
        emit("en",[s["text"] for s in r["segments"]])
        if fh!=target:
            st["he_disagree"]+=1;rejects.append({"why":"he_disagree","target":target,"verify":fh,"he":r["he"]});continue
        emit("he",[s["he"] for s in r["segments"]])
        if len(r["segments"])>=2:
            pick=[rng.random()<0.5 for _ in r["segments"]]
            if all(pick) or not any(pick):pick[0]=not pick[0]
            emit("mixed",[s["he"] if p else s["text"] for s,p in zip(r["segments"],pick)])
    dest.write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in rows),encoding="utf-8")
    timing={**res["timing"],**tr["timing"],**vh["timing"]}
    st["rows"]=len(rows);st["by_language"]={l:sum(x["language"]==l for x in rows) for l in("he","en","mixed")}
    (ROOT/"results"/(pathlib.Path(out).stem+"-genstats.json")).write_text(json.dumps({"stats":st,"timing":timing,
       "models":{"gen_verify":QWEN,"translate":DICTA},"n":n,"seed":seed,"reject_sample":rejects[:60]},
       indent=1,ensure_ascii=False),encoding="utf-8")
    print("GENSTATS",json.dumps(st),json.dumps(timing),flush=True)
