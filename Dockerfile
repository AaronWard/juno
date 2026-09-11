# Juno — offline Suno-like local music workstation powered by ACE-Step 1.5 XL.
#
# IMPORTANT: model weights are NEVER downloaded at build time. They are pulled
# at runtime by scripts/download_models.py into the host-mounted /models dir.

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

# ---------------------------------------------------------------------------
# OS dependencies
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    ca-certificates \
    ffmpeg \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    supervisor \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Node.js LTS
# ---------------------------------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# uv (fast Python package manager used by the ACE-Step repo)
# ---------------------------------------------------------------------------
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# huggingface_hub for the runtime model downloader. >=0.34 so the short `hf`
# CLI exists (used in the docs for pre-downloading MuScriptor weights).
RUN pip install --break-system-packages --no-cache-dir "huggingface_hub>=0.34" || \
    pip install --no-cache-dir "huggingface_hub>=0.34"

# ---------------------------------------------------------------------------
# ACE-Step 1.5 runtime
# ---------------------------------------------------------------------------
# Pinned to the commit Juno's API mapping was verified against. Override with
#   docker compose build --build-arg ACESTEP_REF=main juno
ARG ACESTEP_REF=ca1e85fe9430179831e6bc6be790c332190a3866
RUN git clone https://github.com/ace-step/ACE-Step-1.5.git /app/ACE-Step-1.5 \
 && cd /app/ACE-Step-1.5 && git checkout "${ACESTEP_REF}"

# Install ACE-Step dependencies with uv per the upstream install process.
# `uv sync` resolves the repo's pyproject; fall back to pip editable install
# if the repo ships requirements/setup instead.
WORKDIR /app/ACE-Step-1.5
RUN if [ -f pyproject.toml ]; then \
      uv sync || uv pip install --system -e . ; \
    elif [ -f requirements.txt ]; then \
      pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir -e . ; \
    else \
      pip install --no-cache-dir -e . ; \
    fi

# ---------------------------------------------------------------------------
# MuScriptor (audio -> MIDI). Own venv so its torch never fights ACE-Step's.
# cu128 wheels are required for Blackwell (RTX 50xx, sm_120). Weights are
# gated (CC BY-NC 4.0) and download at first use into the HF cache mount.
# ---------------------------------------------------------------------------
ARG MUSCRIPTOR_VERSION=0.3.0
RUN uv venv /opt/muscriptor --python /usr/bin/python3 \
 && ( uv pip install --python /opt/muscriptor/bin/python --torch-backend=cu128 "muscriptor==${MUSCRIPTOR_VERSION}" \
   || ( uv pip install --python /opt/muscriptor/bin/python --index-url https://download.pytorch.org/whl/cu128 torch torchaudio \
     && uv pip install --python /opt/muscriptor/bin/python "muscriptor==${MUSCRIPTOR_VERSION}" ) ) \
 && /opt/muscriptor/bin/muscriptor --help > /dev/null

# ---------------------------------------------------------------------------
# Juno app (web frontend + local proxy)
# ---------------------------------------------------------------------------
COPY . /app/juno

# Build frontend
WORKDIR /app/juno/web
RUN npm install && npm run build

# Build proxy
WORKDIR /app/juno/ace_proxy
RUN npm install && npm run build

# Process manager config
RUN cp /app/juno/supervisord.conf /etc/supervisor/conf.d/juno.conf

RUN chmod +x /app/juno/scripts/entrypoint.sh \
 && chmod +x /app/juno/scripts/healthcheck.sh

WORKDIR /app/juno

EXPOSE 3000
EXPOSE 8001
# 8002 (MuScriptor) stays internal; the proxy talks to it on 127.0.0.1.

ENTRYPOINT ["/app/juno/scripts/entrypoint.sh"]
