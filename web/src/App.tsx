/** Juno app shell: sidebar + routed page + persistent bottom player.
 *
 *  State model: the proxy database at /data/juno-db.json is the single
 *  source of truth; on boot the store is hydrated from /api/library.
 *  Metadata mutations are optimistic in the UI and mirrored to the proxy
 *  best-effort so the app keeps working when ACE-Step is offline.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Sidebar } from "./components/Sidebar";
import { BottomPlayer } from "./components/BottomPlayer";
import { CreatePage } from "./pages/CreatePage";
import { LibraryPage } from "./pages/LibraryPage";
import { StudioPage } from "./pages/StudioPage";
import { EditorPage } from "./pages/EditorPage";
import { TrashPage } from "./pages/TrashPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Song } from "./data/mockSongs";
import {
  CoverArt,
  HistoryEvent,
  Hook,
  LyricDoc,
  Playlist,
  StudioProject,
  StylePreset,
  Voice,
  Workspace,
} from "./data/mockLibrary";
import { api, GeneratePayload, HealthResponse } from "./lib/api";
import { DEFAULT_PRESET, PresetId } from "./data/modelPresets";
import { loadPref, savePref } from "./lib/storage";
import { newId } from "./lib/ids";

/* ------------------------------------------------------------------ */
/* Store types                                                         */
/* ------------------------------------------------------------------ */

export type RepeatMode = "none" | "one" | "all";

export interface CreatePrefill {
  prompt?: string;
  styles?: string[];
  lyrics?: string;
  instrumental?: boolean;
  vocalGender?: "male" | "female" | "none";
  weirdness?: number;
  styleInfluence?: number;
  referenceAudioPath?: string;
  inspirationTitle?: string;
  srcAudioPath?: string;
  coverOfTitle?: string;
  voiceName?: string;
  sourceSongId?: string;
  taskType?: string;
  title?: string;
}

interface JunoStore {
  route: string;
  navigate: (route: string) => void;

  songs: Song[];
  workspaces: Workspace[];
  playlists: Playlist[];
  voices: Voice[];
  stylePresets: StylePreset[];
  lyricDocs: LyricDoc[];
  hooks: Hook[];
  coverArt: CoverArt[];
  projects: StudioProject[];
  history: HistoryEvent[];

  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  defaultWorkspaceId: string;
  addWorkspace: (name: string) => Promise<Workspace>;
  addPlaylist: (name: string) => Promise<Playlist>;
  toggleSongInPlaylist: (songId: string, playlistId: string) => void;
  addStylePreset: (name: string, styles: string[]) => Promise<StylePreset>;
  addVoice: (v: {
    name: string;
    gender?: Voice["gender"];
    description?: string;
  }) => Promise<Voice>;

  patchSong: (id: string, patch: Partial<Song>) => void;
  addSong: (song: Song) => void;
  trashSong: (id: string) => void;
  restoreSong: (id: string) => void;
  deleteForever: (id: string) => void;
  emptyTrash: () => void;
  addHistoryEvent: (event: string) => void;

  /* player */
  currentSong: Song | null;
  isPlaying: boolean;
  playSong: (id: string, queueIds?: string[]) => void;
  togglePlay: () => void;
  playNext: () => void;
  playPrev: () => void;
  queue: string[];
  removeFromQueue: (id: string) => void;
  shuffle: boolean;
  setShuffle: (v: boolean) => void;
  repeat: RepeatMode;
  setRepeat: (v: RepeatMode) => void;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;

  /* backend */
  health: HealthResponse | null;
  refreshHealth: () => void;
  selectedPreset: PresetId;
  setSelectedPreset: (id: PresetId) => void;
  generate: (payload: GeneratePayload) => Promise<Song>;

  /* create prefill */
  prefill: CreatePrefill | null;
  setPrefill: (p: CreatePrefill | null) => void;
}

const StoreCtx = createContext<JunoStore | null>(null);

