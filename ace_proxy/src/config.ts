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

  /** Where finished generations are copied for the Library. */
  get libraryDir() {
    return path.join(this.outputDir, "library");
  },

  /** Path to the built React frontend (inside the Docker image). */
  webDist:
    process.env.JUNO_WEB_DIST || path.resolve(__dirname, "../../web/dist"),

  /** Model preset table. Exactly three XL presets are exposed to the UI.
   *
   *  VRAM NOTE: each XL DiT is ~11 GB in bf16 and the 4B LM needs ~9-10 GB,
   *  so a 32 GB GPU can hold exactly ONE DiT + the LM. All presets therefore
   *  target slot 1: switching presets re-initializes the primary slot
   *  (hot-swap) instead of keeping three DiTs resident, which OOMs.
   *  docker-compose must NOT set ACESTEP_CONFIG_PATH2/3 for the same
   *  reason. */
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
      slot: 1, // hot-swapped into the primary slot (see VRAM NOTE)
      inferenceSteps: 8,
      cfgEnabled: false, // Turbo is the no-CFG fast path
      description: "Fast preview preset",
    },
    "juno-xl-studio": {
      id: "juno-xl-studio",
      label: "Juno XL Studio",
      aceModel: "acestep-v15-xl-base",
      ditPath: "/models/acestep-v15-xl-base",
      lmPath: "/models/acestep-5Hz-lm-4B",
      slot: 1, // hot-swapped into the primary slot (see VRAM NOTE)
      inferenceSteps: 50,
      cfgEnabled: true,
      description: "Advanced editing and Studio preset",
    },
  } as const,
};

export type PresetId = keyof typeof config.presets;
