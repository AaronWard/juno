#!/usr/bin/env bash
# apply_juno_lm_backend_fix.sh
# Run from the Juno repo root:
#   cd /home/aw/Documents/github/_tools/juno && bash apply_juno_lm_backend_fix.sh
#
# Root cause of the "structured gibberish" audio:
#   The 5Hz LM runs on nano-vllm's SDPA fallback (no flash-attn) with
#   torch 2.10.0+cu128 on a Blackwell RTX 5090 (sm_120). ACE-Step issue #135
#   documents this exact combo as broken — it emits corrupted audio codes
#   (note the deterministic collapse to token 35847 across different seeds).
#   The DiT then faithfully renders that corruption as noise.
#
# Fix: run the LM on the PyTorch backend (HF Transformers AutoModelForCausalLM),
#   which is the universal, correct fallback and needs no flash-attn.
#   ACE-Step's accepted value for this is "pt".
#
# Juno's proxy hardcodes lm_backend:"vllm" in the /v1/init call, so the
# compose env alone isn't enough — this patch makes the proxy read
# ACESTEP_LM_BACKEND (default "pt") and pass it through.
set -euo pipefail

[ -f ace_proxy/src/config.ts ] || { echo "ERROR: run from the juno repo root."; exit 1; }

python3 <<'PY'
import pathlib, sys

def patch(path, old, new, label):
    p = pathlib.Path(path)
    s = p.read_text(encoding="utf-8")
    if new in s:
        print(f"[skip] {label} (already applied)")
        return
    if s.count(old) != 1:
        sys.exit(f"[FAIL] {label}: anchor not found exactly once in {path}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"[ok]   {label}")

# config.ts — expose the LM backend, default to the correct "pt".
patch(
    "ace_proxy/src/config.ts",
    '  aceWorkDir: process.env.JUNO_ACE_WORKDIR || "/app/ACE-Step-1.5",',
    '  aceWorkDir: process.env.JUNO_ACE_WORKDIR || "/app/ACE-Step-1.5",\n\n'
    '  /** 5Hz LM backend sent to ACE-Step /v1/init.\n'
    '   *  "pt"   = HuggingFace Transformers (correct output; the right choice\n'
    '   *           on torch 2.10 / Blackwell / no flash-attn).\n'
    '   *  "vllm" = nano-vllm (faster, but emits CORRUPTED audio codes without a\n'
    '   *           working flash-attn on sm_120 + torch 2.10 — ACE-Step #135). */\n'
    '  lmBackend: process.env.ACESTEP_LM_BACKEND || "pt",',
    "config.ts: add config.lmBackend (default pt)",
)

# routes.ts — stop hardcoding "vllm" in the init call.
patch(
    "ace_proxy/src/routes.ts",
    '      lm_backend: "vllm",',
    '      lm_backend: config.lmBackend,',
    "routes.ts: /api/models/init uses config.lmBackend",
)

print()
print("Proxy patches applied.")
PY

echo
echo "============================================================"
echo "Now flip the compose env from vllm -> pt and rebuild."
echo
echo "  cd /home/aw/Documents/beefy-boii/docker"
echo "  sed -i 's/ACESTEP_LM_BACKEND: vllm/ACESTEP_LM_BACKEND: pt/' docker-compose.yml"
echo "  docker compose build juno && docker compose up -d juno && docker compose logs -f juno"
echo
echo "After it boots, click 'Initialize model' again (it must reload the LM"
echo "with the new backend). In the acestep logs you should now see the LM"
echo "init WITHOUT the nano-vllm KV-cache line — it'll say the PyTorch/HF"
echo "backend instead. Then generate: it should be real music."
echo
echo "Note: pt is a little slower than vllm would be with working flash-attn,"
echo "but it is correct. If you later want vllm speed, you'd need a flash-attn"
echo "build for cu128 + sm_120 baked into the image."
echo "============================================================"
