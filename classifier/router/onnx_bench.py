"""Compress an exported router (Volume lhg-models:/router/<run>/onnx/model.onnx) and time it on THIS CPU.

    (cd <dir>; py -m modal volume get lhg-models router/<run> .)   # Windows: destination must be an existing dir
    py classifier/router/onnx_bench.py --model <dir>/<run> --holdout classifier/data/router_holdout_v1.jsonl \
        --probs classifier/results/router/<run>.probs.json [--ship matmul8]

Variants (onnx/model_<v>.onnx): fp32 (as exported), dyn8 (dynamic int8 of every supported op, per-channel),
matmul8 (int8 MatMul weights only; embeddings, LayerNorm and the classifier head stay fp32), fp16 (fp16 weights,
fp32 inputs/outputs). Prints p50/p95 per message (tokenize + forward, batch 1, 1 thread) and the largest
probability drift against the PyTorch probabilities in the run's probs.json. --ship copies that variant to
onnx/model_quantized.onnx, the file transformers.js loads with {quantized:true}.
Measured 2026-10-28: dyn8 moved xlmr probabilities by up to 0.92 and changed 173/459 holdout decisions, so a
variant must be judged by decisions (compare_quant.py), never by size or speed alone.
Not run with `py -I`: onnx / onnxconverter-common are user-site packages on BI-1.
"""
import argparse
import json
import pathlib
import shutil
import time

import numpy as np


def bench(sess, tok, texts):
    names = {i.name for i in sess.get_inputs()}
    ts, ps = [], []
    for i, t in enumerate(texts):
        s = time.perf_counter()
        enc = tok(t, truncation=True, max_length=96, return_tensors="np")
        feed = {k: v.astype(np.int64) for k, v in enc.items() if k in names}
        logits = sess.run(["logits"], feed)[0][0].astype(np.float32)
        ps.append(1 / (1 + np.exp(-logits)))
        if i >= 3:
            ts.append((time.perf_counter() - s) * 1000)
    return {"p50_ms": round(float(np.percentile(ts, 50)), 1), "p95_ms": round(float(np.percentile(ts, 95)), 1)}, ps


def build(fp32, variant, out):
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    if out.exists():
        return
    if variant == "dyn8":
        quantize_dynamic(str(fp32), str(out), weight_type=QuantType.QInt8, per_channel=True)
    elif variant == "matmul8":
        m = onnx.load(str(fp32))
        head = [n.name for n in m.graph.node if "classifier" in n.name or "score" in n.name]
        quantize_dynamic(str(fp32), str(out), weight_type=QuantType.QInt8, per_channel=True,
                         op_types_to_quantize=["MatMul"], nodes_to_exclude=head)
    elif variant == "emb8":  # int8 embedding table only (most of the bytes); every layer stays fp32
        quantize_dynamic(str(fp32), str(out), weight_type=QuantType.QInt8, op_types_to_quantize=["Gather"])
    elif variant == "fp16":
        from onnxconverter_common import float16
        onnx.save(float16.convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True), str(out))


def main():
    import onnxruntime as ort
    from transformers import AutoTokenizer

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--probs", required=True)
    ap.add_argument("--variants", default="fp32,dyn8,matmul8,fp16")
    ap.add_argument("--ship", default="")
    a = ap.parse_args()
    d = pathlib.Path(a.model)
    fp32 = d / "onnx" / "model.onnx"
    tok = AutoTokenizer.from_pretrained(str(d))
    rows = [json.loads(l) for l in open(a.holdout, encoding="utf-8") if l.strip()]
    ref = json.loads(open(a.probs, encoding="utf-8").read())["holdout"]
    refp = dict(zip(ref["ids"], ref["probs"]))
    so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
    out = {"model": d.name, "cpu_threads": 1}
    for v in a.variants.split(","):
        f = fp32 if v == "fp32" else d / "onnx" / f"model_{v}.onnx"
        build(fp32, v, f)
        lat, ps = bench(ort.InferenceSession(str(f), so, providers=["CPUExecutionProvider"]), tok,
                        [r["text"] for r in rows])
        drift = max(float(np.max(np.abs(np.array(p) - np.array(refp[r["id"]])))) for p, r in zip(ps, rows))
        out[v] = {"mb": round(f.stat().st_size / 2**20, 1), **lat, "max_prob_drift_vs_torch": round(drift, 4)}
    if a.ship:
        shutil.copyfile(d / "onnx" / f"model_{a.ship}.onnx", d / "onnx" / "model_quantized.onnx")
        out["shipped_as_model_quantized"] = a.ship
    print(json.dumps(out))


if __name__ == "__main__":
    main()
