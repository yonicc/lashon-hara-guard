"""Round 2 of the router data (docs/35): relabel every family with a STRONGER blind labeler.

    py -m modal run classifier/router/relabel_modal.py --data classifier/data/router_v1_synth.jsonl,classifier/data/router_v1_aug.jsonl \
        --holdout classifier/data/router_holdout_v1.jsonl --out classifier/data/router_v2_synth.jsonl

Same label definitions (labels.json v1) and the same blind verifier prompt as gen_router_modal.py - only the
labeler changes (Qwen2.5-72B-Instruct, bf16 on 4xH100; AWQ is avoided per docs/31). The English text of each
family is labeled; its Hebrew and code-switched rows inherit the label. The 72B labels on the holdout are
written as qwen72b-teacher.probs.json so docs/35 can compare the label source with the independent holdout.
Round 1 showed the students sit at the teacher's ceiling on the holdout, so label quality is the lever.
"""
import hashlib
import json
import pathlib
import time

import modal

MODEL = "Qwen/Qwen2.5-72B-Instruct"
app = modal.App("lhg-router-relabel")
image = modal.Image.debian_slim(python_version="3.11").pip_install("vllm==0.6.6.post1", "transformers==4.47.1")
hf_cache = modal.Volume.from_name("lhg-hf-cache", create_if_missing=True)


@app.function(gpu="H100:4", image=image, volumes={"/root/.cache/huggingface": hf_cache}, timeout=3600,
              scaledown_window=2)
def relabel(texts: list, system: str, ids: list) -> dict:
    import re

    from vllm import LLM, SamplingParams

    t0 = time.time()
    llm = LLM(model=MODEL, dtype="bfloat16", tensor_parallel_size=4, max_model_len=4096, gpu_memory_utilization=0.9)
    tok = llm.get_tokenizer()
    load_s = time.time() - t0

    def arr_of(text):
        m = re.search(r"\[.*\]", text, re.S)
        try:
            v = json.loads(m.group(0)) if m else []
            return v if isinstance(v, list) else []
        except json.JSONDecodeError:
            return []
    groups = [texts[i:i + 6] for i in range(0, len(texts), 6)]
    prompts = [tok.apply_chat_template([{"role": "system", "content": system},
                                        {"role": "user", "content": "\n".join(f"{j + 1}. {t}" for j, t in enumerate(g))}],
                                       tokenize=False, add_generation_prompt=True) for g in groups]
    t1 = time.time()
    outs = llm.generate(prompts, SamplingParams(temperature=0.0, max_tokens=900))
    lab_s = time.time() - t1
    res = []
    for g, o in zip(groups, outs):
        arr = arr_of(o.outputs[0].text)
        for j in range(len(g)):
            v = next((x for x in arr if isinstance(x, dict) and x.get("i") == j + 1), None)
            if v is None and j < len(arr) and isinstance(arr[j], dict):
                v = arr[j]
            res.append(None if v is None else {"labels": sorted({x for x in v.get("labels", []) if x in ids}),
                                                "concern": bool(v.get("concern"))})
    hf_cache.commit()
    return {"labels": res, "timing": {"load_s": round(load_s), "label_s": round(lab_s),
                                      "total_s": round(time.time() - t0)}}


@app.local_entrypoint()
def main(data: str, holdout: str, out: str):
    import sys
    here = pathlib.Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    from gen_router_modal import VERIFY_SYSTEM, defs_text, norm  # one prompt, one home

    schema = json.loads((here / "labels.json").read_text(encoding="utf-8"))["learned"]
    ids = [l["id"] for l in schema]
    rows = [json.loads(l) for f in data.split(",") if f for l in open(f, encoding="utf-8") if l.strip()]
    hold = [json.loads(l) for l in open(holdout, encoding="utf-8") if l.strip()]
    hold_norm = {norm(h["text"]) for h in hold}
    fam_en = {}
    for r in rows:
        if r["language"] == "en":
            fam_en.setdefault(r["family"], r["text"])
    fams = sorted(fam_en)
    texts = [fam_en[f] for f in fams] + [h["text"] for h in hold]
    res = relabel.remote(texts, VERIFY_SYSTEM.format(defs=defs_text(schema)), ids)
    lab = dict(zip(fams, res["labels"][:len(fams)]))
    teacher = res["labels"][len(fams):]
    st = {"families": len(fams), "no_label": 0, "rows_in": len(rows), "holdout_overlap": 0,
          "agree_with_32b_exact": 0, "timing": res["timing"]}
    flips = {l: {"added": 0, "removed": 0} for l in ids}
    kept = []
    for f in fams:
        if lab[f] is None:
            st["no_label"] += 1
    for r in rows:
        v = lab.get(r["family"])
        if v is None or norm(r["text"]) in hold_norm:
            st["holdout_overlap"] += int(v is not None); continue
        if r["language"] == "en":
            st["agree_with_32b_exact"] += int(set(v["labels"]) == set(r["labels"]))
            for l in ids:
                flips[l]["added"] += int(l in v["labels"] and l not in r["labels"])
                flips[l]["removed"] += int(l not in v["labels"] and l in r["labels"])
        kept.append({**r, "labels": v["labels"], "labels_32b": r["labels"], "label_source": MODEL,
                     "concern": bool(r["concern"] or v["concern"])})
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        for r in kept:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    st.update(kept=len(kept), flips_vs_32b_en=flips,
              per_lang={l: sum(r["language"] == l for r in kept) for l in ("he", "en", "mixed")},
              per_split={s: sum(r["split"] == s for r in kept) for s in ("train", "dev")},
              per_label={l: sum(l in r["labels"] for r in kept) for l in ids},
              none=sum(not r["labels"] for r in kept),
              sha256=hashlib.sha256(pathlib.Path(out).read_bytes()).hexdigest())
    pathlib.Path(out).with_suffix(".stats.json").write_text(json.dumps(st, indent=1), encoding="utf-8")
    dev = [r for r in kept if r["split"] == "dev"]
    tp = pathlib.Path(out).resolve().parent.parent / "results" / "router" / "qwen72b-teacher.probs.json"
    tp.write_text(json.dumps({
        "run": "qwen72b-teacher", "base_model": MODEL,
        "note": "zero-shot 72B labeler = round-2 label source; dev probs are its own labels (circular)",
        "dev": {"ids": [r["id"] for r in dev], "probs": [[float(l in r["labels"]) for l in ids] for r in dev]},
        "holdout": {"ids": [h["id"] for h in hold],
                    "probs": [[float(l in (t or {"labels": []})["labels"]) for l in ids] for t in teacher]}}),
        encoding="utf-8")
    print(json.dumps(st, indent=1))
