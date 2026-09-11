# Upgrading Juno: MIDI tab, working SFT/Base, managed model loading

This release adds audio→MIDI (MuScriptor), fixes Juno XL Quality (SFT) and
Juno XL Studio (base), and replaces manual "Initialize model" with automatic
model management. Your library (`/data/juno-db.json`), audio and model
weights are untouched.

## 1. Rotate your Hugging Face token

If your token has ever been pasted anywhere outside your machine, revoke it
at https://huggingface.co/settings/tokens and create a new **read** token.
`.env` is gitignored, so it has never been committed to this repo.

## 2. Accept the MuScriptor licence, and optionally pre-download

MuScriptor's weights are gated (CC BY-NC 4.0, non-commercial). With the same
account that owns `HF_TOKEN`, open the model page and accept:

- https://huggingface.co/MuScriptor/muscriptor-medium (default)
- optionally `muscriptor-small` / `muscriptor-large` if you'll switch sizes

Access is granted instantly. The weights then download by themselves on your
first transcription, which is why that one takes a while. To get it out of
the way first — note this goes into the **HF cache**, not `./models`:

The easiest way is to do it **after step 4, inside the container** — the
cache mount, the token and the file permissions are already correct there:

```bash
cd /home/aw/Documents/beefy-boii/docker
docker compose exec juno hf download MuScriptor/muscriptor-medium model.safetensors
```

To do it from the host instead, note two traps:

- Use `HF_HUB_CACHE`, **not** `HF_HOME`. `HF_HOME` also relocates the token
  file (`$HF_HOME/token`), so the CLI silently becomes anonymous and the
  gated repo returns `401 Access denied` even though `hf auth login` says you
  are logged in.
- `/mnt/data4tb/models/juno/hf-cache` is created by the container as root, so
  your user cannot write to it until you take ownership.

```bash
sudo chown -R "$(id -u):$(id -g)" /mnt/data4tb/models/juno/hf-cache

HF_HUB_CACHE=/mnt/data4tb/models/juno/hf-cache/hub \
  hf download MuScriptor/muscriptor-medium model.safetensors
```

(Not logged in? Prefix with `HF_TOKEN=hf_...`. Older huggingface_hub:
`huggingface-cli download ...` with the same arguments.)

The first transcription also pulls a small `beat_this` checkpoint from
`cloud.cp.jku.at` into `/models/torch-cache`; it can't come from HuggingFace,
and if that host is blocked the transcription still works — you just don't
get the beat-quantized `.mid`.

## 3. Update the juno block in the master compose file

In `/home/aw/Documents/beefy-boii/docker/docker-compose.yml`, change the
`environment:` of the `juno` service:

```yaml
      # REMOVE these two lines. Juno now keeps ONE XL DiT in VRAM and swaps it
      # itself; with all three set, ACE-Step lazy-loads ~27 GB of DiTs plus the
      # 4B LM on the first request and runs out of memory.
      # ACESTEP_CONFIG_PATH2: /models/acestep-v15-xl-turbo
      # ACESTEP_CONFIG_PATH3: /models/acestep-v15-xl-base

      # Bare names, not /models/... paths (ACE-Step's model-code sync for the
      # XL variants is keyed on the name). This is only the startup default.
      ACESTEP_CONFIG_PATH: acestep-v15-xl-turbo
      ACESTEP_LM_MODEL_PATH: acestep-5Hz-lm-4B

      # REPLACE `ACESTEP_LM_BACKEND: vllm` with:
      JUNO_LM_BACKEND: pt

      # New (optional): default MuScriptor size — small | medium | large
      MUSCRIPTOR_MODEL: medium
```

The supervisord launcher now enforces all of this even if you forget:
it unsets `CONFIG_PATH2/3`, converts paths to names, and forces the LM
backend to `JUNO_LM_BACKEND` (default `pt`). Editing compose just makes the
file honest.

No port changes: MuScriptor listens on `127.0.0.1:8002` inside the container
only. The Caddy route (`dashy.juno → juno:3000`) is unchanged.

