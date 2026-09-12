/** Generation task helpers: Juno form -> ACE-Step payload mapping, and
 *  normalization of ACE-Step task status responses.
 *
 *  Verified against ACE-Step 1.5 (commit ca1e85f): see docs/API_MAPPING.md.
 */
import fs from "fs";
import path from "path";
import { config, Preset, PresetId } from "./config";
import { GenerateRequest, GenerationStatus, TaskType } from "./types";

/** Task types that use the 5Hz LM ("thinking"). ACE-Step skips the LM for
 *  cover / repaint / extract regardless. */
const THINKING_TASKS: TaskType[] = ["text2music", "lego", "complete"];

export function presetFor(model?: string): Preset {
  const id = (model && model in config.presets ? model : "juno-xl-quality") as PresetId;
  return config.presets[id];
}

/** lego / extract / complete only exist on the BASE model. Turbo and SFT
 *  would silently ignore the task, so route those to Juno XL Studio. */
export function resolvePreset(model: string | undefined, taskType: TaskType): { preset: Preset; rerouted: boolean } {
  if (taskType === "cover-nofsq") taskType = "cover";
  const wanted = presetFor(model);
  if ((wanted.supportedTasks as readonly TaskType[]).includes(taskType)) return { preset: wanted, rerouted: false };
  return { preset: config.presets["juno-xl-studio"], rerouted: true };
}

/** ACE-Step rejects absolute audio paths ("absolute audio file paths are
 *  not allowed"). Absolute container paths (e.g. /uploads/x.mp3 or
 *  /outputs/library/x.wav) are symlinked into <aceWorkDir>/juno_audio/ and
 *  passed RELATIVE to the ACE-Step working directory instead. */
export function toAceRelativeAudioPath(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  if (!path.isAbsolute(absPath)) return absPath;
  if (!fs.existsSync(absPath)) throw new Error(`Source audio not found on disk: ${absPath}`);

  const linkDir = path.join(config.aceWorkDir, "juno_audio");
  fs.mkdirSync(linkDir, { recursive: true });

  const safe = path.basename(absPath).replace(/[^\w.\- ]/g, "_");
  const name = `${Date.now().toString(36)}_${safe}`;
  const link = path.join(linkDir, name);

  try {
    fs.symlinkSync(absPath, link);
  } catch {
    fs.copyFileSync(absPath, link);
  }
  return path.posix.join("juno_audio", name);
}

