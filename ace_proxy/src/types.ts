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

export interface SongComment {
  id: string;
  at: string;
  text: string;
}

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
  comments?: SongComment[];
  createdAt: string;
  updatedAt: string;
  sourceSongId?: string;
  aceTaskId?: string;
  generationStatus?: "idle" | GenerationStatus;
  generationError?: string;
  /** Human-readable stage while queued/running ("Loading Juno XL Quality…"). */
  generationStage?: string;
  /** 0–1 progress reported by ACE-Step while running. */
  generationProgress?: number;
  /** The original Create-form request, kept so Retry can resubmit it. */
  generationRequest?: GenerateRequest;
  trashed?: boolean;
  /** ISO timestamp of when the song was moved to trash (14-day TTL). */
  trashedAt?: string;
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
  /** Empty until the job has been handed to ACE-Step (model may still be loading). */
  aceTaskId: string;
  songId: string;
  status: GenerationStatus;
  model: PresetName;
  aceModel: AceModelName;
  requestPayload: unknown;
  form?: GenerateRequest;
  resultAudioPath?: string;
  localAudioPath?: string;
  error?: string;
  stage?: string;
  progress?: number;
  /** Consecutive "succeeded but no file yet" polls. */
  emptySuccessPolls?: number;
  submittedAt?: string;
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
  /** Cover: how closely to follow the source (0–1, ACE audio_cover_strength). */
  coverStrength?: number;
  /** Lego/extract: which instrument track to generate or isolate. */
  trackName?: string;
  sourceSongId?: string;
  /** Song type to record (defaults from taskType). */
  songType?: Song["type"];
}

/* ------------------------------------------------------------------ */
/* MIDI transcription (MuScriptor)                                     */
/* ------------------------------------------------------------------ */

export type MidiStatus = "queued" | "starting" | "running" | "succeeded" | "failed";

export interface MidiRecord {
  id: string;
  title: string;
  status: MidiStatus;
  /** 0–1 chunk progress while running. */
  progress: number;
  stage?: string;
  error?: string;
  sourceSongId?: string;
  /** Absolute container path of the audio that was transcribed. */
  sourceAudioPath: string;
  /** Browser URL for the source audio (for A/B playback). */
  sourceAudioUrl?: string;
  instruments: string[];
  modelSize: string;
  /** Original transcription (.mid) as produced by MuScriptor. */
  midiPath?: string;
  /** Beat-quantized copy, when a steady tempo was detected. */
  quantizedMidiPath?: string;
  /** User-edited version saved from the piano roll. */
  editedMidiPath?: string;
  noteCount?: number;
  durationSeconds?: number;
  beatGrid?: { bpm: number; beats_per_bar: number; first_downbeat: number; onset_delay: number } | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Studio / settings                                                   */
/* ------------------------------------------------------------------ */

export interface StudioProject {
  id: string;
  name: string;
  trackCount: number;
  tracks: unknown[];
  clips: unknown[];
  region: { start: number; end: number };
  createdAt: string;
  updatedAt: string;
}

export interface JunoSettings {
  /** Unload ACE-Step models after this many idle minutes (0 = never). */
  aceIdleUnloadMinutes: number;
  /** Start loading the preset picked in Create when nothing is running. */
  preloadOnSelect: boolean;
  /** Stop the MuScriptor server after this many idle minutes (0 = never). */
  midiIdleStopMinutes: number;
  /** small | medium | large */
  midiModelSize: "small" | "medium" | "large";
}

export const DEFAULT_SETTINGS: JunoSettings = {
  aceIdleUnloadMinutes: 30,
  preloadOnSelect: true,
  midiIdleStopMinutes: 10,
  midiModelSize: "medium",
};
