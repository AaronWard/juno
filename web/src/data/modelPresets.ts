/** Juno model presets — the ONLY three presets exposed in the UI.
 *
 *  The app targets a 32GB-VRAM machine and uses ACE-Step XL models only.
 *  Smaller ACE-Step models are intentionally hidden; a developer can add
 *  hidden presets by appending to HIDDEN_DEV_PRESETS below and to the
 *  proxy's config.ts (see docs/DEVELOPMENT.md). They will never appear in
 *  the model selector unless moved into MODEL_PRESETS.
 */
export type PresetId = "juno-xl-quality" | "juno-xl-fast" | "juno-xl-studio";

export interface ModelPreset {
  id: PresetId;
  label: string;
  aceModel: "acestep-v15-xl-sft" | "acestep-v15-xl-turbo" | "acestep-v15-xl-base";
  lm: "acestep-5Hz-lm-4B";
  inferenceSteps: number;
  cfgEnabled: boolean;
  description: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "juno-xl-quality",
    label: "Juno XL Quality",
    aceModel: "acestep-v15-xl-sft",
    lm: "acestep-5Hz-lm-4B",
    inferenceSteps: 50,
    cfgEnabled: true,
    description: "Default final-quality preset",
  },
  {
    id: "juno-xl-fast",
    label: "Juno XL Fast",
    aceModel: "acestep-v15-xl-turbo",
    lm: "acestep-5Hz-lm-4B",
    inferenceSteps: 8,
    cfgEnabled: false, // Turbo is the no-CFG fast path
    description: "Fast preview preset",
  },
  {
    id: "juno-xl-studio",
    label: "Juno XL Studio",
    aceModel: "acestep-v15-xl-base",
    lm: "acestep-5Hz-lm-4B",
    inferenceSteps: 50,
    cfgEnabled: true,
    description: "Advanced editing and Studio preset",
  },
];

export const DEFAULT_PRESET: PresetId = "juno-xl-quality";

/** Hidden developer config — never rendered in the UI. */
export const HIDDEN_DEV_PRESETS: ModelPreset[] = [];

export function presetLabel(id: string): string {
  return MODEL_PRESETS.find((p) => p.id === id)?.label ?? id;
}