/** Map the Juno Create form to an ACE-Step /release_task payload. */
export function buildAcePayload(req: GenerateRequest, preset: Preset): Record<string, unknown> {
  let taskType: TaskType = req.taskType || "text2music";
  // "no FSQ" conditions on the source's raw latents instead of quantized audio
  // codes — a second, independent fidelity path.
  if (taskType === "cover" && req.noFsq) taskType = "cover-nofsq";

  const styleText = (req.styles || []).join(", ");
  const promptParts = [req.prompt, styleText].filter(Boolean) as string[];
  if (req.exclude) promptParts.push(`avoid: ${req.exclude}`);
  if (req.vocalGender && req.vocalGender !== "none" && !req.instrumental) {
    promptParts.push(`${req.vocalGender} vocals`);
  }
  const prompt = promptParts.join(", ");

  // ACE-Step's training data labels instrumentals as "[Instrumental]";
  // an empty string lets the LM hallucinate vocals.
  const lyrics = req.instrumental ? "[Instrumental]" : req.lyrics || "";

  // Weirdness is LOCAL metadata + seed variation.
  const weirdness = clamp(req.weirdness ?? 50, 0, 100);
  const useRandomSeed = req.seed == null || weirdness > 75;

  const payload: Record<string, unknown> = {
    model: preset.aceModel,
    task_type: taskType,
    prompt,
    lyrics,
    audio_duration: req.duration ?? 120,
    inference_steps: preset.inferenceSteps,
    shift: preset.shift,
    infer_method: preset.inferMethod,
    // Juno keeps one row per generation — ask for ONE take (API default is 2).
    batch_size: 1,
    thinking: config.lmThinking && THINKING_TASKS.includes(taskType),
    // Without these, ACE-Step lazy-loads the LM with its per-request default
    // backend ("vllm"), ignoring ACESTEP_LM_BACKEND.
    lm_backend: config.lmBackend,
    lm_model_path: config.lmModel,
    seed: useRandomSeed ? -1 : req.seed,
    use_random_seed: useRandomSeed,
    audio_format: "mp3",
  };

  if (req.vocalLanguage) payload.vocal_language = req.vocalLanguage;

  // Style Influence -> CFG guidance, kept inside the stable 5–9 band.
  if (preset.cfgEnabled) {
    payload.guidance_scale = guidanceForStyleInfluence(req.styleInfluence, preset);
    payload.cfg_interval_start = preset.cfgIntervalStart;
    payload.cfg_interval_end = preset.cfgIntervalEnd;
    payload.use_adg = preset.useAdg;
  } else {
    payload.use_adg = false;
  }

  if (req.bpm != null) payload.bpm = req.bpm;
  if (req.key) payload.key_scale = req.key;
  if (req.timeSignature) payload.time_signature = req.timeSignature;

  const src = toAceRelativeAudioPath(req.srcAudioPath);
  const ref = toAceRelativeAudioPath(req.referenceAudioPath);
  if (src) payload.src_audio_path = src;
  if (ref) payload.reference_audio_path = ref;

  if (["cover", "cover-nofsq", "repaint", "lego", "extract", "complete"].includes(taskType) && !src) {
    throw new Error(`"${taskType}" needs source audio, but this song has no local audio file.`);
  }

  if (taskType === "repaint" || taskType === "lego") {
    payload.repainting_start = req.repaintStart ?? 0;
    // A repainting_end past the source's end OUTPAINTS (ACE-Step pads the
    // source) — that is how Extend works.
    payload.repainting_end = req.repaintEnd ?? -1;
  }
  if (taskType === "repaint") payload.chunk_mask_mode = "explicit";

  if (taskType === "cover" || taskType === "cover-nofsq") {
    // ACE-Step has TWO independent cover knobs; Juno previously sent neither,
    // so every cover ran at cover_noise_strength=0 — the API default, which
    // upstream documents as "0 = no melody retention (pure style transfer)".
    // That is why covers came back sounding unrelated to the source.
    //
    //  cover_noise_strength : how much of the source's melody/latent detail
    //                         seeds the denoise. 0 = none, 1 = closest to src.
    //                         Upstream recommends 0.1–0.25 on SFT; users report
    //                         noise/distortion at high values, so Juno's
    //                         Source Fidelity slider maps into a safe band.
    //  audio_cover_strength : fraction of DiT steps conditioned on the source's
    //                         semantic codes vs. text-only. 1.0 = every step
    //                         follows the source plan, lower = more freedom for
    //                         the caption. This is Style Influence, inverted.
    payload.cover_noise_strength = coverNoiseFor(req.sourceFidelity);
    payload.audio_cover_strength = coverCodesFor(req.coverStyleInfluence);
    if (req.coverStrength != null) payload.audio_cover_strength = clamp(req.coverStrength, 0, 1);
  }
  if ((taskType === "lego" || taskType === "extract") && req.trackName) {
    payload.track_name = req.trackName;
    payload.instruction =
      taskType === "lego"
        ? `Generate the ${req.trackName} track based on the audio context:`
        : `Extract the ${req.trackName} track from the audio:`;
  }

  return payload;
}

/* ------------------------------------------------------------------ */
/* Defensive parsing of ACE-Step /query_result responses               */
/* ------------------------------------------------------------------ */

/** ACE-Step's "file" field is often a ready-made download URL like
 *  "/v1/audio?path=%2Foutputs%2Ftmp%2F...mp3". Unwrap it to the raw path. */
