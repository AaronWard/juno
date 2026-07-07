/** Juno frontend API client.
 *
 *  The frontend talks ONLY to the local proxy under /api/* — never to the
 *  ACE-Step server directly. When the proxy is unreachable (e.g. running
 *  the frontend standalone in dev), callers fall back to local behavior.
 */
import { Song } from "../data/mockSongs";
import { Playlist, StylePreset, Voice, Workspace } from "../data/mockLibrary";

export interface HealthResponse {
  juno: string;
  aceStep: "ok" | "unavailable";
  modelPaths?: Record<string, string>;
  outputPath?: string;
  uploadPath?: string;
  dataPath?: string;
}

export interface ModelPresetStatus {
  id: string;
  label: string;
  aceModel: string;
  inferenceSteps: number;
  cfgEnabled: boolean;
  description: string;
  available: boolean;
  loaded: boolean;
}

export interface GeneratePayload {
  taskType?: string;
  model: string;
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
  weirdness?: number;
  styleInfluence?: number;
  exclude?: string;
  title?: string;
  workspaceId?: string;
  srcAudioPath?: string;
  referenceAudioPath?: string;
  repaintStart?: number;
  repaintEnd?: number;
  sourceSongId?: string;
}

/** Optional metadata sent alongside an audio upload so locally processed
 *  audio (Reverse, Crop, Speed, Sample, Mashup…) is saved as a proper,
 *  typed library row rather than a plain upload. */
export interface UploadMeta {
  title?: string;
  type?: Song["type"];
  description?: string;
  sourceSongId?: string;
  workspaceId?: string;
  durationSeconds?: number;
  styles?: string[];
  lyrics?: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const api = {
  health: () => json<HealthResponse>("/api/health"),

  models: () =>
    json<{ presets: ModelPresetStatus[]; aceStep: string }>("/api/models"),

  initModel: (model: string) =>
    json<{ ok: boolean; error?: string }>("/api/models/init", {
      method: "POST",
      body: JSON.stringify({ model }),
    }),

  /** Restart the ACE-Step process to free all GPU VRAM. Models lazy-load
   *  again on the next generation or explicit Initialize. */
  unloadModels: () =>
    json<{ ok: boolean; detail?: string; error?: string }>(
      "/api/models/unload",
      { method: "POST" }
    ),

  /** Submit a generation task. When ACE-Step rejects the task the proxy
   *  still records a failed Song row and returns it with ok:false. Only a
   *  transport failure (proxy unreachable) throws without a song. */
  generate: async (payload: GeneratePayload) => {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      taskId?: string;
      aceTaskId?: string;
      song?: Song;
      error?: string;
    };
    if (!res.ok && !body.song) {
      throw new Error(body.error || `${res.status} ${res.statusText}`);
    }
    return body as {
      ok: boolean;
      taskId?: string;
      aceTaskId?: string;
      song: Song;
      error?: string;
    };
  },

  queryTasks: (taskIds: string[]) =>
    json<{
      tasks: {
        taskId: string;
        songId: string;
        status: "queued" | "running" | "succeeded" | "failed";
        audioUrl?: string;
        error?: string;
      }[];
    }>("/api/tasks/query", {
      method: "POST",
      body: JSON.stringify({ taskIds }),
    }),

  library: () => json<any>("/api/library"),

  createWorkspace: (name: string) =>
    json<{ ok: boolean; workspace: Workspace }>("/api/library/workspace", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  createPlaylist: (name: string) =>
    json<{ ok: boolean; playlist: Playlist }>("/api/library/playlist", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  patchPlaylist: (
    id: string,
    patch: { name?: string; songIds?: string[]; coverArtUrl?: string }
  ) =>
    json<{ ok: boolean; playlist: Playlist }>(`/api/library/playlist/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  createStylePreset: (name: string, styles: string[]) =>
    json<{ ok: boolean; style: StylePreset }>("/api/library/style", {
      method: "POST",
      body: JSON.stringify({ name, styles }),
    }),

  createVoice: (voice: {
    name: string;
    gender?: Voice["gender"];
    description?: string;
    sourceAudioId?: string;
  }) =>
    json<{ ok: boolean; voice: Voice }>("/api/library/voice", {
      method: "POST",
      body: JSON.stringify(voice),
    }),

  saveSong: (song: Partial<Song>) =>
    json<{ ok: boolean; song: Song }>("/api/library/song", {
      method: "POST",
      body: JSON.stringify(song),
    }),

  patchSong: (id: string, patch: Partial<Song> & { trashed?: boolean }) =>
    json<{ ok: boolean; song: Song }>(`/api/library/song/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteSong: (id: string) =>
    json<{ ok: boolean }>(`/api/library/song/${id}`, { method: "DELETE" }),

  exportSongs: (songIds: string[]) =>
    json<{ ok: boolean; manifest: unknown; savedTo: string }>("/api/export", {
      method: "POST",
      body: JSON.stringify({ songIds }),
    }),

  upload: async (file: File, meta?: UploadMeta) => {
    const form = new FormData();
    form.append("file", file);
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (v == null) continue;
        form.append(k, k === "styles" ? JSON.stringify(v) : String(v));
      }
    }
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || "Upload failed");
    return body as { ok: boolean; asset: Song };
  },
};
