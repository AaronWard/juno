# Troubleshooting

## 1. Container won't start / exits immediately

Check `docker compose logs juno`. The entrypoint fails fast when model
download or verification fails — the last lines say exactly which model
and why. Fix the cause (auth, disk, network) and `docker compose up`
again; downloads resume.

## 2. GPU not detected

`docker compose exec juno nvidia-smi` should list your GPU. If not:
install the NVIDIA Container Toolkit, run
`sudo nvidia-ctk runtime configure --runtime=docker`, restart Docker, and
verify with
`docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`.
Host driver must support CUDA 12.4 (≥ 550.x). With `docker run`, don't
forget `--gpus all`.

## 3. Model download failures (401/403/429)

401/403 → set `HF_TOKEN` in `.env` and accept the license on each
`ACE-Step/*` repo page. 429 → rate limited; wait and restart, downloads
resume. Behind a strict proxy, pre-download manually (README → Manual
Model Download) into `./models/<name>` — non-empty directories are
skipped.

## 4. Disk space

The four repos are tens of GB plus HF cache. `df -h ./models ./hf-cache`.
If a download died half-way and you want a clean slate for one model,
delete only `./models/<that-model>`.

## 5. ACE-Step shows "unavailable" in the UI

Expected during model download and server warm-up (minutes on first run).
Watch `docker compose logs -f juno` for the `acestep` program. If it
crash-loops, the log shows the Python traceback — most commonly OOM (§6)
or missing/corrupt weights (§3, then re-run
`scripts/verify_models.py`).

## 6. CUDA out of memory

The stack is sized for 32 GB VRAM with no offload. On smaller GPUs, edit
`docker-compose.yml`: set `ACESTEP_OFFLOAD_TO_CPU: "true"` (and optionally
`ACESTEP_OFFLOAD_DIT_TO_CPU: "true"`) — slower but lighter. Also close
other GPU consumers and prefer the Juno XL Fast preset while testing.

## 7. Port 3000 or 8001 already in use

Change the host side of the port mappings in `docker-compose.yml`
(e.g. `"3300:3000"`). Container-internal ports must stay 3000/8001.

## 8a. A preset "doesn't work" / only Juno XL Fast works

Fixed in this release — see UPGRADE.md. If it recurs, the row now shows the
real ACE-Step error instead of spinning. Useful checks:

```bash
curl -s localhost:3000/api/status | python3 -m json.tool   # loaded model + lastError
docker compose logs juno | grep -E "not found in|out of memory|Model initialization failed"
```

`not found in [...]` means ACE-Step routed a job to a model it did not have
loaded (only possible if something bypasses Juno's queue). `out of memory`
during a load: press Unload, stop other GPU users (e.g. ollama/lmstudio),
retry.

## 8b. `hf download MuScriptor/...` says "Access denied / 401"

Two different causes, often at once:

1. **The CLI is anonymous.** Setting `HF_HOME=<juno cache>` also moves the
   token file (`$HF_HOME/token`), so `hf auth login` credentials are not
   found — the debug log shows `(authenticated: False)`. Use `HF_HUB_CACHE`
   (which only moves the cache) or pass `HF_TOKEN=hf_...` explicitly:

   ```bash
   HF_HUB_CACHE=/mnt/data4tb/models/juno/hf-cache/hub \
     hf download MuScriptor/muscriptor-medium model.safetensors
   ```

2. **Approval is missing.** Open
   `https://huggingface.co/MuScriptor/muscriptor-<size>` while signed in as
   the token's owner and accept the licence — each size is a separate repo,
   so approving `medium` does not grant `large`. Check who you are with
   `hf auth whoami`. Once authenticated, a still-gated repo reports 403 with
   "awaiting approval", which distinguishes it from the 401 above.

`PermissionError: ... hf-cache/.check_for_update_done` is a third, harmless
symptom of the same setup: the directory was created by the container as
root. `sudo chown -R "$(id -u):$(id -g)" /mnt/data4tb/models/juno/hf-cache`
fixes it (root inside the container is unaffected), or just run the download
inside the container:

```bash
docker compose exec juno hf download MuScriptor/muscriptor-medium model.safetensors
```

## 8c. MIDI extraction fails

- "could not download its weights" → accept the licence at
  huggingface.co/MuScriptor/muscriptor-<size> with the HF_TOKEN account.
- Details: `./outputs/cache/muscriptor.log` (host) or
  `docker exec juno supervisorctl tail -2000 muscriptor`.
- "ran out of GPU memory" → unload ACE-Step (Settings) or pick the small model.
- Audio longer than ~15 minutes is slow; split it first.

## 8. Generation tasks fail instantly

Open the failed row — the error text is stored on it. Typical causes:
model not initialized yet (use "Initialize model" in the Create panel's
Model Status card and wait), ACE-Step endpoint mismatch after an upstream
update (see docs/ACE_STEP_INTEGRATION.md §10), or OOM (§6).

## 9. Tasks stay "Processing" forever

The proxy polls ACE-Step every 3 s (the browser only reads the result). The
row shows its stage ("Waiting to load…", "Generating · 40%"). Verify
`curl http://localhost:8001/health` and check the acestep log. If ACE-Step
restarted mid-task, the task is lost — retry from the row. The Turbo
preset (8 steps) is a fast way to confirm the pipeline works.

## 10. No audio / player shows an error

Generated files are served from `/library-audio/*` (copies under
`./outputs/library`). If the copy failed, `/api/audio?path=...` can
re-fetch from ACE-Step while it still holds the file. Uploaded files play
from `/upload-audio/*`; exotic codecs inside a supported container may
still be unplayable by your browser — transcode to MP3/WAV. Mock rows
without real audio use simulated playback by design.

## 11. Uploads rejected

Only `.mp3 .wav .m4a .ogg .flac` are accepted, 512 MB max. If the proxy is
unreachable the modal imports a session-only copy and says so — restart
the container and re-import for a persistent upload.

## 12. Library data missing or corrupt

The whole library is `./data/juno-db.json`. Back it up by copying the
file. If it's corrupt, the proxy logs a parse error and starts with an
empty DB — restore from backup and restart. Mock songs always reappear;
they live in the frontend, not the DB.

## 13. Slow first generation / long "Initialize model"

First use compiles kernels (Triton/TorchInductor) and loads an XL DiT
(~9 GB) plus the 4B LM (PyTorch backend). Compile caches persist under
`./outputs/cache/`, so later runs are much faster. The init endpoint has a
10-minute timeout in the proxy; if it times out, watch the acestep log —
initialization usually still completes and the status card turns green on
the next refresh.
