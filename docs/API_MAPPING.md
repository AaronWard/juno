# Juno ↔ ACE-Step API Mapping

## Endpoints

| Juno (port 3000) | Method | ACE-Step (port 8001) | Notes |
|---|---|---|---|
| `/api/health` | GET | `/health` (fallback `/v1/models`) | Aggregated Juno + ACE status |
| `/api/models` | GET | — (disk inspection + cached init state) | Preset availability |
| `/api/models/init` | POST | model initialization endpoint | Slots: 1 = sft, 2 = turbo, 3 = base; long timeout |
| `/api/generate` | POST | `/release_task` | Payload built by `buildAcePayload` |
| `/api/tasks/query` | POST | `/query_result` | Sends `{task_id_list}`; normalizes statuses |
| `/api/audio` | GET | `/v1/audio?path=...` | Streams + saves a copy to `/outputs/library` |
| `/api/upload` | POST | — (local disk) | Multer → `/uploads` |
| `/api/library`, `/api/library/song`, `/api/library/song/:id` | GET/POST/PATCH/DELETE | — | JSON DB at `/data/juno-db.json` |
| `/api/export` | POST | — | Manifest → `/outputs/exports` |

## Generation fields

| Juno form field | ACE-Step field | Transform |
|---|---|---|
| prompt + style chips (+ Exclude) | `prompt` | Joined with ", "; Exclude appended as `avoid: …` (local prompt construction) |
| lyrics | `lyrics` | Verbatim |
| Instrumental mode | `lyrics` | Empty string; flagged locally |
| vocal language | `vocal_language` | Default `en` |
| duration | `audio_duration` | Seconds |
| preset | `model` + `inference_steps` | sft/50, turbo/8, base/50 |
| Style Influence (0–100) | `guidance_scale` | `1 + v/100 × 14` (1.0–15.0); **omitted for Turbo** (no-CFG path) — stored as metadata only |
| Weirdness (0–100) | — | Local metadata; > 75 forces `use_random_seed: true` |
| seed | `seed`, `use_random_seed` | `-1` + random when unset or weirdness-forced |
| bpm / key / time signature | `bpm`, `key_scale`, `time_signature` | Optional passthrough |
| source audio (Cover / Replace Section) | `src_audio_path` | Container path of the source file |
| inspiration audio | `reference_audio_path` | From "Use as Inspiration" / Mashup second source |
| Replace Section range | `repainting_start`, `repainting_end` | Seconds; `task_type: repaint` only |
| LM thinking | `thinking` | `true` only for `text2music`, `lego`, `complete` |

## UI action → task type

| UI action | task_type / handling |
|---|---|
| Create | `text2music` |
| Cover | `cover` |
| Replace Section (menu, Editor, Studio repaint) | `repaint` |
| Extend / Extend arrangement | `complete` |
| Mashup | `lego` |
| Extract / Sample source | `extract` (where supported) |
| Reverse, Adjust Speed, Crop, Remove Section, Sample this song | Local audio processing — no model call |
| Reuse Prompt, Use as Inspiration | Local metadata / form prefill (Inspiration also attaches `reference_audio_path`) |

## Task status normalization

ACE-Step status strings (`status` / `state` / `task_status`) →
Juno statuses:

- `succeeded|success|done|finished|completed` or any audio path present → `succeeded`
- `failed|error|cancelled|canceled` → `failed`
- `running|processing|in_progress|generating` → `running`
- anything else → `queued`

Audio path is read from `audio_path`, `result.audio_path`, `result.path`,
`audio_paths[0]`, or `result.audio_paths[0]`.
