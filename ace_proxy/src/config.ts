/** Central configuration for the Juno proxy. All values come from env with
 *  container-friendly defaults matching docker-compose.yml. */
import path from "path";

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
   *  ACE-Step rejects absolute audio paths ("absolute audio file paths are
   *  not allowed"), so source/reference audio is symlinked into
   *  <aceWorkDir>/juno_audio/ and submitted as a path RELATIVE to this dir. */
  aceWorkDir: process.env.JUNO_ACE_WORKDIR || "/app/ACE-Step-1.5",

  /** 5Hz LM backend sent to ACE-Step /v1/init.
   *  "pt"   = HuggingFace Transformers (correct output; the right choice
   *           on torch 2.10 / Blackwell / no flash-attn).
   *  "vllm" = nano-vllm (faster, but emits CORRUPTED audio codes without a
   *           working flash-attn on sm_120 + torch 2.10 — ACE-Step #135). */
  lmBackend: process.env.ACESTEP_LM_BACKEND || "pt",

  /** Whether creative tasks send `thinking: true` (5Hz LM code generation).
   *  Set JUNO_THINKING=false in the environment to bypass the LM entirely
   *  (pure DiT text2music) — the key A/B test when generations sound like
   *  noise: if audio becomes real music with this off, the LM (nano-vllm
   *  SDPA fallback) is corrupting the codes, not the DiT. */
  lmThinking:
    String(process.env.JUNO_THINKING ?? "true").toLowerCase() !== "false",

  /** Where finished generations are copied for the Library. */
  get libraryDir() {
    return path.join(this.outputDir, "library");
  },

  /** Path to the built React frontend (inside the Docker image). */
  webDist:
    process.env.JUNO_WEB_DIST || path.resolve(__dirname, "../../web/dist"),

  /** Model preset table. Exactly three XL presets are exposed to the UI.
   *  All presets target slot 1 (hot-swap) — see the VRAM note in the repo. */
  presets: {
    "juno-xl-quality": {
      id: "juno-xl-quality",
      label: "Juno XL Quality",
      aceModel: "acestep-v15-xl-sft",
      ditPath: "/models/acestep-v15-xl-sft",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,

      // XL-SFT quality path. Keep this explicit; do not let API defaults
      // fall back to Turbo-ish 8-step behavior.
      inferenceSteps: 50,

      // SFT/Base CFG controls.
      cfgEnabled: true,
      guidanceScale: 7.0,
      guidanceMin: 5.0,
      guidanceMax: 9.0,
      shift: 3.0,
      inferMethod: "ode",
      useAdg: true,
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,

      description: "Default final-quality preset",
    },
    "juno-xl-fast": {
      id: "juno-xl-fast",
      label: "Juno XL Fast",
      aceModel: "acestep-v15-xl-turbo",
      ditPath: "/models/acestep-v15-xl-turbo",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,

      // Turbo is distilled and should stay fast.
      inferenceSteps: 8,

      // Turbo does not use CFG, but ACE docs recommend shift=3.0.
      cfgEnabled: false,
      guidanceScale: 1.0,
      guidanceMin: 1.0,
      guidanceMax: 1.0,
      shift: 3.0,
      inferMethod: "ode",
      useAdg: false,
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,

      description: "Fast preview preset",
    },
    "juno-xl-studio": {
      id: "juno-xl-studio",
      label: "Juno XL Studio",
      aceModel: "acestep-v15-xl-base",
      ditPath: "/models/acestep-v15-xl-base",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,

      // Base benefits from more steps than SFT/Turbo.
      inferenceSteps: 50,

      cfgEnabled: true,
      guidanceScale: 7.0,
      guidanceMin: 5.0,
      guidanceMax: 9.0,
      shift: 3.0,
      inferMethod: "ode",

      // Leave ADG off while debugging the gibberish/noise path.
      // ACE docs say ADG is base-only, but this makes Studio less risky first.
      useAdg: true,

      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,

      description: "Advanced editing and Studio preset",
    },
  } as const,
};

export type PresetId = keyof typeof config.presets;
