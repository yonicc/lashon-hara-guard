"""Generate the SYNTHETIC training/dev set for the local context router
(docs/34, docs/35) with an open LLM on a Modal GPU.

    py -m modal run classifier/router/gen_router_modal.py --out classifier/data/router_v1_synth.jsonl \
        --holdout classifier/data/router_holdout_v1.jsonl

One H100 container, one model load, four passes:
  1. generate ENGLISH messages conditioned on a target label set (labels.json) + scene + concern flag;
  2. verify: the same model labels every English message BLIND (no target shown);
  3. translate every English message to Hebrew (temperature 0), then write a Hebrew/English code-switched
     version from (Hebrew, English) for a subset. Translations keep the family -> same split;
  4. teacher: the blind verifier prompt is also run on the holdout texts, so docs/35 can report how far the
     label source agrees with the independent holdout. The holdout is never trained on.
Label = union(target, verifier) when they differ on at most one label, else the family is dropped
(recall-first: a missed context need is the costly error).

Verified 2026-10-28 (smoke run): Qwen2.5-32B writing Hebrew DIRECTLY at temperature 0.9 is unusable
(Cyrillic/CJK/Turkish fragments, self-commentary); English generation + temperature-0 translation is clean.
Reused from translate_modal.py: vllm 0.6.6.post1 needs transformers==4.47.1; bf16, not AWQ.
"""
import hashlib
import json
import pathlib
import random
import re
import time

import modal

MODEL = "Qwen/Qwen2.5-32B-Instruct"
app = modal.App("lhg-router-gen")
image = modal.Image.debian_slim(python_version="3.11").pip_install("vllm==0.6.6.post1", "transformers==4.47.1")
hf_cache = modal.Volume.from_name("lhg-hf-cache", create_if_missing=True)

HEB = re.compile(r"[א-ת]")
LAT = re.compile(r"[A-Za-z]")
BAD = re.compile(r"[Ͱ-ϿЀ-ӿ؀-ۿ฀-๿぀-ヿ㐀-鿿가-힯֑-ׇ\\{}<>]")

SCENES = [
    "office team chat", "parents of a kindergarten class", "extended family group", "apartment building committee",
    "yeshiva study partners", "synagogue volunteers", "two close friends", "university course group",
    "neighbourhood buy-and-sell group", "amateur football team", "hospital nurses shift group",
    "startup founders", "wedding planning friends", "reserve-duty unit friends", "book club", "car-pool parents",
    "high-school teachers room", "small shop employees", "community choir", "landlord and tenants",
    "email thread between colleagues", "siblings caring for a parent", "youth movement counsellors",
    "freelancers sharing clients", "a couple texting each other", "moshav residents", "kollel members",
    "army friends planning a reunion", "a cleaning-crew WhatsApp", "parents of a special-ed class",
]

