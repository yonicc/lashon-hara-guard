# Gate classifier for the Oracle ARM host (aarch64). Model weights are NOT in the image:
# mount the v2 directory at /models/v2 (see docs/16-gate-oracle.md).
FROM python:3.11-slim
ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
# Same versions as serve_modal.py. On aarch64 the PyPI torch wheel is the CPU build.
RUN pip install torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install transformers==4.46.3 "numpy<2" "fastapi[standard]==0.115.6"
WORKDIR /app
COPY server.py bench.py ./
EXPOSE 8090
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
