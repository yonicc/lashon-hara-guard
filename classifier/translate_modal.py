"""Translate the synthetic Hebrew gate training set into English and mixed
Hebrew/English with an open LLM on a Modal GPU (no Brain token needed).

    py -m modal run classifier/translate_modal.py --out classifier/data/v3_translated.jsonl

Labels are inherited from the Hebrew source row; only rows whose generator
label and blind verifier agreed (agree=true) are translated, so the riskiest
label noise is not multiplied. Every output keeps `family` = hash of the
Hebrew source so translations stay in the same split as their source.
Two passes: Hebrew -> English, then (Hebrew + English) -> code-switched mixed.
Outputs are filtered mechanically (foreign scripts, niqqud, script balance,
length); a row is kept only when BOTH outputs pass. Synthetic only.

Verified 2026-10-27: Qwen2.5-14B produced usable English but its mixed output
leaked Chinese/Portuguese/niqqud and gibberish; AWQ on vllm 0.6.6 failed to
load ("float16 is not supported for quantization method awq"), and vllm 0.6.6
needs transformers pinned (Qwen2Tokenizer ... all_special_tokens_extended).
"""
import hashlib
import json
import pathlib
import re

import modal

MODEL = "Qwen/Qwen2.5-32B-Instruct"
app = modal.App("lhg-gate-translate")
image = modal.Image.debian_slim(python_version="3.11").pip_install("vllm==0.6.6.post1", "transformers==4.47.1")
hf_cache = modal.Volume.from_name("lhg-hf-cache", create_if_missing=True)

EN_SYSTEM = (
    "Translate a short SYNTHETIC Hebrew chat message into natural casual English. Preserve the meaning "
    "EXACTLY: same people (transliterate names: אבי -> Avi, הגבאי -> the gabbai), the same "
    "insult, sarcasm, mock praise, hint, gossip, sincere praise, thanks or neutral logistics. Never soften, "
    "sharpen, explain or add. Keep emoji. Output ONLY the English message, nothing else."
)
EN_SHOTS = [
    ("איזה צדיק גדול אבי עם השירים", "Wow, what a saint Avi is with his singing"),
    ("הגבאי אמר שאתה עושה בעיות", "The gabbai said you're a troublemaker"),
]
MIX_SYSTEM = (
    "You write how a bilingual Israeli types in chat, switching between Hebrew and English inside one message. "
    "Given a Hebrew message and its English translation, write ONE code-switched version with the same meaning: "
    "part of it in Hebrew letters, part in English words (names may be in either script). Use only Hebrew and "
    "Latin letters, no vowel points, no other languages. Never change, soften or add meaning. "
    "Output ONLY the mixed message."
)
MIX_SHOTS = [
    ("דנה לא מסוגלת לעשות משימה פשוטה", "Dana can't do a simple task",
     "Dana לא מסוגלת לעשות a simple task"),
    ("תודה ענקית לצוות לילה, אתם אלופים", "Huge thanks to the night shift, you're the best",
     "Huge thanks לצוות לילה, you're the best"),
    ("שמעתי שנועם לוקח כסף מהקופה", "I heard Noam takes cash from the register",
     "שמעתי ש-Noam takes cash מהקופה"),
]

HEB = re.compile(r"[א-ת]")
LAT = re.compile(r"[A-Za-z]")
# Greek, Cyrillic, Arabic, Thai, CJK, Hangul, niqqud/cantillation, stray backslashes.
BAD = re.compile(r"[Ͱ-ϿЀ-ӿ؀-ۿ฀-๿぀-ヿ㐀-鿿가-힯֑-ׇ\\]")


def ok_en(src: str, en: str) -> bool:
    return bool(en) and not BAD.search(en) and not HEB.search(en) and bool(LAT.search(en)) \
        and 0.4 <= len(en) / max(1, len(src)) <= 2.5


def ok_mixed(src: str, mixed: str) -> bool:
    if not mixed or BAD.search(mixed):
        return False
    h, l = len(HEB.findall(mixed)), len(LAT.findall(mixed))
    if h < 3 or l < 3 or min(h, l) / (h + l) < 0.15:
        return False
    return 0.4 <= len(mixed) / max(1, len(src)) <= 2.5


def clean(s: str) -> str:
    s = s.strip().strip('"').strip()
    return s.splitlines()[0].strip() if s else ""


@app.function(gpu="H100", image=image, volumes={"/root/.cache/huggingface": hf_cache}, timeout=3600)
def translate(texts: list[str]) -> list[dict]:
    from vllm import LLM, SamplingParams

    llm = LLM(model=MODEL, dtype="bfloat16", max_model_len=1536, gpu_memory_utilization=0.95)
    tok = llm.get_tokenizer()
    sp = SamplingParams(temperature=0.0, max_tokens=200)

    def chat(system, shots, user):
        msgs = [{"role": "system", "content": system}]
        for u, a in shots:
            msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
        msgs.append({"role": "user", "content": user})
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

    en = [clean(o.outputs[0].text) for o in llm.generate([chat(EN_SYSTEM, EN_SHOTS, t) for t in texts], sp)]
    fmt = lambda h, e: f"Hebrew: {h}\nEnglish: {e}"  # noqa: E731
    shots = [(fmt(h, e), m) for h, e, m in MIX_SHOTS]
    mixed = [clean(o.outputs[0].text) for o in llm.generate(
        [chat(MIX_SYSTEM, shots, fmt(t, e)) for t, e in zip(texts, en)], sp)]
    hf_cache.commit()
    return [{"en": e, "mixed": m} for e, m in zip(en, mixed)]


@app.local_entrypoint()
def main(out: str, limit: int = 0):
    root = pathlib.Path(__file__).resolve().parent / "data"
    rows = [json.loads(l) for f in ("v1.jsonl", "v2_aug.jsonl")
            for l in open(root / f, encoding="utf-8")]
    rows = [r for r in rows if r.get("agree")]
    if limit:
        rows = rows[:limit]
    res = translate.remote([r["text"] for r in rows])
    kept = dropped = 0
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        for r, t in zip(rows, res):
            if not (ok_en(r["text"], t["en"]) and ok_mixed(r["text"], t["mixed"])):
                dropped += 1
                continue
            fam = "tr-" + hashlib.sha256(r["text"].encode("utf-8")).hexdigest()[:12]
            for lang in ("en", "mixed"):
                f.write(json.dumps({"text": t[lang], "label": r["label"], "category": r["category"],
                                    "mechanism": r.get("mechanism", ""), "language": lang,
                                    "family": fam, "source": "translation:" + MODEL,
                                    "verify": r.get("verify"), "agree": True},
                                   ensure_ascii=False) + "\n")
            kept += 1
    print(f"source rows {len(rows)}, kept {kept} (x2 = {2 * kept} rows), dropped {dropped} -> {out}")
