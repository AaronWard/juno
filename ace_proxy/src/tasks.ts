/** Generation task helpers: Juno form -> ACE-Step payload mapping, and
 *  normalization of ACE-Step task status responses.
 *
 *  Full field mapping table lives in docs/API_MAPPING.md.
 */
import fs from "fs";
import path from "path";
import { config, PresetId } from "./config";
import { GenerateRequest, GenerationStatus, TaskType } from "./types";

/** Task types that should run with LM "thinking" enabled. */
const THINKING_TASKS: TaskType[] = ["text2music", "lego", "complete"];

export function presetFor(model?: string) {
  const id = (model && model in config.presets ? model : "juno-xl-quality") as PresetId;
  return config.presets[id];
}

/** ACE-Step rejects absolute audio paths ("absolute audio file paths are
 *  not allowed"). Absolute container paths (e.g. /uploads/x.mp3 or
 *  /outputs/library/x.wav) are symlinked into <aceWorkDir>/juno_audio/ and
 *  passed RELATIVE to the ACE-Step working directory instead. */
export function toAceRelativeAudioPath(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  if (!path.isAbsolute(absPath)) return absPath; // already relative
  const linkDir = path.join(config.aceWorkDir, "juno_audio");
  fs.mkdirSync(linkDir, { recursive: true });
  const safe = path.basename(absPath).replace(/[^\w.\- ]/g, "_");
  const name = `${Date.now().toString(36)}_${safe}`;
  const link = path.join(linkDir, name);
  try {
    fs.symlinkSync(absPath, link);
  } catch {
    // symlink can fail on odd filesystems — fall back to a copy
    fs.copyFileSync(absPath, link);
  }
  return path.posix.join("juno_audio", name);
}

/** Map the Juno Create form to an ACE-Step /release_task payload. */
export function buildAcePayload(req: GenerateRequest): Record<string, unknown> {
  const preset = presetFor(req.model);
  const taskType: TaskType = req.taskType || "text2music";

  const styleText = (req.styles || []).join(", ");
  const promptParts = [req.prompt, styleText].filter(Boolean);
  if (req.exclude) {
    promptParts.push(`avoid: ${req.exclude}`);
  }
  const prompt = promptParts.join(", ");

  const lyrics = req.instrumental ? "" : req.lyrics || "";

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
    // Juno keeps exactly one row per generation — ask for ONE take instead
    // of ACE-Step's default batch of 2 (which doubled GPU time and left a
    // second unused mp3 in /outputs/tmp/api_audio).
    batch_size: 1,
    thinking: config.lmThinking && THINKING_TASKS.includes(taskType),
    seed: useRandomSeed ? -1 : req.seed,
    use_random_seed: useRandomSeed,
  };

  // Only pin the vocal language when the user actually chose one. Forcing
  // "en" onto Spanish/Vietnamese lyrics confuses the LM metadata pass
  // (your logs showed `language: unknown` + a rewritten caption).
  if (req.vocalLanguage) payload.vocal_language = req.vocalLanguage;

  // Style Influence -> guidance_scale (1.0–15.0), but ONLY when the slider
  // deviates from the default 50. At the default we omit the field so
  // ACE-Step uses its own tuned guidance for the loaded pipeline — a forced
  // value on the llm_dit path is a prime suspect for degraded output.
  const si = req.styleInfluence;
  if (preset.cfgEnabled && si != null && si !== 50) {
    payload.guidance_scale = round1(1 + (clamp(si, 0, 100) / 100) * 14);
  }

  if (req.bpm != null) payload.bpm = req.bpm;
  if (req.key) payload.key_scale = req.key;
  if (req.timeSignature) payload.time_signature = req.timeSignature;

  const src = toAceRelativeAudioPath(req.srcAudioPath);
  const ref = toAceRelativeAudioPath(req.referenceAudioPath);
  if (src) payload.src_audio_path = src;
  if (ref) payload.reference_audio_path = ref;

  if (taskType === "repaint") {
    payload.repainting_start = req.repaintStart ?? 0;
    payload.repainting_end = req.repaintEnd ?? (req.duration ?? 30);
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Defensive parsing of ACE-Step /query_result responses               */
/* ------------------------------------------------------------------ */

const AUDIO_PATH_RE = /\.(mp3|wav|flac|ogg|m4a|opus)([?#].*)?$/i;
/** Keys that echo OUR inputs back — never treat these as results. */
const SKIP_KEYS =
  /^(src_audio_path|reference_audio_path|ref_audio_path|input|inputs|request|request_payload|payload|params|prompt|lyrics)$/i;

function maybeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Recursively find a generated audio file path anywhere in the reply,
 *  including inside `result` fields that are JSON-encoded strings. */
export function findAudioPath(obj: any, depth = 0): string | undefined {
  if (obj == null || depth > 7) return undefined;
  if (typeof obj === "string") {
    if (AUDIO_PATH_RE.test(obj)) return obj;
    const t = obj.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length < 200000) {
      const parsed = maybeJson(t);
      if (parsed !== undefined) return findAudioPath(parsed, depth + 1);
    }
    return undefined;
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

function findStatus(obj: any, depth = 0): string | undefined {
  if (obj == null || depth > 6) return undefined;
  if (typeof obj === "string") {
    const t = obj.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length < 200000) {
      return findStatus(maybeJson(t), depth + 1);
    }
    return undefined;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findStatus(v, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const k of ["status", "state", "task_status"]) {
      const v = (obj as any)[k];
      if (typeof v === "string" && v) return v;
      if (typeof v === "number") return String(v);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP_KEYS.test(k)) continue;
      const r = findStatus(v, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

function findError(obj: any, depth = 0): string | undefined {
  if (obj == null || depth > 6) return undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findError(v, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const k of ["error", "err_msg", "error_msg", "failure", "exception", "traceback"]) {
      const v = (obj as any)[k];
      if (typeof v === "string" && v && !/^(ok|success|none|null)$/i.test(v)) return v;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP_KEYS.test(k)) continue;
      const r = findError(v, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

const SUCCESS_WORDS = ["succeeded", "success", "done", "finished", "completed"];
const FAILED_WORDS = ["failed", "error", "cancelled", "canceled", "failure"];
const RUNNING_WORDS = ["running", "processing", "in_progress", "generating", "pending"];
const QUEUED_WORDS = ["queued", "waiting", "created", "submitted"];

/** Normalize whatever ACE-Step /query_result returns into Juno statuses.
 *  Rules, in priority order:
 *   1. A generated audio path anywhere in the reply  -> succeeded
 *   2. A failure-ish status or a real error string    -> failed
 *   3. A success-ish status but no path yet           -> running (retry)
 *   4. Anything running/numeric                       -> running
 *   5. Otherwise                                      -> queued
 */
export function normalizeAceStatus(raw: any): {
  status: GenerationStatus;
  audioPath?: string;
  error?: string;
} {
  const audioPath = findAudioPath(raw);
  if (audioPath) return { status: "succeeded", audioPath };

  const err = findError(raw);
  const s = (findStatus(raw) || "").toLowerCase();

  if (FAILED_WORDS.includes(s) || (err && !SUCCESS_WORDS.includes(s))) {
    return { status: "failed", error: err || "ACE-Step task failed" };
  }
  if (SUCCESS_WORDS.includes(s)) {
    // Completed but no audio path visible in this reply — keep polling
    // instead of recording a path-less success.
    return { status: "running" };
  }
  if (QUEUED_WORDS.includes(s)) return { status: "queued" };
  if (RUNNING_WORDS.includes(s) || /^\d+$/.test(s)) return { status: "running" };
  return { status: "queued" };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