GEN_SYSTEM = (
    "You create SYNTHETIC training data for a privacy-preserving assistant that, before a chat message is checked "
    "for lashon hara (speaking negatively about other people), decides which LOCAL CONTEXT must be collected first. "
    "Invent every name and event; use everyday Israeli first names (Avi, Noa, Yossi, Shira, Moshe, Tamar...). "
    "Never use real public figures.\n\nContext-need labels:\n{defs}\n\n"
    "Write {n} DIFFERENT short chat messages in casual English (1-2 sentences each, the way people really type) "
    "that a reader would need EXACTLY these context types to understand: {target}. {none_rule} {concern_rule} "
    "Vary length, wording, people and openings; do not repeat a template. Return ONLY a JSON array of {n} strings."
)
VERIFY_SYSTEM = (
    "You label chat messages for a privacy-preserving assistant. For each message decide which context types a careful "
    "reader would NEED, beyond the message itself, to judge whether it speaks negatively about someone and whether that "
    "is justified. Choose zero or more of:\n{defs}\n"
    "Use an empty list when the message is fully understandable on its own. Also say whether the message says something "
    "negative, mocking or damaging about an identifiable person (concern true/false).\n"
    "Return ONLY a JSON array, one object per message in order: {{\"i\": <number>, \"labels\": [..], \"concern\": true|false}}."
)
HE_SYSTEM = (
    "Translate a short SYNTHETIC English chat message into natural casual Israeli Hebrew chat style, without vowel "
    "points. Preserve the meaning EXACTLY, including every hint about earlier messages, who is in the chat, events, "
    "rumours and purpose. Write names in Hebrew letters (Avi -> אבי). Never soften, sharpen, explain or add. "
    "Keep emoji. Output ONLY the Hebrew message."
)
HE_SHOTS = [
    ("תרגם לעברית: Avi did it again, unbelievable", "אבי שוב עשה את זה, לא ייאמן"),
    ("תרגם לעברית: Anyone know where the spare keys are?", "מישהו יודע איפה המפתחות הרזרביים?"),
    ("תרגם לעברית: Just between us, don't forward this: Shira failed the exam again",
     "רק בינינו, אל תעבירי: שירה שוב נכשלה במבחן"),
]
MIX_SYSTEM = (
    "You write how a bilingual Israeli types in chat, switching between Hebrew and English inside one message. "
    "Given a Hebrew message and its English translation, write ONE code-switched version with the same meaning and "
    "the same hints: part of it in Hebrew letters, part in English words (names may be in either script). Use only "
    "Hebrew and Latin letters, no vowel points, no other languages. Never change, soften or add meaning. "
    "Output ONLY the mixed message."
)
MIX_SHOTS = [
    ("דנה שוב לא הגישה בזמן, כמו שאמרתי לכם אתמול", "Dana again didn't submit on time, like I told you yesterday",
     "Dana שוב לא הגישה on time, כמו שאמרתי לכם yesterday"),
    ("תודה ענקית לצוות לילה, אתם אלופים", "Huge thanks to the night shift, you're the best",
     "Huge thanks לצוות לילה, you're the best"),
    ("שמעתי שנועם לוקח כסף מהקופה, כולם כבר יודעים", "I heard Noam takes cash from the register, everyone knows",
     "שמעתי ש-Noam takes cash מהקופה, everyone already knows"),
]


def defs_text(labels):
    return "\n".join(f"- {l['id']}: {l['definition']}" for l in labels)


def json_array(text):
    m = re.search(r"\[.*?\]\s*$", text.strip(), re.S) or re.search(r"\[.*\]", text, re.S)
    if not m:
        return []
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, list) else []
    except json.JSONDecodeError:
        return []


def first_line(s):
    s = s.strip().strip('"').strip()
    return s.splitlines()[0].strip() if s else ""


def plan_prompts(label_ids, n, seed, focus=()):
    rnd = random.Random(seed)
    plan = []
    for _ in range(n):
        r = rnd.random()
        k = 0 if r < 0.2 else 1 if r < 0.68 else 2 if r < 0.93 else 3
        if focus:  # augmentation of rare labels: every prompt contains one focus label
            f = rnd.choice(list(focus))
            target = sorted({f} | set(rnd.sample([l for l in label_ids if l != f], max(0, min(k, 3) - 1))))
        else:
            target = sorted(rnd.sample(label_ids, k))
        concern = rnd.random() < (0.5 if k == 0 else 0.75)
        plan.append({"scene": rnd.choice(SCENES), "target": target, "concern": concern,
                     "seed": rnd.randrange(1 << 30)})
    return plan


@app.function(gpu="H100", image=image, volumes={"/root/.cache/huggingface": hf_cache}, timeout=3600,
              scaledown_window=2)
