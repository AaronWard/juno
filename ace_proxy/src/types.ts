/** Shared types for the Juno proxy. Mirrors DESIGN_DOC.md §24. */

export type PresetName = "juno-xl-quality" | "juno-xl-fast" | "juno-xl-studio";
export type AceModelName =
  | "acestep-v15-xl-sft"
  | "acestep-v15-xl-turbo"
  | "acestep-v15-xl-base";

export type TaskType =
  | "text2music"
  | "cover"
  | "repaint"
  | "lego"
  | "extract"
  | "complete";

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export interface Song {
  id: string;
  title: string;
  description: string;
  lyrics?: string;
  styles: string[];
  model: PresetName;
  aceModel: AceModelName;
  type:
    | "song"
    | "upload"
    | "cover"
    | "remix"
    | "extended"
    | "mashup"
    | "sample"
    | "reversed"
    | "cropped"
    | "replacement";
  durationSeconds: number;
  coverArtUrl?: string;
  audioUrl?: string;
  localAudioPath?: string;
  workspaceId?: string;
  playlistIds: string[];
  liked: boolean;
  disliked: boolean;
  public: boolean;
  playCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  sourceSongId?: string;
  aceTaskId?: string;
  generationStatus?: "idle" | GenerationStatus;
  generationError?: string;
  trashed?: boolean;
  metadata: {
    vocalGender?: "male" | "female" | "none";
    weirdness: number;
    styleInfluence: number;
    instrumental: boolean;
    bpm?: number;
    key?: string;
    timeSignature?: string;
    seed?: number;
    taskType?: TaskType;
  };
}

export interface GenerationTask {
  id: string;
  aceTaskId: string;
  songId: string;
  status: GenerationStatus;
  model: PresetName;
  aceModel: AceModelName;
  requestPayload: unknown;
  resultAudioPath?: string;
  localAudioPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Payload accepted by POST /api/generate — the Juno Create form. */
export interface GenerateRequest {
  taskType?: TaskType;
  model?: PresetName;
  prompt?: string;
  styles?: string[];
  lyrics?: string;
  instrumental?: boolean;
  vocalLanguage?: string;
  vocalGender?: "male" | "female" | "none";
  duration?: number;
  bpm?: number;
  key?: string;
  timeSignature?: string;
  seed?: number;
  weirdness?: number; // 0-100, local metadata + seed/prompt variation
  styleInfluence?: number; // 0-100, mapped to CFG/guidance where supported
  exclude?: string;
  title?: string;
  workspaceId?: string;
  srcAudioPath?: string; // cover / repaint source
  referenceAudioPath?: string; // "Use as Inspiration"
  repaintStart?: number;
  repaintEnd?: number;
  sourceSongId?: string;
}