export function useJuno(): JunoStore {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useJuno outside provider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Hash router                                                         */
/* ------------------------------------------------------------------ */

function currentRoute(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h || "/create";
}

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const [collapsed, setCollapsed] = useState(loadPref("sidebarCollapsed", false));

  const [songs, setSongs] = useState<Song[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const [lyricDocs, setLyricDocs] = useState<LyricDoc[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [coverArt, setCoverArt] = useState<CoverArt[]>([]);
  const [projects] = useState<StudioProject[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);

  const [activeWorkspaceId, setActiveWorkspaceIdRaw] = useState(
    loadPref("workspace", "")
  );

  const [queue, setQueue] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("none");
  const [volume, setVolume] = useState(loadPref("volume", 0.9));
  const [muted, setMuted] = useState(false);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedPreset, setSelectedPresetRaw] = useState<PresetId>(
    loadPref("preset", DEFAULT_PRESET)
  );
  const [prefill, setPrefill] = useState<CreatePrefill | null>(null);

  const pendingTaskIds = useRef<Set<string>>(new Set());
  const bootstrappedWs = useRef(false);

  /* routing */
  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((r: string) => {
    window.location.hash = r;
  }, []);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveWorkspaceIdRaw(id);
    savePref("workspace", id);
  }, []);

  /* backend bootstrap: health + library hydration */
  const refreshHealth = useCallback(() => {
    api
      .health()
      .then(setHealth)
      .catch(() =>
        setHealth({ juno: "unavailable", aceStep: "unavailable" } as HealthResponse)
      );
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 30000);
    api
      .library()
      .then(async (lib) => {
        setSongs([...(lib?.songs || []), ...(lib?.trash || [])]);
        setPlaylists(lib?.playlists || []);
        setVoices(lib?.voices || []);
        setStylePresets(lib?.styles || []);
        setLyricDocs(lib?.lyrics || []);
        setHooks(lib?.hooks || []);
        setCoverArt(lib?.coverArt || []);
        setHistory(lib?.history || []);

        for (const t of lib?.tasks || []) {
          if (t.status === "queued" || t.status === "running") {
            pendingTaskIds.current.add(t.id);
          }
        }

        let ws: Workspace[] = lib?.workspaces || [];
        if (!ws.length && !bootstrappedWs.current) {
          bootstrappedWs.current = true;
          try {
            const res = await api.createWorkspace("My Workspace");
            ws = [res.workspace];
          } catch {
            ws = [
              { id: "ws_default", name: "My Workspace", songIds: [], createdAt: nowIso(), updatedAt: nowIso() },
            ];
          }
        }
        setWorkspaces(ws);
        setActiveWorkspaceIdRaw((cur) =>
          ws.some((w) => w.id === cur) ? cur : ws[0]?.id || ""
        );
      })
      .catch(() => {
        const ws = {
          id: "ws_default",
          name: "My Workspace",
          songIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        setWorkspaces([ws]);
        setActiveWorkspaceIdRaw((cur) => cur || ws.id);
      });
    return () => clearInterval(t);
  }, [refreshHealth]);

  /* task polling for queued/running songs */
  useEffect(() => {
    const t = setInterval(async () => {
      const ids = [...pendingTaskIds.current];
      if (!ids.length) return;
      try {
        const res = await api.queryTasks(ids);
        for (const task of res.tasks) {
          if (task.status === "succeeded" || task.status === "failed") {
            pendingTaskIds.current.delete(task.taskId);
          }
          setSongs((prev) =>
            prev.map((s) =>
              s.id === task.songId
                ? {
                    ...s,
                    generationStatus: task.status,
                    generationError: task.error,
                    audioUrl: task.audioUrl || s.audioUrl,
                    updatedAt: nowIso(),
                  }
                : s
            )
          );
        }
      } catch {
        /* polling failure: keep tasks pending, health banner covers it */
      }
    }, 4000);
    return () => clearInterval(t);
  }, []);

  /* mutations */
  const patchSong = useCallback((id: string, patch: Partial<Song>) => {
    setSongs((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt: nowIso() } : s
      )
    );
    api.patchSong(id, patch).catch(() => {});
  }, []);

  const addSong = useCallback((song: Song) => {
    setSongs((prev) => [song, ...prev.filter((s) => s.id !== song.id)]);
  }, []);

  const addHistoryEvent = useCallback((event: string) => {
    setHistory((prev) => [
      { id: newId("hist"), at: nowIso(), event },
      ...prev,
    ]);
  }, []);

  const trashSong = useCallback(
    (id: string) => {
      patchSong(id, { trashed: true } as Partial<Song>);
      setSongs((prev) => {
        const s = prev.find((x) => x.id === id);
        if (s) addHistoryEvent(`Trashed "${s.title}"`);
        return prev;
      });
    },
    [patchSong, addHistoryEvent]
  );
  const restoreSong = useCallback(
    (id: string) => {
      patchSong(id, { trashed: false } as Partial<Song>);
    },
    [patchSong]
  );
  const deleteForever = useCallback((id: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    setQueue((q) => q.filter((x) => x !== id));
    api.deleteSong(id).catch(() => {});
  }, []);
  const emptyTrash = useCallback(() => {
    setSongs((prev) => {
      prev.filter((s) => s.trashed).forEach((s) => api.deleteSong(s.id).catch(() => {}));
      return prev.filter((s) => !s.trashed);
    });
  }, []);

  const addWorkspace = useCallback(
    async (name: string): Promise<Workspace> => {
      try {
        const res = await api.createWorkspace(name);
        setWorkspaces((w) => [...w, res.workspace]);
        setActiveWorkspaceId(res.workspace.id);
        addHistoryEvent(`Created workspace "${name}"`);
        return res.workspace;
      } catch {
        const ws: Workspace = {
          id: newId("ws"),
          name,
          songIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        setWorkspaces((w) => [...w, ws]);
        setActiveWorkspaceId(ws.id);
        return ws;
      }
    },
    [setActiveWorkspaceId, addHistoryEvent]
  );

  /** Create a playlist (persisted to the proxy DB, local fallback). */
  const addPlaylist = useCallback(
    async (name: string): Promise<Playlist> => {
      try {
        const res = await api.createPlaylist(name);
        setPlaylists((p) => [...p, res.playlist]);
        addHistoryEvent(`Created playlist "${name}"`);
        return res.playlist;
      } catch {
        const pl: Playlist = {
          id: newId("pl"),
          name,
          songIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        setPlaylists((p) => [...p, pl]);
        return pl;
      }
    },
    [addHistoryEvent]
  );

  /** Toggle a song's membership in a playlist. Updates both the song's
   *  playlistIds and the playlist's songIds, mirroring to the proxy. */
  const toggleSongInPlaylist = useCallback((songId: string, playlistId: string) => {
    setSongs((prev) =>
      prev.map((s) => {
        if (s.id !== songId) return s;
        const ids = s.playlistIds || [];
        const next = ids.includes(playlistId)
          ? ids.filter((x) => x !== playlistId)
          : [...ids, playlistId];
        api.patchSong(songId, { playlistIds: next }).catch(() => {});
        return { ...s, playlistIds: next, updatedAt: nowIso() };
      })
    );
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const has = p.songIds.includes(songId);
        const next = has
          ? p.songIds.filter((x) => x !== songId)
          : [...p.songIds, songId];
        api.patchPlaylist(playlistId, { songIds: next }).catch(() => {});
        return { ...p, songIds: next, updatedAt: nowIso() };
      })
    );
  }, []);

  /** Save the current style chips as a reusable preset (🗂 in Styles). */
  const addStylePreset = useCallback(
    async (name: string, styles: string[]): Promise<StylePreset> => {
      try {
        const res = await api.createStylePreset(name, styles);
        setStylePresets((p) => [...p, res.style]);
        addHistoryEvent(`Saved style preset "${name}"`);
        return res.style;
      } catch {
        const sp: StylePreset = {
          id: newId("style"),
          name,
          styles,
          liked: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        setStylePresets((p) => [...p, sp]);
        return sp;
      }
    },
    [addHistoryEvent]
  );

  const addVoice = useCallback(
    async (v: { name: string; gender?: Voice["gender"]; description?: string }): Promise<Voice> => {
      try {
        const res = await api.createVoice(v);
        setVoices((prev) => [...prev, res.voice]);
        return res.voice;
      } catch {
        const voice: Voice = {
          id: newId("voice"),
          name: v.name,
          gender: v.gender,
          description: v.description,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        setVoices((prev) => [...prev, voice]);
        return voice;
      }
    },
    []
  );

  /* player */
  const playSong = useCallback((id: string, queueIds?: string[]) => {
    setCurrentId(id);
    setIsPlaying(true);
    setQueue(queueIds && queueIds.length ? queueIds : [id]);
    setSongs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, playCount: s.playCount + 1 } : s))
    );
  }, []);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  const orderedQueue = useMemo(() => {
    if (!shuffle) return queue;
    const rest = queue.filter((q) => q !== currentId);
    return [currentId, ...rest.slice().reverse()].filter(Boolean) as string[];
  }, [queue, shuffle, currentId]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!currentId || orderedQueue.length === 0) return;
      const i = orderedQueue.indexOf(currentId);
      let next = i + dir;
      if (next < 0) next = repeat === "all" ? orderedQueue.length - 1 : 0;
      if (next >= orderedQueue.length) {
        if (repeat === "all") next = 0;
        else {
          setIsPlaying(false);
          return;
        }
      }
      setCurrentId(orderedQueue[next]);
      setIsPlaying(true);
    },
    [currentId, orderedQueue, repeat]
  );
  const playNext = useCallback(() => step(1), [step]);
  const playPrev = useCallback(() => step(-1), [step]);

  const removeFromQueue = useCallback(
    (id: string) => {
      setQueue((q) => {
        const remaining = q.filter((x) => x !== id);
        if (currentId === id) {
          const i = q.indexOf(id);
          const next = remaining[Math.min(i, remaining.length - 1)] ?? null;
          setCurrentId(next);
          if (!next) setIsPlaying(false);
        }
        return remaining;
      });
    },
    [currentId]
  );

  /* generation */
  const generate = useCallback(
    async (payload: GeneratePayload): Promise<Song> => {
      try {
        const res = await api.generate(payload);
        addSong(res.song);
        if (!res.ok) {
          addHistoryEvent(`Failed to submit task for "${res.song.title}"`);
          throw new Error(res.error || "ACE-Step task submission failed");
        }
        if (res.taskId) pendingTaskIds.current.add(res.taskId);
        addHistoryEvent(`Submitted ACE-Step task for "${res.song.title}"`);
        return res.song;
      } catch (e: any) {
        if (e instanceof Error && /task submission failed/i.test(e.message)) {
          throw e;
        }
        const now = nowIso();
        const song: Song = {
          id: newId("local"),
          title: payload.title || "Untitled sketch",
          description: [payload.prompt, (payload.styles || []).join(", ")]
            .filter(Boolean)
            .join(" — "),
          lyrics: payload.instrumental ? undefined : payload.lyrics,
          styles: payload.styles || [],
          model: (payload.model as Song["model"]) || "juno-xl-quality",
          aceModel: "acestep-v15-xl-sft",
          type: "song",
          durationSeconds: payload.duration || 120,
          playlistIds: [],
          workspaceId: payload.workspaceId,
          liked: false,
          disliked: false,
          public: false,
          playCount: 0,
          commentCount: 0,
          createdAt: now,
          updatedAt: now,
          generationStatus: "failed",
          generationError: `ACE-Step unavailable: ${e?.message || e}`,
          metadata: {
            weirdness: payload.weirdness ?? 50,
            styleInfluence: payload.styleInfluence ?? 50,
            instrumental: !!payload.instrumental,
            taskType: (payload.taskType as any) || "text2music",
          },
        };
        addSong(song);
        throw e;
      }
    },
    [addSong, addHistoryEvent]
  );

  /* prefs persistence */
  const setSelectedPreset = useCallback((id: PresetId) => {
    setSelectedPresetRaw(id);
    savePref("preset", id);
  }, []);
  useEffect(() => savePref("volume", volume), [volume]);
  useEffect(() => savePref("sidebarCollapsed", collapsed), [collapsed]);

  const currentSong = songs.find((s) => s.id === currentId) || null;
  const defaultWorkspaceId = workspaces[0]?.id || "ws_default";

  const store: JunoStore = {
    route,
    navigate,
    songs,
    workspaces,
    playlists,
    voices,
    stylePresets,
    lyricDocs,
    hooks,
    coverArt,
    projects,
    history,
    activeWorkspaceId: activeWorkspaceId || defaultWorkspaceId,
    setActiveWorkspaceId,
    defaultWorkspaceId,
    addWorkspace,
    addPlaylist,
    toggleSongInPlaylist,
    addStylePreset,
    addVoice,
    patchSong,
    addSong,
    trashSong,
    restoreSong,
    deleteForever,
    emptyTrash,
    addHistoryEvent,
    currentSong,
    isPlaying,
    playSong,
    togglePlay,
    playNext,
    playPrev,
    queue: orderedQueue,
    removeFromQueue,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    volume,
    setVolume,
    muted,
    setMuted,
    health,
    refreshHealth,
    selectedPreset,
    setSelectedPreset,
    generate,
    prefill,
    setPrefill,
  };

  let page: React.ReactNode;
  if (route.startsWith("/editor/")) {
    page = <EditorPage songId={route.slice("/editor/".length)} />;
  } else if (route.startsWith("/library")) {
    page = <LibraryPage />;
  } else if (route.startsWith("/studio")) {
    page = <StudioPage />;
  } else if (route.startsWith("/trash")) {
    page = <TrashPage />;
  } else if (route.startsWith("/settings")) {
    page = <SettingsPage />;
  } else {
    page = <CreatePage />;
  }

  return (
    <StoreCtx.Provider value={store}>
      <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} />
        <main className="app-main">{page}</main>
        <BottomPlayer />
      </div>
    </StoreCtx.Provider>
  );
}
