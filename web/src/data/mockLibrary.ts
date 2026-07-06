/** Library record types.
 *
 *  Mock collections have been removed — the app starts from a clean slate
 *  and everything shown comes from the proxy database. The empty MOCK_*
 *  exports remain only so stale imports don't break during migration.
 */

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
  url: string;
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

export const MOCK_WORKSPACES: Workspace[] = [];
export const MOCK_PLAYLISTS: Playlist[] = [];
export const MOCK_VOICES: Voice[] = [];
export const MOCK_STYLE_PRESETS: StylePreset[] = [];
export const MOCK_LYRICS: LyricDoc[] = [];
export const MOCK_HOOKS: Hook[] = [];
export const MOCK_COVER_ART: CoverArt[] = [];
export const MOCK_PROJECTS: StudioProject[] = [];
export const MOCK_HISTORY: HistoryEvent[] = [];
