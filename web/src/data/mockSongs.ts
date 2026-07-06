/** Song data model (DESIGN_DOC §24.1).
 *
 *  Mock data has been removed: Juno now starts from a clean slate and only
 *  renders what is actually stored in the proxy database (/data/juno-db.json).
 *  MOCK_SONGS is kept as an empty export for backwards compatibility.
 */

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
  comments?: SongComment[];
  createdAt: string;
  updatedAt: string;
  sourceSongId?: string;
  aceTaskId?: string;
  generationStatus?: GenerationStatus;
  generationError?: string;
  trashed?: boolean;
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
    taskType?: "text2music" | "cover" | "repaint" | "lego" | "extract" | "complete";
  };
}

/** No mock songs — the library is populated only by real user data. */
export const MOCK_SONGS: Song[] = [];
