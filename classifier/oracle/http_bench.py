"""HTTP latency of a gate endpoint (Oracle or Modal), one request at a time.

    GATE_KEY=... python3 http_bench.py <url> <data.jsonl> [n] [ref.jsonl]

Prints p50/p95/max wall ms, server ms, and agreement with a reference at 0.2.
Standard library only, so it runs on the host without the gate image.
"""
import json
import os
import statistics
import sys
import time
import urllib.request


def main():
    url, data = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    ref = [json.loads(l)["p"] for l in open(sys.argv[4])] if len(sys.argv) > 4 else None
    texts = [json.loads(l)["text"] for l in open(data, encoding="utf-8")][:n]
    key = os.environ["GATE_KEY"]
    wall, server, agree = [], [], 0
    for i, t in enumerate(texts):
        req = urllib.request.Request(url, data=json.dumps({"text": t}).encode(), method="POST",
                                     headers={"content-type": "application/json", "x-gate-key": key,
                                              "user-agent": "lhg-gate-bench/1"})
        t0 = time.perf_counter()
        body = json.load(urllib.request.urlopen(req, timeout=10))
        wall.append((time.perf_counter() - t0) * 1000)
        server.append(body["ms"])
        if ref is not None:
            agree += (body["p"] >= 0.2) == (ref[i] >= 0.2)
    w = sorted(wall)
    print(json.dumps({"n": len(texts), "wall_p50": round(statistics.median(w), 1),
                      "wall_p95": round(w[int(0.95 * (len(w) - 1))], 1), "wall_max": round(w[-1], 1),
                      "server_p50": round(statistics.median(server), 1),
                      "agree_at_0.2": f"{agree}/{len(texts)}" if ref is not None else None}))


if __name__ == "__main__":
    main()
