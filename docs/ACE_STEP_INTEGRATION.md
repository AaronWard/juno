# ACE-Step 1.5 Integration

How Juno talks to the local ACE-Step 1.5 runtime.

1. **Topology.** One container, three processes under supervisord: the
   ACE-Step API server (`uv run acestep-api`, port **8001**) and the Juno
   web/proxy server (Node/Express, port **3000**). The browser only ever
   calls `/api/*` on port 3000; the proxy (`ace_proxy/src/aceClient.ts`)
   forwards to `http://127.0.0.1:8001`. The third process, MuScriptor
   (`127.0.0.1:8002`, audio→MIDI), is started and stopped on demand.

2. **Runtime install.** The Dockerfile clones
   `https://github.com/ace-step/ACE-Step-1.5.git` into `/app/ACE-Step-1.5`
   and installs dependencies with `uv sync` (falling back to pip if the
   repo layout differs). No weights are fetched at build time.

3. **Model layout.** Four repos are downloaded at container start into the
   host-mounted `/models` (see `scripts/download_models.py`):
   `acestep-v15-xl-sft`, `acestep-v15-xl-turbo`, `acestep-v15-xl-base`,
   `acestep-5Hz-lm-4B`. `scripts/entrypoint.sh` symlinks each into
   `/app/ACE-Step-1.5/checkpoints/<name>` so the runtime finds them under
   its conventional checkpoint root.

4. **Configuration.** ACE-Step is configured via environment, sanitized by the
   supervisord launcher: `ACESTEP_CONFIG_PATH` is reduced to a bare model
   name (the startup default), `ACESTEP_CONFIG_PATH2/3` are unset, and
   `ACESTEP_LM_BACKEND` is forced to `JUNO_LM_BACKEND` (default `pt`).
   Models are lazy — nothing is in VRAM until the first job or Load.

5. **Presets & model management.** Juno exposes three presets on ONE slot:
   Quality → sft (50 steps, CFG), Fast → turbo (8 steps, no CFG), Studio →
   base (50 steps, CFG; the only model with lego/extract/complete). The
   proxy's model manager (`ace_proxy/src/modelManager.ts`) loads the job's
   model with `/v1/init` before submitting it, waiting for in-flight jobs
   first, so no job ever runs on the wrong model.

6. **Task submission.** `POST /api/generate` builds the ACE-Step payload
   (`ace_proxy/src/tasks.ts: buildAcePayload`) and POSTs it to ACE-Step's
   `/release_task`. Field-by-field mapping is in `docs/API_MAPPING.md`.
   `thinking: true` is sent only for `text2music`, `lego`, and `complete`
   task types.

7. **Polling.** The proxy polls `/query_result` itself every 3 s and parses
   ACE's integer status (0 running, 1 done, 2 failed) plus the JSON-encoded
   `result` (progress, stage, error). The browser just reads the row.

8. **Audio retrieval.** On success the proxy fetches the produced file via
   ACE-Step's `GET /v1/audio?path=...`, streams a copy into
   `/outputs/library/`, and rewrites the song's `audioUrl` to the proxy's
   own `/library-audio/<file>` route so the browser never talks to port
   8001 directly.

9. **Health.** `GET /api/health` probes ACE-Step's `/health` (falling back
   to `/v1/models`) and reports both services plus the configured model
   paths. The UI shows a banner and a per-preset Model Status card, and
   downgrades gracefully: with ACE-Step offline, mock data stays usable
   and generation attempts create documented failed rows.

10. **Version drift.** The upstream repo may rename endpoints or fields.
    Everything ACE-Step-specific is isolated in `aceClient.ts` +
    `tasks.ts` (and the launch command in `supervisord.conf`), so adapting
    to upstream changes is a two-file edit. Response parsing is defensive
    (multiple field-name fallbacks for task ids, statuses, and audio
    paths).