export function unwrapAudioUrl(p: string): string {
  let cur = p;
  for (let i = 0; i < 4; i++) {
    const m = cur.match(/[?&]path=([^&#]+)/);
    if (!m) break;
    let inner = m[1];
    try {
      inner = decodeURIComponent(inner);
    } catch {
      /* keep */
    }
    if (inner === cur) break;
    cur = inner;
  }
  return cur;
}

const AUDIO_PATH_RE = /\.(mp3|wav|flac|ogg|m4a|opus)([?#].*)?$/i;

/** Keys that echo OUR inputs back — never treat these as generated results. */
const SKIP_KEYS =
  /^(src_audio_path|reference_audio_path|ref_audio_path|input|inputs|request|request_payload|payload|params|prompt|lyrics)$/i;

function maybeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function parseDeep(v: any): any {
  if (typeof v === "string") {
    const t = v.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length < 500000) {
      const p = maybeJson(t);
      if (p !== undefined) return p;
    }
  }
  return v;
}

/** Recursively find a generated audio file path anywhere in the reply,
 *  including inside `result` fields that are JSON-encoded strings. */
export function findAudioPath(obj: any, depth = 0): string | undefined {
  if (obj == null || depth > 7) return undefined;
  if (typeof obj === "string") {
    if (AUDIO_PATH_RE.test(obj)) return obj;
    const parsed = parseDeep(obj);
    return parsed !== obj ? findAudioPath(parsed, depth + 1) : undefined;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findAudioPath(v, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const k of ["audio_path", "audio_file", "path", "file", "audio_url", "url"]) {
      const v = (obj as any)[k];
      if (typeof v === "string" && AUDIO_PATH_RE.test(v)) return v;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP_KEYS.test(k)) continue;
      const r = findAudioPath(v, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

function findField(obj: any, keys: string[], depth = 0): any {
  if (obj == null || depth > 6) return undefined;
  obj = parseDeep(obj);
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findField(v, keys, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const k of keys) {
      const v = (obj as any)[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP_KEYS.test(k)) continue;
      if (typeof v === "object" || typeof v === "string") {
        const r = findField(v, keys, depth + 1);
        if (r !== undefined) return r;
      }
    }
  }
  return undefined;
}

function findError(obj: any): string | undefined {
  const v = findField(obj, ["error", "err_msg", "error_msg", "failure", "exception", "traceback"]);
  if (typeof v === "string" && v && !/^(ok|success|none|null)$/i.test(v)) return v;
  return undefined;
}

const SUCCESS_WORDS = ["succeeded", "success", "done", "finished", "completed"];
const FAILED_WORDS = ["failed", "error", "cancelled", "canceled", "failure"];
const QUEUED_WORDS = ["queued", "waiting", "created", "submitted", "pending"];

export interface NormalizedStatus {
  status: GenerationStatus;
  audioPath?: string;
  error?: string;
  progress?: number;
  stage?: string;
  /** ACE says "succeeded" but no file is visible yet. */
  emptySuccess?: boolean;
}

/** Normalize one ACE-Step /query_result item.
 *
 *  ACE-Step reports an INTEGER status: 0 = queued/running, 1 = succeeded,
 *  2 = failed (including server-side timeouts). The error text, progress
 *  and stage live inside `result`, which is a JSON-ENCODED STRING. The old
 *  parser treated every number as "running" and never looked inside the
 *  string, so failed SFT/Base jobs spun as "Processing" forever. */
export function normalizeAceStatus(raw: any): NormalizedStatus {
  const item = parseDeep(raw) ?? {};
  const results = parseDeep(item?.result);
  const first = Array.isArray(results) ? parseDeep(results[0]) : results;

  const audioPath = findAudioPath(results) || findAudioPath(item);
  if (audioPath) return { status: "succeeded", audioPath: unwrapAudioUrl(audioPath) };

  const rawStatus = item?.status ?? item?.state ?? item?.task_status;
  const code =
    typeof rawStatus === "number" ? rawStatus : /^\d+$/.test(String(rawStatus ?? "")) ? Number(rawStatus) : undefined;
  const word = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
  const err = findError(first) || findError(item);

  const progressRaw = first && typeof first === "object" ? Number((first as any).progress) : NaN;
  const progress = Number.isFinite(progressRaw) ? clamp(progressRaw > 1 ? progressRaw / 100 : progressRaw, 0, 1) : undefined;
  const stageRaw = first && typeof first === "object" ? (first as any).stage : undefined;
  const stage = typeof stageRaw === "string" && stageRaw ? stageRaw : undefined;

  if (code === 2 || FAILED_WORDS.includes(word)) {
    return { status: "failed", error: err || "ACE-Step reported the task as failed (see the acestep log)." };
  }
  if (code === 1 || SUCCESS_WORDS.includes(word)) {
    return { status: "running", stage: "Finishing", emptySuccess: true };
  }
  if (err && !code) return { status: "failed", error: err };
  if (code === 0 || word) {
    const queued = QUEUED_WORDS.includes(word) || stage === "queued";
    return { status: queued ? "queued" : "running", progress, stage };
  }
  return { status: "queued" };
}

/** Source Fidelity 0–100 → cover_noise_strength.
 *  Capped at 0.5: above roughly that, upstream users report noisy/distorted
 *  output, and the source stops yielding to the new style at all. */
export function coverNoiseFor(fidelity: number | undefined): number {
  return round2((clamp(fidelity ?? 45, 0, 100) / 100) * 0.5);
}

/** Style Influence 0–100 → audio_cover_strength (INVERSE: more style = fewer
 *  source-conditioned steps). Floor 0.35 so a cover never degrades into pure
 *  text2music, which is what "sounds nothing like the source" really was. */
export function coverCodesFor(styleInfluence: number | undefined): number {
  const si = clamp(styleInfluence ?? 50, 0, 100);
  return round2(1.0 - (si / 100) * 0.65);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function guidanceForStyleInfluence(styleInfluence: number | undefined, preset: Preset): number {
  const si = clamp(styleInfluence ?? 50, 0, 100);
  return round1(preset.guidanceMin + (si / 100) * (preset.guidanceMax - preset.guidanceMin));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
