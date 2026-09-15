/** Juno frontend API client.
 *
 *  The frontend talks ONLY to the local proxy under /api/* — never to the
 *  ACE-Step server directly. When the proxy is unreachable (e.g. running
 *  the frontend standalone in dev), callers fall back to local behavior.
 */
import { Song } from "../data/mockSongs";
import { LyricDoc, Playlist, StudioProject, StylePreset, Voice, Workspace } from "../data/mockLibrary";

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

export interface JunoSettings {
  aceIdleUnloadMinutes: number;
  preloadOnSelect: boolean;
  midiIdleStopMinutes: number;
  midiModelSize: "small" | "medium" | "large";
}

export type AceActivity = "offline" | "starting" | "idle" | "loading" | "ready" | "generating" | "unloading";
export type MidiActivity = "stopped" | "starting" | "ready" | "transcribing" | "stopping" | "error";

export interface StatusResponse {
  juno: string;
  ace: {
    reachable: boolean;
    process: string;
    activity: AceActivity;
    loadedModel: string | null;
    loadedPreset: string | null;
    loadedLabel: string | null;
    /** Everything holding VRAM right now, including non-ACE engines. */
    residents?: { kind: string; label: string }[];
    llmLoaded: boolean;
    loadedLm: string | null;
    busy: { kind: "loading" | "unloading" | "starting"; model?: string; label?: string; since: string } | null;
    lastError: { message: string; at: string } | null;
    activeTasks: number;
    waitingTasks: number;
    idleUnloadAt: string | null;
    detail?: string;
  };
  midi: {
    activity: MidiActivity;
    reachable: boolean;
    process: string;
    modelSize: string | null;
    wantedSize: string;
    queued: number;
    currentJob: string | null;
    lastError: { message: string; at: string } | null;
    stopAt: string | null;
  };
  vram: { usedMb: number; totalMb: number; name?: string } | null;
  settings: JunoSettings;
  lmBackend: string;
  lmModel: string;
}

export interface MidiItem {
  id: string;
  title: string;
  status: "queued" | "starting" | "running" | "succeeded" | "failed";
  progress: number;
  stage?: string;
  error?: string;
  sourceSongId?: string;
  sourceAudioUrl?: string;
  instruments: string[];
  modelSize: string;
  noteCount?: number;
  durationSeconds?: number;
  beatGrid?: { bpm: number; beats_per_bar: number } | null;
  midiUrl?: string;
  originalMidiUrl?: string;
  quantizedMidiUrl?: string;
  edited: boolean;
  queuePosition: number;
  createdAt: string;
  updatedAt: string;
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
  coverStrength?: number;
  sourceFidelity?: number;
  coverStyleInfluence?: number;
  noFsq?: boolean;
  trackName?: string;
  songType?: Song["type"];
  sourceSongId?: string;
}

/** Optional metadata sent alongside an audio upload so locally processed
 *  audio (Reverse, Crop, Speed, Sample, Mashup…) is saved as a proper,
 *  typed library row rather than a plain upload. */
export interface UploadMeta {
  /** Lineage operation for the created song. Falls back to a mapping from
   *  `type` on the proxy when omitted. */
  operation?: string;
  /** Extra parents beyond sourceSongId (mashups have two). */
  sourceIds?: string[];
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

/** POST to /api/export and hand the resulting zip to the browser as a download.
 *  The proxy sets Content-Disposition, but we go via a blob so a failed export
 *  surfaces as a thrown error instead of navigating away to an error page. */
async function downloadExport(body: Record<string, unknown>, fallbackName: string): Promise<{ ok: true; filename: string; bytes: number }> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Export failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) detail = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }

  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari cancels an in-flight download if the URL dies too soon.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { ok: true, filename, bytes: blob.size };
}

