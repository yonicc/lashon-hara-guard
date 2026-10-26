#!/bin/bash
# Build and (re)start the gate on the Oracle host. Run as ubuntu in /home/ubuntu/lhg-gate,
# with server.py, bench.py and Dockerfile copied there and the model in ./models/v2.
# The key lives only in ./gate.env (GATE_KEY=..., chmod 600), created on first run.
set -euo pipefail
cd /home/ubuntu/lhg-gate
tag=${1:-2}
if [ ! -s gate.env ]; then
  umask 077; echo "GATE_KEY=$(openssl rand -hex 32)" > gate.env
fi
docker build -q -t "lhg-gate:$tag" .
docker rm -f lhg-gate >/dev/null 2>&1 || true
# Cores 2-3 only and 2 GiB: the rest of the host (brain, tizkoret, redroid...) keeps cores 0-1.
docker run -d --name lhg-gate --restart unless-stopped \
  --cpuset-cpus 2-3 --memory 2g --memory-swap 2g --pids-limit 256 \
  -e LHG_GATE_THREADS=2 --env-file gate.env \
  -v /home/ubuntu/lhg-gate/models:/models:ro \
  -p 127.0.0.1:8090:8090 "lhg-gate:$tag"
for i in $(seq 60); do
  curl -sf http://127.0.0.1:8090/health >/dev/null && { echo "healthy after ${i}s"; exit 0; }
  sleep 1
done
echo "not healthy"; docker logs --tail 30 lhg-gate; exit 1
