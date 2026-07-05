/** Mock Library collections so every tab is populated on first launch. */

const day = 24 * 60 * 60 * 1000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

export interface Workspace {
  id: string;
  name: string;
  songIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  songIds: string[];
  coverArtUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Voice {
  id: string;
  name: string;
  sourceAudioId?: string;
  description?: string;
  gender?: "male" | "female" | "none";
  createdAt: string;
  updatedAt: string;
}

export interface StylePreset {
  id: string;
  name: string;
  styles: string[];
  description?: string;
  liked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LyricDoc {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Hook {
  id: string;
  title: string;
  durationSeconds: number;
  liked: boolean;
  createdAt: string;
}

export interface CoverArt {
  id: string;
  title: string;
  url: string; // gradient descriptor rendered locally
  createdAt: string;
}

export interface HistoryEvent {
  id: string;
  at: string;
  event: string;
}

export interface StudioProject {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export const MOCK_WORKSPACES: Workspace[] = [
  {
    id: "ws_my",
    name: "My Workspace",
    songIds: [
      "mock_gods_promise",
      "mock_late_signal",
      "mock_soft_static",
      "mock_slow_bloom",
      "mock_neon_prayer",
      "mock_ambient_pad_upload",
    ],
    createdAt: iso(30 * day),
    updatedAt: iso(day / 24),
  },
  {
    id: "ws_film",
    name: "Film Sketches",
    songIds: ["mock_long_horizon", "mock_night_choir", "mock_glass_weather"],
    createdAt: iso(20 * day),
    updatedAt: iso(2 * day),
  },
];

export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: "pl_ambient",
    name: "Ambient Nights",
    songIds: ["mock_gods_promise", "mock_soft_static", "mock_slow_bloom"],
    createdAt: iso(12 * day),
    updatedAt: iso(day),
  },
  {
    id: "pl_demos",
    name: "Demo Reel",
    songIds: ["mock_late_signal", "mock_long_horizon"],
    createdAt: iso(9 * day),
    updatedAt: iso(3 * day),
  },
];

export const MOCK_VOICES: Voice[] = [
  {
    id: "voice_dawn",
    name: "Dawn Alto",
    sourceAudioId: "mock_ambient_pad_upload",
    description: "Warm alto, close-mic, soft consonants",
    gender: "female",
    createdAt: iso(15 * day),
    updatedAt: iso(15 * day),
  },
  {
    id: "voice_gravel",
    name: "Gravel Baritone",
    description: "Low, breathy, spoken-word friendly",
    gender: "male",
    createdAt: iso(11 * day),
    updatedAt: iso(4 * day),
  },
];

export const MOCK_STYLE_PRESETS: StylePreset[] = [
  {
    id: "style_ambient_disc",
    name: "Slow Ambient Discordance",
    styles: ["slow ambient", "discordant", "ethereal pad", "urban"],
    description: "The house sound of Juno demos",
    liked: true,
    createdAt: iso(14 * day),
    updatedAt: iso(2 * day),
  },
  {
    id: "style_neon",
    name: "Neon Gospel",
    styles: ["gospel", "neon", "trap", "wide chorus"],
    liked: false,
    createdAt: iso(10 * day),
    updatedAt: iso(10 * day),
  },
  {
    id: "style_score",
    name: "Quiet Score",
    styles: ["cinematic", "piano", "strings", "slow build"],
    liked: false,
    createdAt: iso(7 * day),
    updatedAt: iso(7 * day),
  },
];

export const MOCK_LYRICS: LyricDoc[] = [
  {
    id: "lyr_faith",
    title: "Keeping Faith",
    text: "[Verse]\nThrough the static and the doubt\nI keep a small light burning out\n\n[Chorus]\nHold on, hold on\nThe signal finds us before dawn",
    createdAt: iso(13 * day),
    updatedAt: iso(6 * day),
  },
  {
    id: "lyr_glass",
    title: "Glass Weather (draft)",
    text: "[Verse]\nCold fronts written on the pane\nEvery forecast says your name",
    createdAt: iso(5 * day),
    updatedAt: iso(5 * day),
  },
  {
    id: "lyr_horizon",
    title: "Horizon Outro",
    text: "[Outro]\nWe walk until the map runs out\nAnd draw the rest ourselves",
    createdAt: iso(6 * day),
    updatedAt: iso(6 * day),
  },
];

export const MOCK_HOOKS: Hook[] = [
  { id: "hook_bloom", title: "Bloom riser (4 bars)", durationSeconds: 9, liked: true, createdAt: iso(3 * day) },
  { id: "hook_choir", title: "Night Choir stab", durationSeconds: 6, liked: false, createdAt: iso(8 * day) },
  { id: "hook_bass", title: "Late Signal bass loop", durationSeconds: 12, liked: true, createdAt: iso(2 * day) },
];

export const MOCK_COVER_ART: CoverArt[] = [
  { id: "art_promise", title: "God's Promise art", url: "gradient:mock_gods_promise", createdAt: iso(2 * day) },
  { id: "art_signal", title: "Late Signal art", url: "gradient:mock_late_signal", createdAt: iso(3 * day) },
  { id: "art_static", title: "Soft Static art", url: "gradient:mock_soft_static", createdAt: iso(4 * day) },
  { id: "art_horizon", title: "Long Horizon art", url: "gradient:mock_long_horizon", createdAt: iso(6 * day) },
];

export const MOCK_PROJECTS: StudioProject[] = [
  { id: "proj_03", name: "Project 03", trackCount: 8, createdAt: iso(9 * day), updatedAt: iso(day / 3) },
  { id: "proj_score", name: "Quiet Score session", trackCount: 3, createdAt: iso(4 * day), updatedAt: iso(4 * day) },
];

export const MOCK_HISTORY: HistoryEvent[] = [
  { id: "h1", at: iso(day / 24), event: 'Created "God\'s Promise"' },
  { id: "h2", at: iso(day / 12), event: 'Uploaded "ambient_pad.wav"' },
  { id: "h3", at: iso(day / 8), event: 'Cropped "Late Signal"' },
  { id: "h4", at: iso(day / 6), event: 'Opened "Project 03" in Studio' },
  { id: "h5", at: iso(day / 4), event: 'Submitted ACE-Step task for "Late Signal"' },
  { id: "h6", at: iso(day / 3), event: 'Downloaded generated audio for "Soft Static"' },
];
