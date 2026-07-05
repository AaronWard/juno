/** Generation task helpers: Juno form -> ACE-Step payload mapping, and
 *  normalization of ACE-Step task status responses.
 *
 *  Full field mapping table lives in docs/API_MAPPING.md.
 */
import { config, PresetId } from "./config";
import { GenerateRequest, GenerationStatus, TaskType } from "./types";

/** Task types that should run with LM "thinking" enabled. */
const THINKING_TASKS: TaskType[] = ["text2music", "lego", "complete"];

export function presetFor(model?: string) {
  const id = (model && model in config.presets ? model : "juno-xl-quality") as PresetId;
  return config.presets[id];
}

/** Map the Juno Create form to an ACE-Step /release_task payload. */
export function buildAcePayload(req: GenerateRequest): Record<string, unknown> {
  const preset = presetFor(req.model);
  const taskType: TaskType = req.taskType || "text2music";

  // Prompt = simple prompt + style chips joined (DESIGN_DOC §8.4).
  const styleText = (req.styles || []).join(", ");
  const promptParts = [req.prompt, styleText].filter(Boolean);
  if (req.exclude) {
    // Exclude is local prompt construction (DESIGN_DOC §9.2): fold into the
    // prompt as negative guidance text until ACE-Step exposes a native field.
    promptParts.push(`avoid: ${req.exclude}`);
  }
  const prompt = promptParts.join(", ");

  // Instrumental mode sends empty lyrics (DESIGN_DOC §7.2).
  const lyrics = req.instrumental ? "" : req.lyrics || "";

  // Style Influence -> CFG/guidance scale where supported. Turbo (Juno XL
  // Fast) is the no-CFG path, so guidance is ignored/disabled there.
  // ACE-Step's documented guidance knob is `guidance_scale`; we map the
  // 0-100 slider onto a conventional 1.0–15.0 range.
  const styleInfluence = clamp(req.styleInfluence ?? 50, 0, 100);
  const guidanceScale = 1 + (styleInfluence / 100) * 14;

  // Weirdness is primarily LOCAL metadata (DESIGN_DOC §9.2). We implement it
  // as seed variation: high weirdness forces a random seed even if the user
  // provided one. There is no direct ACE-Step "weirdness" parameter.
  const weirdness = clamp(req.weirdness ?? 50, 0, 100);
  const useRandomSeed = req.seed == null || weirdness > 75;

  const payload: Record<string, unknown> = {
    // ACE-Step model selector value, e.g. "acestep-v15-xl-sft"
    model: preset.aceModel,
    task_type: taskType,
    prompt,
    lyrics,
    vocal_language: req.vocalLanguage || "en",
    audio_duration: req.duration ?? 120,
    inference_steps: preset.inferenceSteps,
    thinking: THINKING_TASKS.includes(taskType),
    seed: useRandomSeed ? -1 : req.seed,
    use_random_seed: useRandomSeed,
  };

  if (preset.cfgEnabled) {
    payload.guidance_scale = round1(guidanceScale);
  }
  if (req.bpm != null) payload.bpm = req.bpm;
  if (req.key) payload.key_scale = req.key;
  if (req.timeSignature) payload.time_signature = req.timeSignature;
  if (req.srcAudioPath) payload.src_audio_path = req.srcAudioPath;
  if (req.referenceAudioPath) payload.reference_audio_path = req.referenceAudioPath;
  if (taskType === "repaint") {
    payload.repainting_start = req.repaintStart ?? 0;
    payload.repainting_end = req.repaintEnd ?? (req.duration ?? 30);
  }
  return payload;
}

/** Normalize whatever ACE-Step /query_result returns into Juno statuses. */
export function normalizeAceStatus(raw: any): {
  status: GenerationStatus;
  audioPath?: string;
  error?: string;
} {
  const s = String(
    raw?.status ?? raw?.state ?? raw?.task_status ?? ""
  ).toLowerCase();
  const audioPath =
    raw?.audio_path ||
    raw?.result?.audio_path ||
    raw?.result?.path ||
    (Array.isArray(raw?.audio_paths) ? raw.audio_paths[0] : undefined) ||
    (Array.isArray(raw?.result?.audio_paths) ? raw.result.audio_paths[0] : undefined);

  if (["succeeded", "success", "done", "finished", "completed"].includes(s) || audioPath) {
    return { status: "succeeded", audioPath };
  }
  if (["failed", "error", "cancelled", "canceled"].includes(s)) {
    return {
      status: "failed",
      error: raw?.error || raw?.message || "ACE-Step task failed",
    };
  }
  if (["running", "processing", "in_progress", "generating"].includes(s)) {
    return { status: "running" };
  }
  return { status: "queued" };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