def generate(plan: list, labels: list, n_mix: int, holdout_texts: list, n_per: int = 6) -> dict:
    from vllm import LLM, SamplingParams

    t0 = time.time()
    llm = LLM(model=MODEL, dtype="bfloat16", max_model_len=4096, gpu_memory_utilization=0.92)
    tok = llm.get_tokenizer()
    timing = {"load_s": round(time.time() - t0)}
    ids = [l["id"] for l in labels]
    defs = defs_text(labels)

    def chat(system, user, shots=()):
        msgs = [{"role": "system", "content": system}]
        for u, a in shots:
            msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
        msgs.append({"role": "user", "content": user})
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

    def timed(key, prompts, sp):
        t = time.time(); out = llm.generate(prompts, sp); timing[key] = round(time.time() - t); return out

    prompts, sps = [], []
    for p in plan:
        target = ", ".join(p["target"]) if p["target"] else "NONE (the message alone is enough)"
        none_rule = ("Each message must be fully understandable alone: no reference to earlier messages, events, "
                     "rumours, audience or purpose." if not p["target"] else
                     "Do not add hooks for other context types than the listed ones.")
        concern_rule = ("Each message says something negative, mocking or damaging about an identifiable person "
                        "(explicitly or by hint)." if p["concern"] else
                        "No message says anything negative about another person (logistics, thanks, sincere praise, "
                        "neutral news, own feelings) - yet the listed context is still needed to understand it.")
        prompts.append(chat(GEN_SYSTEM.format(defs=defs, n=n_per, target=target, none_rule=none_rule,
                                              concern_rule=concern_rule),
                            f"Setting: {p['scene']} (Israel). Write the {n_per} messages now."))
        sps.append(SamplingParams(temperature=0.8, top_p=0.95, max_tokens=900, seed=p["seed"]))
    outs = timed("gen_s", prompts, sps)
    rows, fail = [], []
    for p, o in zip(plan, outs):
        arr = json_array(o.outputs[0].text)
        if not arr and len(fail) < 5:
            fail.append({"finish": o.outputs[0].finish_reason, "raw": o.outputs[0].text[:400]})
        for s in arr[:n_per]:
            if isinstance(s, str) and s.strip():
                rows.append({"en": s.strip(), "target": p["target"], "target_concern": p["concern"],
                             "scene": p["scene"]})

    def verify(texts, key):
        vsys = VERIFY_SYSTEM.format(defs=defs)
        groups = [texts[i:i + 6] for i in range(0, len(texts), 6)]
        vouts = timed(key, [chat(vsys, "\n".join(f"{j + 1}. {t}" for j, t in enumerate(g))) for g in groups],
                      SamplingParams(temperature=0.0, max_tokens=900))
        res = []
        for g, o in zip(groups, vouts):
            arr = json_array(o.outputs[0].text)
            for j in range(len(g)):
                v = next((x for x in arr if isinstance(x, dict) and x.get("i") == j + 1), None)
                if v is None and j < len(arr) and isinstance(arr[j], dict):
                    v = arr[j]
                res.append(None if v is None else {"labels": sorted({x for x in v.get("labels", []) if x in ids}),
                                                    "concern": bool(v.get("concern"))})
        return res

    for r, v in zip(rows, verify([r["en"] for r in rows], "verify_s")):
        r["verify"] = v
    teacher = verify(holdout_texts, "teacher_s") if holdout_texts else []
    hf_cache.commit()
    timing["total_s"] = round(time.time() - t0)
    return {"rows": rows, "teacher": teacher, "fail_samples": fail, "timing": timing}


@app.function(gpu="A100-40GB", image=image, volumes={"/root/.cache/huggingface": hf_cache}, timeout=3600,
              scaledown_window=2)
def translate(ens: list, model: str) -> dict:
    """English -> Hebrew with a Hebrew-native model, temperature 0."""
    from vllm import LLM, SamplingParams

    t0 = time.time()
    llm = LLM(model=model, dtype="bfloat16", max_model_len=2048, gpu_memory_utilization=0.9)
    tok = llm.get_tokenizer()
    timing = {"tr_load_s": round(time.time() - t0)}

    def chat(system, user, shots=()):
        # Mistral-family templates (DictaLM) reject a system role: fold it into the first user turn.
        msgs = []
        for u, a in shots:
            msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
        msgs.append({"role": "user", "content": user})
        msgs[0] = {"role": "user", "content": system + "\n\n" + msgs[0]["content"]}
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

    sp = SamplingParams(temperature=0.0, max_tokens=250)
    t = time.time()
    # Smoke 2026-10-28: unframed questions were ANSWERED, an English "English message:" frame made it paraphrase
    # in English; a Hebrew instruction prefix translates. DictaLM cannot code-switch (pure he or pure en).
    he = [first_line(o.outputs[0].text) for o in
          llm.generate([chat(HE_SYSTEM, "תרגם לעברית: " + e, HE_SHOTS) for e in ens], sp)]
    timing["he_s"] = round(time.time() - t)
    hf_cache.commit()
    timing["tr_total_s"] = round(time.time() - t0)
    return {"he": he, "timing": timing}


