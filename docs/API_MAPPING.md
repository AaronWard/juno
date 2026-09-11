# Juno ↔ ACE-Step / MuScriptor API Mapping

Verified against ACE-Step 1.5 commit `ca1e85f` (pinned in the Dockerfile) and
MuScriptor 0.3.0.

## Endpoints

| Juno (port 3000) | Method | Backend | Notes |
|---|---|---|---|
| `/api/status` | GET | ACE `/health`, `nvidia-smi`, MuScriptor `/health` | One snapshot for the UI: loaded model, activity, queue, VRAM, settings |
| `/api/health` | GET | ACE `/health` | Legacy summary |
| `/api/models` | GET | — | Preset table + which one is loaded |
| `/api/models/load` (`/init`) | POST | ACE `/v1/init` via the queue | Returns immediately; progress in `/api/status` |
| `/api/models/unload` | POST | `supervisorctl restart acestep` | `{force:true}` cancels a running job |
| `/api/settings` | GET/PATCH | — | Idle unload, preload-on-select, MuScriptor size/idle stop |
| `/api/generate` | POST | ACE `/release_task` via the queue | Creates the row immediately (`queued`) |
| `/api/songs/:id/retry` | POST | ACE `/release_task` via the queue | Resubmits the stored request |
| `/api/tasks/query` | POST | — (DB) | ACE polling happens server-side every 3 s |
| `/api/midi` | GET/POST | MuScriptor `POST /transcribe` (SSE) | POST takes `{songId}` or multipart `file` |
| `/api/midi/:id/file` | PUT | — | Save piano-roll edits (`audio/midi` body) as `<id>.edit.mid` |
| `/api/midi/:id/edit` | DELETE | — | Revert to the original transcription |
| `/api/midi/:id/retry`, `DELETE /api/midi/:id` | | | |
| `/api/midi/server/stop` | POST | `supervisorctl stop muscriptor` | |
| `/api/audio` | GET | ACE `/v1/audio?path=` | Streams + keeps a copy in `/outputs/library` |
| `/api/upload` | POST | — | Multer → `/uploads` (derivatives → `/outputs/library`) |
| `/api/library/*` | | — | JSON DB at `/data/juno-db.json` (songs, playlists, styles, lyrics, projects…) |
| `/api/export` | POST | — | Manifest → `/outputs/exports` |

Static: `/library-audio/*`, `/upload-audio/*`, `/midi-files/*`.

## ACE-Step response envelope

Every ACE reply is `{data, code, error}`. Failures such as an out-of-memory
`/v1/init` return **HTTP 200 with `code: 500`** — `aceClient.jsonFetch`
throws on `code >= 400`.

`/query_result` items look like
`{task_id, status: 0|1|2, result: "<JSON string>", progress_text}` where
`0` = queued/running, `1` = succeeded, `2` = failed (incl. server timeout).
`result` is a JSON-encoded array of `{file, status, progress, stage, error}`.
`normalizeAceStatus` parses that string; `file` is a `/v1/audio?path=…` URL
that is unwrapped to the container path.

## Model management

- One DiT is resident (slot 1). Before submitting a job, the proxy compares
  ACE `/health.loaded_model` with the job's model; if different it waits for
  in-flight jobs, then `POST /v1/init {model, slot:1, init_llm, lm_model_path}`.
- `/v1/init` accepts only `model`, `slot`, `init_llm`, `lm_model_path`; the LM
  backend comes from ACE-Step's env, which the launcher sets from
  `JUNO_LM_BACKEND`.
- `CONFIG_PATH2/3` are unset by the launcher: with them, ACE-Step's first
  request lazy-loads every slot, and a job for an unloaded model silently
  falls back to the primary.

## Generation fields

| Juno form field | ACE-Step field | Transform |
|---|---|---|
| prompt + style chips + Exclude + vocal gender | `prompt` | Joined with ", "; Exclude → `avoid: …`; gender → `male/female vocals` |
| lyrics | `lyrics` | Verbatim; Instrumental → `"[Instrumental]"` (ACE's training label) |
| vocal language | `vocal_language` | Only when set |
| duration | `audio_duration` | Seconds |
| preset | `model`, `inference_steps`, `shift`, `infer_method` | sft 50 / turbo 8 / base 50; shift 3.0; ode |
| Style Influence (0–100) | `guidance_scale` | 5.0–9.0 linear; **omitted for Turbo** (no CFG) |
| — | `use_adg` | Base only (off by default, `JUNO_STUDIO_ADG=true`); always false for SFT/Turbo |
| Weirdness (0–100) | — | Local metadata; > 75 forces `use_random_seed: true` |
| seed | `seed`, `use_random_seed` | `-1` + random when unset or weirdness-forced |
| bpm / key / time signature | `bpm`, `key_scale`, `time_signature` | Optional |
| — | `lm_backend`, `lm_model_path` | **Always sent** (`pt`, `acestep-5Hz-lm-4B`) — the per-request default is `vllm` |
| — | `batch_size` | 1 |
| source audio | `src_audio_path` | Symlinked under the ACE workdir, sent relative |
| inspiration audio | `reference_audio_path` | Same |
| Replace / Extend range | `repainting_start`, `repainting_end`, `chunk_mask_mode: explicit` | `end` past the song's length outpaints |
| Cover strength | `audio_cover_strength` | 0–1 (Mashup smoothing uses 0.6) |
| track | `track_name`, `instruction` | lego / extract |
| LM thinking | `thinking` | `text2music`, `lego`, `complete` only |

## UI action → task type

| UI action | task_type | Model |
|---|---|---|
| Create | `text2music` | selected preset |
| Cover | `cover` | selected preset |
| Replace Section (menu, Editor, Studio repaint) | `repaint` | selected preset / Studio |
| Extend / Studio Extend clip | `repaint` with `repainting_end > duration` | selected preset / Studio |
| Mashup "Mix + smooth" | local mix → `cover` of the mix | selected preset |
| Lego / Extract / Complete | `lego` / `extract` / `complete` | **always Juno XL Studio** (base-only tasks) |
| Extract MIDI | MuScriptor `/transcribe` | small / medium / large |
| Reverse, Speed, Crop, Remove Section, Sample, Mashup "Mix only" | local Web Audio | — |
| Reuse Prompt, Use as Inspiration | form prefill | — |

## MuScriptor

`muscriptor serve --host 127.0.0.1 --port 8002 --model <size>` (supervisord
program `muscriptor`, autostart off; size read from `/data/muscriptor-model`).
Juno streams `POST /transcribe` (multipart `file`, repeated `instruments`,
`detect_tempo=best-effort`): `progress {completed,total}` events drive the
progress bar; the final `transcription_complete` event carries the base64
MIDI, an optional `quantized_midi`, and `beat_grid`. The server runs one job
at a time (503 when busy — Juno queues and retries).
