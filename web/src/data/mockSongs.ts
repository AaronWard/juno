/** Song data model (DESIGN_DOC §24.1) plus mock starting data so the app is
 *  fully explorable before the first real generation completes. */

export type PresetName = "juno-xl-quality" | "juno-xl-fast" | "juno-xl-studio";
export type AceModelName =
  | "acestep-v15-xl-sft"
  | "acestep-v15-xl-turbo"
  | "acestep-v15-xl-base";

export type SongType =
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

export type GenerationStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

export interface Song {
  id: string;
  title: string;
  description: string;
  lyrics?: string;
  styles: string[];
  model: PresetName;
  aceModel: AceModelName;
  type: SongType;
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
  generationStatus?: GenerationStatus;
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
    taskType?: "text2music" | "cover" | "repaint" | "lego" | "extract" | "complete";
  };
}

const day = 24 * 60 * 60 * 1000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

function song(partial: Partial<Song> & Pick<Song, "id" | "title">): Song {
  return {
    description: "",
    styles: [],
    model: "juno-xl-quality",
    aceModel: "acestep-v15-xl-sft",
    type: "song",
    durationSeconds: 180,
    playlistIds: [],
    liked: false,
    disliked: false,
    public: false,
    playCount: 0,
    commentCount: 0,
    createdAt: iso(day),
    updatedAt: iso(day),
    workspaceId: "ws_my",
    generationStatus: "succeeded",
    metadata: { weirdness: 50, styleInfluence: 50, instrumental: false },
    ...partial,
  };
}

export const MOCK_SONGS: Song[] = [
  song({
    id: "mock_gods_promise",
    title: "God's Promise",
    description:
      "The piece is an instrumental ambient track with a slow tempo, discordant textures and dynamic instrumentation.",
    styles: ["slow ambient", "discordant", "italian pop", "dynamic instrumentation", "urban"],
    type: "cover",
    durationSeconds: 306,
    liked: true,
    public: true,
    playCount: 42,
    commentCount: 2,
    sourceSongId: "mock_night_choir",
    metadata: { weirdness: 50, styleInfluence: 60, instrumental: true, taskType: "cover" },
    createdAt: iso(2 * day),
    updatedAt: iso(day / 2),
  }),
  song({
    id: "mock_late_signal",
    title: "Late Signal",
    description: "Downtempo electronic with a distant radio-voice hook and tape hiss.",
    styles: ["downtempo", "electronic", "lo-fi", "cinematic"],
    model: "juno-xl-fast",
    aceModel: "acestep-v15-xl-turbo",
    durationSeconds: 214,
    playCount: 18,
    lyrics: "[Verse]\nStatic on the late line\nHold the signal, hold the light",
    createdAt: iso(3 * day),
    updatedAt: iso(3 * day),
  }),
  song({
    id: "mock_soft_static",
    title: "Soft Static",
    description: "Instrumental dream-pop wash, ethereal pads, no percussion.",
    styles: ["dream pop", "ethereal pad", "instrumental"],
    type: "song",
    durationSeconds: 187,
    liked: true,
    playCount: 31,
    metadata: { weirdness: 35, styleInfluence: 55, instrumental: true },
    createdAt: iso(4 * day),
    updatedAt: iso(2 * day),
  }),
  song({
    id: "mock_long_horizon",
    title: "The Long Horizon",
    description: "Slow-build post-rock with brass swells and a spoken outro.",
    styles: ["post-rock", "cinematic", "brass"],
    model: "juno-xl-studio",
    aceModel: "acestep-v15-xl-base",
    durationSeconds: 412,
    public: true,
    playCount: 9,
    commentCount: 1,
    lyrics: "[Outro]\nWe walk until the map runs out",
    createdAt: iso(6 * day),
    updatedAt: iso(6 * day),
  }),
  song({
    id: "mock_night_choir",
    title: "Night Choir",
    description: "Layered vocal harmonies over sparse piano; melancholic and warm.",
    styles: ["choral", "piano", "melancholic"],
    durationSeconds: 245,
    playCount: 56,
    liked: true,
    lyrics: "[Chorus]\nSing it low, sing it slow\nEvery window holds a glow",
    metadata: { weirdness: 40, styleInfluence: 65, instrumental: false, vocalGender: "female" },
    createdAt: iso(8 * day),
    updatedAt: iso(8 * day),
  }),
  song({
    id: "mock_glass_weather",
    title: "Glass Weather",
    description: "Cover of Night Choir with icy synth textures and half-time drums.",
    styles: ["synthwave", "half-time", "icy"],
    type: "cover",
    durationSeconds: 233,
    sourceSongId: "mock_night_choir",
    playCount: 12,
    metadata: { weirdness: 60, styleInfluence: 70, instrumental: false, taskType: "cover" },
    createdAt: iso(5 * day),
    updatedAt: iso(5 * day),
  }),
  song({
    id: "mock_slow_bloom",
    title: "Slow Bloom",
    description: "Currently generating — ambient bloom with granular textures.",
    styles: ["ambient", "granular", "slow"],
    durationSeconds: 240,
    generationStatus: "running",
    aceTaskId: "mock_ace_task_running",
    metadata: { weirdness: 55, styleInfluence: 45, instrumental: true, taskType: "text2music" },
    createdAt: iso(day / 12),
    updatedAt: iso(day / 24),
  }),
  song({
    id: "mock_neon_prayer",
    title: "Neon Prayer",
    description: "Generation failed — GPU ran out of memory during the LM pass.",
    styles: ["gospel", "neon", "trap"],
    model: "juno-xl-fast",
    aceModel: "acestep-v15-xl-turbo",
    durationSeconds: 0,
    generationStatus: "failed",
    generationError: "ACE-Step task failed: CUDA out of memory (mock)",
    createdAt: iso(day / 6),
    updatedAt: iso(day / 6),
  }),
  song({
    id: "mock_ambient_pad_upload",
    title: "ambient_pad",
    description: "Uploaded audio — ambient_pad.wav",
    styles: [],
    type: "upload",
    durationSeconds: 94,
    workspaceId: "ws_my",
    playCount: 4,
    generationStatus: "idle",
    createdAt: iso(1.5 * day),
    updatedAt: iso(1.5 * day),
  }),
];