@app.function(gpu="H100", image=image, volumes={"/root/.cache/huggingface": hf_cache}, timeout=3600,
              scaledown_window=2)
def mix(pairs: list) -> dict:
    """(Hebrew, English) -> code-switched with Qwen2.5-32B (the prompt verified in translate_modal.py)."""
    from vllm import LLM, SamplingParams

    t0 = time.time()
    llm = LLM(model=MODEL, dtype="bfloat16", max_model_len=2048, gpu_memory_utilization=0.92)
    tok = llm.get_tokenizer()
    fmt = lambda h, e: f"Hebrew: {h}\nEnglish: {e}"  # noqa: E731

    def chat(user):
        msgs = [{"role": "system", "content": MIX_SYSTEM}]
        for h, e, m in MIX_SHOTS:
            msgs += [{"role": "user", "content": fmt(h, e)}, {"role": "assistant", "content": m}]
        msgs.append({"role": "user", "content": user})
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    outs = llm.generate([chat(fmt(h, e)) for h, e in pairs], SamplingParams(temperature=0.0, max_tokens=250))
    hf_cache.commit()
    return {"mixed": [first_line(o.outputs[0].text) for o in outs], "timing": {"mix_total_s": round(time.time() - t0)}}


def ratio_ok(src, t):
    return 0.4 <= len(t) / max(1, len(src)) <= 1.8


def ok_text(lang, t):
    if not t or BAD.search(t) or not (8 <= len(t) <= 320):
        return False
    h, l = len(HEB.findall(t)), len(LAT.findall(t))
    if lang == "he":
        return h >= 5 and l == 0  # names are transliterated; any Latin = leaked fragment (smoke 2026-10-28)
    if lang == "en":
        return h == 0 and l >= 5
    return h >= 3 and l >= 3 and min(h, l) / (h + l) >= 0.15


def norm(t):
    return re.sub(r"\W+", " ", t.lower()).strip()


