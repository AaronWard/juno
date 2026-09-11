/** Central configuration for the Juno proxy. All values come from env with
 *  container-friendly defaults matching docker-compose.yml. */
import path from "path";
import { TaskType } from "./types";

/** Model name from either a bare name or an absolute path. ACE-Step keys its
 *  model-code sync and slot routing on the bare checkpoint NAME, so we always
 *  talk to it with names (the entrypoint symlinks /models/* into checkpoints/). */
const nameOf = (p: string) => path.basename(p.replace(/[\\/]+$/, ""));

const TASKS_TURBO_SFT: TaskType[] = ["text2music", "cover", "repaint"];
const TASKS_BASE: TaskType[] = ["text2music", "cover", "repaint", "lego", "extract", "complete"];

export const config = {
  /** Port the Juno web/proxy server listens on. */
  webPort: Number(process.env.JUNO_WEB_PORT || 3000),
  /** Base URL of the local ACE-Step API server. */
  aceApiUrl: process.env.JUNO_ACE_API_URL || "http://127.0.0.1:8001",
  /** Host-mounted storage roots. */
  outputDir: process.env.JUNO_OUTPUT_DIR || "/outputs",
  uploadDir: process.env.JUNO_UPLOAD_DIR || "/uploads",
  dataDir: process.env.JUNO_DATA_DIR || "/data",
  modelDir: process.env.JUNO_MODEL_DIR || "/models",

  /** ACE-Step process working directory (supervisord `directory=`).
   *  ACE-Step rejects absolute audio paths, so source/reference audio is
   *  symlinked into <aceWorkDir>/juno_audio/ and submitted RELATIVE. */
  aceWorkDir: process.env.JUNO_ACE_WORKDIR || "/app/ACE-Step-1.5",

  /** supervisord program names (see supervisord.conf). */
  aceProgram: process.env.JUNO_ACE_PROGRAM || "acestep",
  midiProgram: process.env.JUNO_MIDI_PROGRAM || "muscriptor",

  /** 5Hz LM backend. MUST be sent on every /release_task: ACE-Step's
   *  per-request default is "vllm", which wins over the env var when the LM
   *  lazy-loads. "pt" is the correct choice on Blackwell without flash-attn
   *  (nano-vllm emits corrupted codes there — ACE-Step #135). */
  //  Deliberately NOT read from ACESTEP_LM_BACKEND: older compose files set
  //  that to "vllm". Opt in with JUNO_LM_BACKEND=vllm (supervisord passes
  //  the same value to ACE-Step, so both sides always agree).
  lmBackend: (process.env.JUNO_LM_BACKEND || "pt").toLowerCase(),

  /** 5Hz LM checkpoint NAME (resolved under ACE-Step's checkpoints dir). */
  lmModel: nameOf(process.env.ACESTEP_LM_MODEL_PATH || "acestep-5Hz-lm-4B"),

  /** Whether creative tasks send `thinking: true` (5Hz LM code generation).
   *  JUNO_THINKING=false bypasses the LM entirely (pure DiT) — the key A/B
   *  test when generations sound like noise. */
  lmThinking: String(process.env.JUNO_THINKING ?? "true").toLowerCase() !== "false",

  /** Model init (DiT + LM load) can take several minutes on first run. */
  initTimeoutMs: Number(process.env.JUNO_INIT_TIMEOUT_MS || 20 * 60 * 1000),

  /** Where finished generations are copied for the Library. */
  get libraryDir() {
    return path.join(this.outputDir, "library");
  },
  /** Transcribed / edited MIDI files. */
  get midiDir() {
    return path.join(this.outputDir, "midi");
  },
  /** Audio uploaded straight into the MIDI tab (not added to the Library). */
  get midiSourceDir() {
    return path.join(this.uploadDir, "midi-src");
  },

  /** MuScriptor transcription server (started on demand by the proxy). */
  midiApiUrl: process.env.JUNO_MIDI_API_URL || "http://127.0.0.1:8002",
  /** File the muscriptor supervisord command reads its model size from. */
  get midiModelFile() {
    return path.join(this.dataDir, "muscriptor-model");
  },
  midiLogFile: process.env.JUNO_MIDI_LOG || "/outputs/cache/muscriptor.log",
  /** First start downloads weights; allow plenty of time. */
  midiStartTimeoutMs: Number(process.env.JUNO_MIDI_START_TIMEOUT_MS || 15 * 60 * 1000),

  /** Path to the built React frontend (inside the Docker image). */
  webDist: process.env.JUNO_WEB_DIST || path.resolve(__dirname, "../../web/dist"),

  /** Model preset table. Exactly three XL presets are exposed to the UI.
   *  Juno keeps ONE DiT resident (slot 1) and swaps it through its own
   *  serialized queue — three XL DiTs (~9 GB each) plus the 4B LM do not fit
   *  in 32 GB together. */
  presets: {
    "juno-xl-quality": {
      id: "juno-xl-quality",
      label: "Juno XL Quality",
      aceModel: "acestep-v15-xl-sft",
      ditPath: "/models/acestep-v15-xl-sft",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,
      inferenceSteps: 50,
      cfgEnabled: true,
      guidanceScale: 7.0,
      guidanceMin: 5.0,
      guidanceMax: 9.0,
      shift: 3.0,
      inferMethod: "ode",
      // ADG is documented as BASE-ONLY. Sending it to SFT was a bug.
      useAdg: false,
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,
      supportedTasks: TASKS_TURBO_SFT,
      description: "Default final-quality preset",
    },
    "juno-xl-fast": {
      id: "juno-xl-fast",
      label: "Juno XL Fast",
      aceModel: "acestep-v15-xl-turbo",
      ditPath: "/models/acestep-v15-xl-turbo",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,
      inferenceSteps: 8,
      // Turbo bakes guidance into distillation; ACE forces guidance to 1.0.
      cfgEnabled: false,
      guidanceScale: 1.0,
      guidanceMin: 1.0,
      guidanceMax: 1.0,
      shift: 3.0,
      inferMethod: "ode",
      useAdg: false,
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,
      supportedTasks: TASKS_TURBO_SFT,
      description: "Fast preview preset",
    },
    "juno-xl-studio": {
      id: "juno-xl-studio",
      label: "Juno XL Studio",
      aceModel: "acestep-v15-xl-base",
      ditPath: "/models/acestep-v15-xl-base",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,
      // Upstream's Gradio default for pure base is 32; 50 is a bit better.
      inferenceSteps: 50,
      cfgEnabled: true,
      guidanceScale: 7.0,
      guidanceMin: 5.0,
      guidanceMax: 9.0,
      shift: 3.0,
      inferMethod: "ode",
      // ADG is valid on base but slower; off by default (JUNO_STUDIO_ADG=true).
      useAdg: String(process.env.JUNO_STUDIO_ADG || "false").toLowerCase() === "true",
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,
      supportedTasks: TASKS_BASE,
      description: "Advanced editing and Studio preset",
    },
  } as const,
};

export type PresetId = keyof typeof config.presets;
export type Preset = (typeof config.presets)[PresetId];

export function presetByAceModel(aceModel?: string | null): Preset | undefined {
  if (!aceModel) return undefined;
  const n = nameOf(aceModel);
  return Object.values(config.presets).find((p) => p.aceModel === n);
}
