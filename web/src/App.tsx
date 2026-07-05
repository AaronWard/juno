/** Juno app shell: sidebar + routed page + persistent bottom player.
 *
 *  State model
 *  -----------
 *  A single React context (JunoStore) holds the local library, the player
 *  queue, health/model status and the Create-form prefill used by
 *  "Reuse Prompt" / "Use as Inspiration". Data starts from mock records and
 *  is merged with the proxy's /api/library when the backend is reachable.
 *  Metadata mutations are optimistic in the UI and mirrored to the proxy on
 *  a best-effort basis so the app keeps working when ACE-Step is offline.
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
import { MOCK_SONGS, Song } from "./data/mockSongs";
import {
  MOCK_COVER_ART,
  MOCK_HISTORY,
  MOCK_HOOKS,
  MOCK_LYRICS,
  MOCK_PLAYLISTS,
  MOCK_PROJECTS,
  MOCK_STYLE_PRESETS,
  MOCK_VOICES,
  MOCK_WORKSPACES,
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
  sourceSongId?: string;
  taskType?: string;
  title?: string;
}

interface JunoStore {
  route: string;
  navigate: (route: string) => void;

  songs: Song[];
  workspaces: Workspace[];
  playlists: typeof MOCK_PLAYLISTS;
  voices: typeof MOCK_VOICES;
  stylePresets: typeof MOCK_STYLE_PRESETS;
  lyricDocs: typeof MOCK_LYRICS;
  hooks: typeof MOCK_HOOKS;
  coverArt: typeof MOCK_COVER_ART;
  projects: typeof MOCK_PROJECTS;
  history: typeof MOCK_HISTORY;

  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;

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

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const [collapsed, setCollapsed] = useState(loadPref("sidebarCollapsed", false));

  const [songs, setSongs] = useState<Song[]>(MOCK_SONGS);
  const [workspaces] = useState(MOCK_WORKSPACES);
  const [history, setHistory] = useState(MOCK_HISTORY);
  const [activeWorkspaceId, setActiveWorkspaceIdRaw] = useState(
    loadPref("workspace", "ws_my")
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

  /* routing */
  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((r: string) => {
    window.location.hash = r;
  }, []);

  /* backend bootstrap: health + library merge */
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
      .then((lib) => {
        if (Array.isArray(lib?.songs) && lib.songs.length) {
          setSongs((prev) => {
            const known = new Set(prev.map((s) => s.id));
            const extra = [...lib.songs, ...(lib.trash || [])].filter(
              (s: Song) => !known.has(s.id)
            );
            return [...extra, ...prev];
          });
        }
        if (Array.isArray(lib?.history) && lib.history.length) {
          setHistory((prev) => [...lib.history, ...prev]);
        }
      })
      .catch(() => {
        /* proxy offline — mock data only */
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
                    updatedAt: new Date().toISOString(),
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
        s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s
      )
    );
    api.patchSong(id, patch).catch(() => {});
  }, []);

  const addSong = useCallback((song: Song) => {
    setSongs((prev) => [song, ...prev]);
  }, []);

  const addHistoryEvent = useCallback((event: string) => {
    setHistory((prev) => [
      { id: newId("hist"), at: new Date().toISOString(), event },
      ...prev,
    ]);
  }, []);

  const trashSong = useCallback(
    (id: string) => {
      patchSong(id, { trashed: true } as Partial<Song>);
      const s = songs.find((x) => x.id === id);
      if (s) addHistoryEvent(`Trashed "${s.title}"`);
    },
    [patchSong, songs, addHistoryEvent]
  );
  const restoreSong = useCallback(
    (id: string) => {
      patchSong(id, { trashed: false } as Partial<Song>);
      const s = songs.find((x) => x.id === id);
      if (s) addHistoryEvent(`Restored "${s.title}"`);
    },
    [patchSong, songs, addHistoryEvent]
  );
  const deleteForever = useCallback((id: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    api.deleteSong(id).catch(() => {});
  }, []);
  const emptyTrash = useCallback(() => {
    setSongs((prev) => {
      prev.filter((s) => s.trashed).forEach((s) => api.deleteSong(s.id).catch(() => {}));
      return prev.filter((s) => !s.trashed);
    });
  }, []);

  /* player */
  const playSong = useCallback(
    (id: string, queueIds?: string[]) => {
      setCurrentId(id);
      setIsPlaying(true);
      setQueue(queueIds && queueIds.length ? queueIds : [id]);
      setSongs((prev) =>
        prev.map((s) => (s.id === id ? { ...s, playCount: s.playCount + 1 } : s))
      );
    },
    []
  );
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  const orderedQueue = useMemo(() => {
    if (!shuffle) return queue;
    const rest = queue.filter((q) => q !== currentId);
    // simple stable shuffle keyed on queue content
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

  /* generation */
  const generate = useCallback(
    async (payload: GeneratePayload): Promise<Song> => {
      try {
        const res = await api.generate(payload);
        addSong(res.song);
        if (!res.ok) {
          // Proxy reachable but ACE-Step rejected the task: the proxy
          // already recorded a failed row, which we just added.
          addHistoryEvent(`Failed to submit task for "${res.song.title}"`);
          throw new Error(res.error || "ACE-Step task submission failed");
        }
        if (res.taskId) pendingTaskIds.current.add(res.taskId);
        addHistoryEvent(`Submitted ACE-Step task for "${res.song.title}"`);
        return res.song;
      } catch (e: any) {
        if (e?.handled) throw e;
        if (e instanceof Error && /task submission failed/i.test(e.message)) {
          throw e; // failed row already added above
        }
        // Proxy or ACE-Step unavailable: create a local mock row so the UI
        // flow stays complete (DESIGN_DOC §27 "ACE-Step offline" state).
        const now = new Date().toISOString();
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
  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveWorkspaceIdRaw(id);
    savePref("workspace", id);
  }, []);
  const setSelectedPreset = useCallback((id: PresetId) => {
    setSelectedPresetRaw(id);
    savePref("preset", id);
  }, []);
  useEffect(() => savePref("volume", volume), [volume]);
  useEffect(() => savePref("sidebarCollapsed", collapsed), [collapsed]);

  const currentSong = songs.find((s) => s.id === currentId) || null;

  const store: JunoStore = {
    route,
    navigate,
    songs,
    workspaces,
    playlists: MOCK_PLAYLISTS,
    voices: MOCK_VOICES,
    stylePresets: MOCK_STYLE_PRESETS,
    lyricDocs: MOCK_LYRICS,
    hooks: MOCK_HOOKS,
    coverArt: MOCK_COVER_ART,
    projects: MOCK_PROJECTS,
    history,
    activeWorkspaceId,
    setActiveWorkspaceId,
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