## 4. Rebuild and recreate the container

Always run compose from the **master project**, not from the Juno repo:

```bash
# 1. update the source
cd /home/aw/Documents/github/_tools/juno
git apply /path/to/juno-midi-and-model-fixes.patch    # or copy the new files in

# 2. rebuild the image and recreate the container
cd /home/aw/Documents/beefy-boii/docker
docker compose up -d --build --force-recreate juno
docker compose logs -f juno
```

`--build` picks up the new Dockerfile (MuScriptor + pinned ACE-Step) and
`--force-recreate` replaces the running container so the changed environment
and supervisord config take effect. `Ctrl-C` only stops following the logs.

Variations:

```bash
# recreate without rebuilding (e.g. after editing only compose env)
docker compose up -d --force-recreate juno

# force a clean rebuild, ignoring the layer cache
docker compose build --no-cache juno && docker compose up -d --force-recreate juno

# build against the latest upstream ACE-Step instead of the pinned commit
docker compose build --build-arg ACESTEP_REF=main juno
```

The image grows by a few GB (MuScriptor gets its own CUDA 12.8 torch so it
can never break ACE-Step's). Your models, outputs, uploads and library live
on the 4TB bind mounts, so recreating the container never touches them.

## 5. Verify

```bash
# One status snapshot: loaded model, activity, VRAM, MuScriptor state
curl -s http://127.0.0.1:3900/api/status | python3 -m json.tool

# The launcher's effective ACE-Step env (should show names + pt, no PATH2/3)
docker exec juno bash -lc 'tr "\0" "\n" < /proc/$(pgrep -f acestep-api | head -1)/environ | grep ^ACESTEP_'

# MuScriptor weights in the cache (empty until the first transcription or a
# manual pre-download)
ls /mnt/data4tb/models/juno/hf-cache/hub | grep -i muscriptor
```

Then in the UI: pick **Juno XL Quality**, press Create. The row shows
"Loading Juno XL Quality…", then "Generating · NN%", then the audio. Switch
to **Juno XL Studio** and create again: the row waits for the first song to
finish, the model swaps, and it generates on base. No refresh needed.

## What changed, briefly

**Why SFT/Base looked broken (all verified against ACE-Step's source):**

1. ACE-Step reports task status as an integer (`2` = failed) with the error
   inside a JSON-encoded string. Juno read any number as "running", so every
   failed SFT/Base job spun as *Processing* forever and the real error was
   never shown.
2. Setting `CONFIG_PATH2/3` loaded three XL DiTs at once, which exhausts
   32 GB. A model that failed to load was then silently replaced by the primary.
3. `lm_backend` was never sent with jobs; ACE-Step's per-request default is
   `vllm`, which overrode `ACESTEP_LM_BACKEND=pt` whenever the LM lazy-loaded.
   (`/v1/init` also ignores an `lm_backend` field.)
4. SFT was sent `use_adg: true`; ADG is documented as base-only.
5. Model init failures come back as HTTP 200 with `code: 500`; Juno treated
   them as success.

**Model loading is now managed by the proxy:** a serialized queue loads the
right model before each job, waits for in-flight jobs before swapping, polls
ACE-Step server-side (results land even with no tab open), and can unload
after an idle timeout. Status is live in the sidebar, Create panel and
Settings.

**Task routing fixed:** Extend now uses repaint-past-the-end (true
outpainting) instead of `complete` (which adds instruments). Lego / Extract /
Complete are base-only, so they auto-route to Juno XL Studio.

**Placeholders made real:** Retry resubmits; Studio Save/Export persist and
write manifests; Open in Studio carries the song; Library Studio Projects,
Lyrics (💾 in the Lyrics card), Hooks (from "Sample this song") and Cover Art
populate; style likes persist.

`apply_juno_lm_backend_fix.sh` was removed — its fix is built in, and its
anchors no longer exist, so it would fail if run.