@app.local_entrypoint()
def main(out: str, holdout: str = "", n_prompts: int = 800, n_mix: int = 2000, seed: int = 2026,
         tr_model: str = "dicta-il/dictalm2.0-instruct", focus: str = ""):
    root = pathlib.Path(__file__).resolve().parent
    labels = json.loads((root / "labels.json").read_text(encoding="utf-8"))["learned"]
    ids = [l["id"] for l in labels]
    hold = [json.loads(l) for l in open(holdout, encoding="utf-8")] if holdout else []
    hold_norm = {norm(h["text"]) for h in hold}
    plan = plan_prompts(ids, n_prompts, seed, [f for f in focus.split(",") if f])
    res = generate.remote(plan, labels, n_mix, [h["text"] for h in hold])
    ens = [r["en"] for r in res["rows"]]
    tr = translate.remote(ens, tr_model)
    pick = [i for i in range(len(ens)) if ok_text("he", tr["he"][i]) and ratio_ok(ens[i], tr["he"][i])]
    random.Random(7).shuffle(pick); pick = sorted(pick[:n_mix])
    mx = mix.remote([(tr["he"][i], ens[i]) for i in pick]) if pick else {"mixed": [], "timing": {}}
    mixed = dict(zip(pick, mx["mixed"]))
    for i, r in enumerate(res["rows"]):
        r["he"] = tr["he"][i]
        r["mixed"] = mixed.get(i, "")
    res["timing"].update(tr["timing"]); res["timing"].update(mx["timing"])
    drop_samples = []
    st = {"generated_en": len(res["rows"]), "no_verify": 0, "disagree_gt1": 0, "filtered_en": 0, "dup": 0,
          "holdout_overlap": 0, "exact_agree": 0, "he_dropped": 0, "mixed_dropped": 0}
    seen, kept = set(), []
    for r in res["rows"]:
        if r["verify"] is None:
            st["no_verify"] += 1; continue
        if not ok_text("en", r["en"]):
            st["filtered_en"] += 1; continue
        if norm(r["en"]) in seen:
            st["dup"] += 1; continue
        diff = set(r["target"]) ^ set(r["verify"]["labels"])
        if len(diff) > 1:
            st["disagree_gt1"] += 1; continue
        st["exact_agree"] += int(not diff)
        f = "rt-" + hashlib.sha256(r["en"].encode("utf-8")).hexdigest()[:12]
        # Label = the BLIND verifier's reading of the actual text; the generator target is only a consistency
        # check (|diff| <= 1). Smoke 2026-10-28: the union attached need_purpose to plain gossip.
        base = {"labels": r["verify"]["labels"], "target": r["target"],
                "verify": r["verify"]["labels"], "concern": bool(r["target_concern"] or r["verify"]["concern"]),
                "family": f, "scene": r["scene"], "synthetic": True,
                "review_status": "agent_reviewed_sample;human_review_pending",
                "split": "dev" if int(f[3:], 16) % 100 < 15 else "train"}  # families never straddle splits
        for lang, src in (("en", "generated:" + MODEL), ("he", "translated:" + tr_model),
                          ("mixed", "code-switched:" + tr_model)):
            t = r.get(lang, "")
            if not ok_text(lang, t) or norm(t) in seen or (lang != "en" and not ratio_ok(r["en"], t)):
                if lang != "en" and t:
                    st[f"{lang}_dropped"] += 1
                    if len(drop_samples) < 12:
                        drop_samples.append({"lang": lang, "en": r["en"], "out": t})
                continue
            if norm(t) in hold_norm:
                st["holdout_overlap"] += 1; continue
            seen.add(norm(t))
            kept.append({"id": f"{f}-{lang}", "text": t, "language": lang, **base,
                         "source": f"synthetic:{src}"})
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        for r in kept:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    st.update(kept=len(kept), families=len({r["family"] for r in kept}), timing=res["timing"],
              per_lang={l: sum(r["language"] == l for r in kept) for l in ("he", "en", "mixed")},
              per_split={s: sum(r["split"] == s for r in kept) for s in ("train", "dev")},
              per_label={l: sum(l in r["labels"] for r in kept) for l in ids},
              none=sum(not r["labels"] for r in kept), fail_samples=res["fail_samples"], drop_samples=drop_samples,
              sha256=hashlib.sha256(pathlib.Path(out).read_bytes()).hexdigest())
    pathlib.Path(out).with_suffix(".stats.json").write_text(json.dumps(st, ensure_ascii=False, indent=1),
                                                             encoding="utf-8")
    if hold:  # teacher predictions on the holdout, scored by evaluate.py like any candidate (0/1 "probs")
        tp = pathlib.Path(out).resolve().parent.parent / "results" / "router" / "qwen32b-teacher.probs.json"
        tp.parent.mkdir(parents=True, exist_ok=True)
        dev = [r for r in kept if r["split"] == "dev"]
        tp.write_text(json.dumps({
            "run": "qwen32b-teacher", "base_model": MODEL, "note": "zero-shot LLM labeler = the training label source; "
            "dev probs are its own verify labels (circular), only the holdout is informative",
            "dev": {"ids": [r["id"] for r in dev], "probs": [[float(l in r["verify"]) for l in ids] for r in dev]},
            "holdout": {"ids": [h["id"] for h in hold],
                        "probs": [[float(l in (t or {"labels": []})["labels"]) for l in ids] for t in res["teacher"]]},
        }), encoding="utf-8")
    print(json.dumps({k: v for k, v in st.items() if k != "fail_samples"}, ensure_ascii=False, indent=1))
