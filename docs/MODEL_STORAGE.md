# Model Storage

## Where weights live

All model weights live on the **host**, mounted read-write into the
container at `/models`:

```
./models/
  acestep-v15-xl-sft/      # Juno XL Quality (default)
  acestep-v15-xl-turbo/    # Juno XL Fast
  acestep-v15-xl-base/     # Juno XL Studio
  acestep-5Hz-lm-4B/       # Language model (all presets)
```

They are downloaded from the `ACE-Step/<name>` Hugging Face repos. Weights
are **never** shipped in the ZIP and **never** baked into the Docker image
— rebuilding the image never re-downloads models, and removing the
container never deletes them.

## Download lifecycle

`scripts/download_models.py` runs at every container start:

1. For each of the four repos, if the target directory exists and is
   non-empty, it is **skipped** (manual pre-downloads are honored).
2. Otherwise `huggingface_hub.snapshot_download` fetches it with resume
   support into `/models/<name>`.
3. Auth (401/403) and rate-limit (429) errors print actionable messages
   (set `HF_TOKEN`, accept licenses, retry later) and the container exits
   rather than starting half-configured.

`scripts/verify_models.py` then asserts all four directories are present
and non-empty, and `scripts/entrypoint.sh` symlinks them into
`/app/ACE-Step-1.5/checkpoints/`.

## Caches and scratch space

- Hugging Face cache: host `./hf-cache` → `/root/.cache/huggingface`
  (avoids re-downloading blobs shared between snapshots).
- ACE-Step temp: `/outputs/tmp` (`ACESTEP_TMPDIR`).
- Compile caches: `/outputs/cache/triton`, `/outputs/cache/torchinductor`
  — persisting these makes warm starts much faster.

## Sizing

Budget roughly 60 GB for the four repos combined plus HF cache overhead.
Keep at least 20 GB extra free for outputs and compile caches.

## Moving / sharing models

The `models/` directory is self-contained: copy it to another machine (or
point `JUNO_MODEL_DIR` in `.env` at a shared drive) and the downloader
will skip everything. To force a re-download of one model, delete its
directory only.
