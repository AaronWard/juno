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
      inferenceSteps: 50,
      cfgEnabled: true,
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
      cfgEnabled: false,
      description: "Fast preview preset",
    },
    "juno-xl-studio": {
      id: "juno-xl-studio",
      label: "Juno XL Studio",
      aceModel: "acestep-v15-xl-base",
      ditPath: "/models/acestep-v15-xl-base",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1,
      inferenceSteps: 50,
      cfgEnabled: true,
      description: "Advanced editing and Studio preset",
    },
  } as const,
};

export type PresetId = keyof typeof config.presets;