export const api = {
  health: () => json<HealthResponse>("/api/health"),

  models: () =>
    json<{ presets: ModelPresetStatus[]; aceStep: string }>("/api/models"),

  status: () => json<StatusResponse>("/api/status"),

  /** Queue a model load; progress shows up in /api/status. */
  loadModel: (model: string) =>
    json<{ ok: boolean; error?: string }>("/api/models/load", {
      method: "POST",
      body: JSON.stringify({ model }),
    }),

  /** Restart ACE-Step to free VRAM. `force` cancels a running generation. */
  unloadModels: (force = false) =>
    json<{ ok: boolean; error?: string }>("/api/models/unload", {
      method: "POST",
      body: JSON.stringify({ force }),
    }),

  stopMidiServer: () => json<{ ok: boolean }>("/api/midi/server/stop", { method: "POST" }),

  patchSettings: (patch: Partial<JunoSettings>) =>
    json<JunoSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  retrySong: (id: string) =>
    json<{ ok: boolean; taskId?: string; song?: Song; error?: string }>(`/api/songs/${id}/retry`, { method: "POST" }),

  /* MIDI */
  midiList: () => json<{ items: MidiItem[]; instruments: string[] }>("/api/midi"),
  midiFromSong: (songId: string, opts: { instruments?: string[]; modelSize?: string } = {}) =>
    json<{ ok: boolean; item: MidiItem }>("/api/midi", {
      method: "POST",
      body: JSON.stringify({ songId, ...opts }),
    }),
  midiFromFile: async (file: File, opts: { instruments?: string[]; modelSize?: string; title?: string } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.instruments?.length) form.append("instruments", JSON.stringify(opts.instruments));
    if (opts.modelSize) form.append("modelSize", opts.modelSize);
    if (opts.title) form.append("title", opts.title);
    const res = await fetch("/api/midi", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || "Upload failed");
    return body as { ok: boolean; item: MidiItem };
  },
  midiSave: async (id: string, bytes: Uint8Array, noteCount: number) => {
    const res = await fetch(`/api/midi/${id}/file?noteCount=${noteCount}`, {
      method: "PUT",
      headers: { "content-type": "audio/midi" },
      body: new Blob([bytes as BlobPart], { type: "audio/midi" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || "Save failed");
    return body as { ok: boolean; item: MidiItem };
  },
  midiRevert: (id: string) => json<{ ok: boolean; item: MidiItem }>(`/api/midi/${id}/edit`, { method: "DELETE" }),
  midiRename: (id: string, title: string) =>
    json<{ ok: boolean; item: MidiItem }>(`/api/midi/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  /** Re-transcribe from the stored source audio — no re-upload. Optionally
   *  with a different model size or instrument filter. */
  /** Load / unload MuScriptor without running a transcription. */
  midiLoad: (modelSize?: string, freeVram = true) =>
    json<{ ok: boolean }>("/api/midi/server/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelSize, freeVram }),
    }),
  midiUnload: () => json<{ ok: boolean }>("/api/midi/server/stop", { method: "POST" }),

  midiRetry: (id: string, opts?: { modelSize?: string; instruments?: string[] }) =>
    json<{ ok: boolean; item: MidiItem }>(`/api/midi/${id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts || {}),
    }),
  midiDelete: (id: string) => json<{ ok: boolean }>(`/api/midi/${id}`, { method: "DELETE" }),

  saveLyrics: (text: string, title?: string) =>
    json<{ ok: boolean; lyrics: LyricDoc }>("/api/library/lyrics", {
      method: "POST",
      body: JSON.stringify({ text, title }),
    }),
  deleteLyrics: (id: string) => json<{ ok: boolean }>(`/api/library/lyrics/${id}`, { method: "DELETE" }),
  patchStylePreset: (id: string, patch: { liked?: boolean; name?: string }) =>
    json<{ ok: boolean; style: StylePreset }>(`/api/library/style/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  saveProject: (p: Partial<StudioProject>) =>
    json<{ ok: boolean; project: StudioProject }>("/api/library/project", {
      method: "POST",
      body: JSON.stringify(p),
    }),
  exportProject: (projectId: string, songIds: string[], filename?: string) =>
    downloadExport({ projectId, songIds }, filename || "juno-project.zip"),

  /** Submit a generation task. When ACE-Step rejects the task the proxy
   *  still records a failed Song row and returns it with ok:false. Only a
   *  transport failure (proxy unreachable) throws without a song. */
  generate: async (payload: GeneratePayload) => {
    // Response carries `rerouted` (preset label) when the task type needed
    // a different model than the one selected.
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
      rerouted?: string;
    };
  },

  queryTasks: (taskIds: string[]) =>
    json<{
      tasks: {
        taskId: string;
        songId: string;
        status: "queued" | "running" | "succeeded" | "failed";
        stage?: string;
        progress?: number;
        audioUrl?: string;
        localAudioPath?: string;
        model?: string;
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

  /** Delete a workspace; its songs go to Trash (recoverable), not away. */
  deleteWorkspace: (id: string) =>
    json<{ ok: boolean; name: string; trashed: number }>(`/api/library/workspace/${id}`, { method: "DELETE" }),

  deleteSong: (id: string) =>
    json<{ ok: boolean }>(`/api/library/song/${id}`, { method: "DELETE" }),

  /** Export downloads a zip (audio + manifest.json). Resolves once the browser
   *  has been handed the file. */
  exportSongs: (songIds: string[], filename?: string) =>
    downloadExport({ songIds }, filename || "juno-export.zip"),

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
