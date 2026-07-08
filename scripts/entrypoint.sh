#!/usr/bin/env bash
# Juno container entrypoint.
# Prepares host-mounted storage, downloads/verifies ACE-Step XL models at
# runtime, wires ACE-Step checkpoint symlinks, then starts supervisord which
# launches the ACE-Step API server (port 8001) and the Juno proxy (port 3000).
set -euo pipefail

echo "==================================================================="
echo " Juno — offline music workstation (ACE-Step 1.5 XL)"
echo "==================================================================="

MODEL_DIR="${JUNO_MODEL_DIR:-/models}"
OUTPUT_DIR="${JUNO_OUTPUT_DIR:-/outputs}"
UPLOAD_DIR="${JUNO_UPLOAD_DIR:-/uploads}"
DATA_DIR="${JUNO_DATA_DIR:-/data}"

# 1. Host-mounted model directory
mkdir -p "${MODEL_DIR}"

# 2–3. Download + verify model weights (runtime only — never baked into the
#      image). Set JUNO_SKIP_MODELS=true to boot UI-only without weights:
#      the web app runs fully on mock data, ACE-Step will show as
#      unavailable, and generation attempts create documented failed rows.
if [ "${JUNO_SKIP_MODELS:-false}" = "true" ]; then
  echo "[entrypoint] JUNO_SKIP_MODELS=true — skipping model download/verify."
  echo "[entrypoint] UI-only mode: generation disabled until models exist."
else
  echo "[entrypoint] Checking / downloading ACE-Step models into ${MODEL_DIR} ..."
  python3 /app/juno/scripts/download_models.py
  echo "[entrypoint] Verifying model directories ..."
  python3 /app/juno/scripts/verify_models.py
fi

# 4–10. Output / upload / data directories
mkdir -p "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}/library"
mkdir -p "${OUTPUT_DIR}/tmp"
mkdir -p "${OUTPUT_DIR}/cache/triton"
mkdir -p "${OUTPUT_DIR}/cache/torchinductor"
mkdir -p "${UPLOAD_DIR}"
mkdir -p "${DATA_DIR}"

# 11. Checkpoint symlinks for ACE-Step (some code paths resolve models by
#     checkpoint-relative name instead of absolute path).
CKPT_DIR="/app/ACE-Step-1.5/checkpoints"
mkdir -p "${CKPT_DIR}"
for m in acestep-v15-xl-sft acestep-v15-xl-turbo acestep-v15-xl-base acestep-5Hz-lm-4B vae Qwen3-Embedding-0.6B; do
  if [ -d "${MODEL_DIR}/${m}" ] && [ ! -e "${CKPT_DIR}/${m}" ]; then
    ln -s "${MODEL_DIR}/${m}" "${CKPT_DIR}/${m}"
    echo "[entrypoint] symlinked ${CKPT_DIR}/${m} -> ${MODEL_DIR}/${m}"
  fi
done

echo "[entrypoint] Starting supervisord (ACE-Step API :8001, Juno web :3000) ..."
# 12–14. supervisord launches both long-running services.
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
