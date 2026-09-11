/** Juno API routes. The React frontend calls ONLY these /api/* endpoints —
 *  never ACE-Step or MuScriptor directly. See docs/API_MAPPING.md.
 */
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { config, PresetId } from "./config";
import { midiManager, MIDI_INSTRUMENTS } from "./midi";
import { modelManager, saveLocalCopy } from "./modelManager";
import { addHistory, loadDb, mutateDb, purgeExpiredTrash } from "./storage";
import { buildAcePayload, resolvePreset } from "./tasks";
import { GenerateRequest, GenerationTask, JunoSettings, MidiRecord, Song, StudioProject, TaskType } from "./types";
import { midiSourceUpload, upload } from "./uploads";

export const router = express.Router();

const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

const SONG_TYPES: Song["type"][] = [
  "song", "upload", "cover", "remix", "extended",
  "mashup", "sample", "reversed", "cropped", "replacement",
];

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

router.get("/health", async (_req: Request, res: Response) => {
  const ace = modelManager.health();
  res.json({
    juno: "ok",
    aceStep: ace.ok ? "ok" : "unavailable",
    aceStepCheckedVia: ace.via,
    aceStepDetail: ace.detail,
    loadedModel: ace.loadedModel || null,
    modelPaths: {
      quality: config.presets["juno-xl-quality"].ditPath,
      fast: config.presets["juno-xl-fast"].ditPath,
      studio: config.presets["juno-xl-studio"].ditPath,
      lm: config.presets["juno-xl-quality"].lmPath,
    },
    outputPath: config.outputDir,
    uploadPath: config.uploadDir,
    dataPath: config.dataDir,
  });
});

/** One snapshot for the whole UI: ACE-Step, MuScriptor, VRAM, settings. */
router.get("/status", async (_req: Request, res: Response) => {
  res.json({
    juno: "ok",
    ace: await modelManager.status(),
    midi: midiManager.status(),
    vram: modelManager.vram(),
    settings: loadDb().settings,
    lmBackend: config.lmBackend,
    lmModel: config.lmModel,
  });
});

router.get("/models", async (_req: Request, res: Response) => {
  const ace = modelManager.health();
  const presets = Object.values(config.presets).map((p) => ({
    id: p.id,
    label: p.label,
    aceModel: p.aceModel,
    ditPath: p.ditPath,
    lmPath: p.lmPath,
    inferenceSteps: p.inferenceSteps,
    cfgEnabled: p.cfgEnabled,
    supportedTasks: p.supportedTasks,
    description: p.description,
    available: ace.ok,
    loaded: ace.ok && ace.loadedModel === p.aceModel,
  }));
  res.json({ presets, aceStep: ace.ok ? "ok" : "unavailable" });
});

/** Queue a model load (returns immediately; watch /api/status). */
router.post(["/models/load", "/models/init"], (req: Request, res: Response) => {
  const model = req.body?.model as PresetId;
  if (!(model in config.presets)) {
    res.status(400).json({ ok: false, error: `Unknown preset "${model}"` });
    return;
  }
  modelManager.requestLoad(model);
  res.json({ ok: true, preset: model });
});

/** Free VRAM by restarting ACE-Step. `force` cancels a running generation. */
router.post("/models/unload", async (req: Request, res: Response) => {
  try {
    await modelManager.requestUnload("manual", !!req.body?.force);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(409).json({ ok: false, error: e?.message || String(e) });
  }
});

router.post("/midi/server/stop", async (_req: Request, res: Response) => {
  try {
    await midiManager.stopServer("manual");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(409).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get("/settings", (_req, res) => res.json(loadDb().settings));

router.patch("/settings", (req: Request, res: Response) => {
  const b = req.body || {};
  const settings = mutateDb((db) => {
    const s: JunoSettings = db.settings;
    if (Number.isFinite(Number(b.aceIdleUnloadMinutes)) && b.aceIdleUnloadMinutes !== null)
      s.aceIdleUnloadMinutes = Math.max(0, Math.round(Number(b.aceIdleUnloadMinutes)));
    if (Number.isFinite(Number(b.midiIdleStopMinutes)) && b.midiIdleStopMinutes !== null)
      s.midiIdleStopMinutes = Math.max(0, Math.round(Number(b.midiIdleStopMinutes)));
    if (typeof b.preloadOnSelect === "boolean") s.preloadOnSelect = b.preloadOnSelect;
    if (["small", "medium", "large"].includes(b.midiModelSize)) s.midiModelSize = b.midiModelSize;
    return { ...s };
  });
  modelManager.touch();
  res.json(settings);
});

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function typeForTask(taskType?: string): Song["type"] {
  switch (taskType) {
    case "cover":
      return "cover";
    case "repaint":
      return "replacement";
    case "lego":
    case "complete":
      return "remix";
    default:
      return "song";
  }
}

const TITLES = ["God's Promise", "Late Signal", "Soft Static", "The Long Horizon", "Night Choir", "Glass Weather", "Slow Bloom", "Neon Prayer"];
const generatedTitle = () => TITLES[Math.floor(Math.random() * TITLES.length)];

/** Create the task for a (new or retried) song. Mutates `song` in place. */
function queueGeneration(song: Song, form: GenerateRequest): { task?: GenerationTask; error?: string; rerouted?: string } {
  const taskType: TaskType = form.taskType || "text2music";
  const { preset, rerouted } = resolvePreset(form.model, taskType);
  song.model = preset.id as Song["model"];
  song.aceModel = preset.aceModel as Song["aceModel"];

  let payload: Record<string, unknown>;
  try {
    payload = buildAcePayload(form, preset);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  const loaded = modelManager.health().loadedModel;
  const stage = loaded === preset.aceModel ? "Waiting in queue" : `Waiting to load ${preset.label}`;
  const task: GenerationTask = {
    id: newId("task"),
    aceTaskId: "",
    songId: song.id,
    status: "queued",
    model: song.model,
    aceModel: song.aceModel,
    requestPayload: payload,
    form,
    stage,
    createdAt: now(),
    updatedAt: now(),
  };
  song.generationStatus = "queued";
  song.generationError = undefined;
  song.generationStage = rerouted ? `${stage} (${taskType} needs the base model)` : stage;
  song.generationProgress = 0;
  return { task, rerouted: rerouted ? preset.label : undefined };
}

router.post("/generate", (req: Request, res: Response) => {
  const form = (req.body || {}) as GenerateRequest;
  const ts = now();
  const song: Song = {
    id: newId("song"),
    title: form.title || generatedTitle(),
    description: [form.prompt, (form.styles || []).join(", ")].filter(Boolean).join(" — "),
    lyrics: form.instrumental ? undefined : form.lyrics,
    styles: form.styles || [],
    model: "juno-xl-quality",
    aceModel: "acestep-v15-xl-sft",
    type: form.songType && SONG_TYPES.includes(form.songType) ? form.songType : typeForTask(form.taskType),
    durationSeconds: form.duration ?? 120,
    playlistIds: [],
    workspaceId: form.workspaceId,
    liked: false,
    disliked: false,
    public: false,
    playCount: 0,
    commentCount: 0,
    createdAt: ts,
    updatedAt: ts,
    sourceSongId: form.sourceSongId,
    generationRequest: form,
    metadata: {
      vocalGender: form.vocalGender,
      weirdness: form.weirdness ?? 50,
      styleInfluence: form.styleInfluence ?? 50,
      instrumental: !!form.instrumental,
      bpm: form.bpm,
      key: form.key,
      timeSignature: form.timeSignature,
      seed: form.seed,
      taskType: form.taskType || "text2music",
    },
  };

  const { task, error, rerouted } = queueGeneration(song, form);
  if (!task) {
    song.generationStatus = "failed";
    song.generationError = error;
    mutateDb((db) => {
      db.songs.unshift(song);
      addHistory(db, `Could not submit "${song.title}"`);
    });
    res.status(400).json({ ok: false, song, error });
    return;
  }
  mutateDb((db) => {
    db.songs.unshift(song);
    db.tasks.unshift(task);
    db.tasks = db.tasks.slice(0, 2000);
    addHistory(db, `Queued "${song.title}" (${config.presets[task.model].label})`);
  });
  modelManager.enqueueTask(task.id);
  res.json({ ok: true, taskId: task.id, song, rerouted });
});

/** Resubmit a failed generation with its original request. */
router.post("/songs/:id/retry", (req: Request, res: Response) => {
  const db = loadDb();
  const song = db.songs.find((s) => s.id === req.params.id);
  if (!song) {
    res.status(404).json({ ok: false, error: "Song not found" });
    return;
  }
  const form = song.generationRequest || (db.tasks.find((t) => t.songId === song.id && t.form)?.form as GenerateRequest | undefined);
  if (!form) {
    res.status(400).json({ ok: false, error: "This row has no stored request to retry. Use Reuse Prompt instead." });
    return;
  }
  const { task, error } = queueGeneration(song, form);
  if (!task) {
    res.status(400).json({ ok: false, error });
    return;
  }
  const saved = mutateDb((d) => {
    const s = d.songs.find((x) => x.id === song.id)!;
    Object.assign(s, {
      model: song.model,
      aceModel: song.aceModel,
      generationStatus: "queued",
      generationError: undefined,
      generationStage: song.generationStage,
      generationProgress: 0,
      generationRequest: form,
      updatedAt: now(),
    });
    d.tasks.unshift(task);
    addHistory(d, `Retried "${s.title}"`);
    return s;
  });
  modelManager.enqueueTask(task.id);
  res.json({ ok: true, taskId: task.id, song: saved });
});

/** Task state for the UI (polling of ACE-Step itself happens server-side). */
router.post("/tasks/query", (req: Request, res: Response) => {
  const ids: string[] = req.body?.taskIds || [];
  const db = loadDb();
  const tasks = db.tasks.filter((t) => ids.includes(t.id) || (t.aceTaskId && ids.includes(t.aceTaskId)));
  res.json({
    tasks: tasks.map((t) => {
      const s = db.songs.find((x) => x.id === t.songId);
      return {
        taskId: t.id,
        aceTaskId: t.aceTaskId,
        songId: t.songId,
        status: t.status,
        stage: t.stage,
        progress: t.progress,
        audioUrl: t.status === "succeeded" ? s?.audioUrl : undefined,
        localAudioPath: t.status === "succeeded" ? s?.localAudioPath : undefined,
        model: t.model,
        error: t.error,
      };
    }),
  });
});

router.get("/audio", async (req: Request, res: Response) => {
  const p = String(req.query.path || "");
  if (!p) {
    res.status(400).json({ error: "Missing ?path=" });
    return;
  }
  try {
    res.sendFile(await saveLocalCopy(p));
  } catch (e: any) {
    res.status(502).json({ error: `Audio fetch failed: ${e?.message || e}` });
  }
});

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

router.post("/upload", upload.single("file"), (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const b = (req.body || {}) as Record<string, string>;
  const type = SONG_TYPES.includes(b.type as Song["type"]) ? (b.type as Song["type"]) : "upload";
  let styles: string[] = [];
  try {
    if (b.styles) styles = JSON.parse(b.styles);
  } catch {
    /* ignore malformed styles */
  }

  let filePath = file.path;
  let audioUrl = `/upload-audio/${path.basename(file.path)}`;
  if (type !== "upload") {
    try {
      fs.mkdirSync(config.libraryDir, { recursive: true });
      const dest = path.join(config.libraryDir, path.basename(file.path));
      try {
        fs.renameSync(file.path, dest);
      } catch {
        fs.copyFileSync(file.path, dest);
        fs.unlinkSync(file.path);
      }
      filePath = dest;
      audioUrl = `/library-audio/${path.basename(dest)}`;
    } catch (e) {
      console.error("[juno-proxy] failed to move processed audio to library:", e);
    }
  }

  const ts = now();
  const song: Song = {
    id: newId(type === "upload" ? "upl" : "song"),
    title: b.title || path.basename(file.originalname, path.extname(file.originalname)),
    description: b.description || "Uploaded audio",
    lyrics: b.lyrics || undefined,
    styles,
    model: "juno-xl-quality",
    aceModel: "acestep-v15-xl-sft",
    type,
    durationSeconds: Math.max(0, Math.round(Number(b.durationSeconds) || 0)),
    playlistIds: [],
    workspaceId: b.workspaceId || undefined,
    liked: false,
    disliked: false,
    public: false,
    playCount: 0,
    commentCount: 0,
    createdAt: ts,
    updatedAt: ts,
    sourceSongId: b.sourceSongId || undefined,
    localAudioPath: filePath,
    audioUrl,
    generationStatus: "idle",
    metadata: { weirdness: 50, styleInfluence: 50, instrumental: false },
  };
  mutateDb((db) => {
    db.songs.unshift(song);
    addHistory(db, type === "upload" ? `Uploaded "${file.originalname}"` : `Saved processed audio "${song.title}"`);
  });
  res.json({ ok: true, asset: song });
});

/* ------------------------------------------------------------------ */
/* MIDI (MuScriptor)                                                   */
/* ------------------------------------------------------------------ */

function fileUrl(p?: string, stamp?: string) {
  return p ? `/midi-files/${path.basename(p)}?v=${encodeURIComponent(stamp || "")}` : undefined;
}

function midiView(r: MidiRecord) {
  return {
    ...r,
    midiUrl: fileUrl(r.editedMidiPath || r.midiPath, r.updatedAt),
    originalMidiUrl: fileUrl(r.midiPath, r.finishedAt),
    quantizedMidiUrl: fileUrl(r.quantizedMidiPath, r.finishedAt),
    edited: !!r.editedMidiPath,
    queuePosition: midiManager.positionOf(r.id),
  };
}

router.get("/midi", (_req: Request, res: Response) => {
  res.json({ items: loadDb().midi.map(midiView), instruments: MIDI_INSTRUMENTS });
});

router.get("/midi/:id", (req: Request, res: Response) => {
  const r = loadDb().midi.find((x) => x.id === req.params.id);
  if (!r) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(midiView(r));
});

/** Start a transcription from a Library song (JSON {songId}) or an uploaded
 *  audio file (multipart field "file"). */
router.post("/midi", midiSourceUpload.single("file"), (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  const b = (req.body || {}) as Record<string, any>;
  const db = loadDb();

  let instruments: string[] = [];
  try {
    const raw = typeof b.instruments === "string" ? JSON.parse(b.instruments) : b.instruments;
    if (Array.isArray(raw)) instruments = raw.map(String).filter((x) => MIDI_INSTRUMENTS.includes(x));
  } catch {
    /* none */
  }
  const modelSize = ["small", "medium", "large"].includes(b.modelSize) ? b.modelSize : db.settings.midiModelSize;

  let sourceAudioPath: string;
  let sourceAudioUrl: string | undefined;
  let title: string;
  let sourceSongId: string | undefined;

  if (file) {
    sourceAudioPath = file.path;
    sourceAudioUrl = `/upload-audio/${path.relative(config.uploadDir, file.path).split(path.sep).join("/")}`;
    title = b.title || path.basename(file.originalname, path.extname(file.originalname));
  } else {
    const song = db.songs.find((s) => s.id === b.songId);
    if (!song) {
      res.status(404).json({ error: "Song not found" });
      return;
    }
    if (!song.localAudioPath || !fs.existsSync(song.localAudioPath)) {
      res.status(400).json({ error: "This song has no audio file on disk yet." });
      return;
    }
    sourceAudioPath = song.localAudioPath;
    sourceAudioUrl = song.audioUrl;
    title = b.title || song.title;
    sourceSongId = song.id;
  }

  const ts = now();
  const rec: MidiRecord = {
    id: newId("midi"),
    title,
    status: "queued",
    progress: 0,
    stage: "Queued",
    sourceSongId,
    sourceAudioPath,
    sourceAudioUrl,
    instruments,
    modelSize,
    createdAt: ts,
    updatedAt: ts,
  };
  mutateDb((d) => {
    d.midi.unshift(rec);
    addHistory(d, `Queued MIDI extraction for "${title}"`);
  });
  midiManager.enqueue(rec.id);
  res.json({ ok: true, item: midiView(rec) });
});

router.post("/midi/:id/retry", (req: Request, res: Response) => {
  const r = mutateDb((d) => {
    const x = d.midi.find((m) => m.id === req.params.id);
    if (x) Object.assign(x, { status: "queued", progress: 0, stage: "Queued", error: undefined, updatedAt: now() });
    return x;
  });
  if (!r) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  midiManager.enqueue(r.id);
  res.json({ ok: true, item: midiView(r) });
});

router.patch("/midi/:id", (req: Request, res: Response) => {
  const r = mutateDb((d) => {
    const x = d.midi.find((m) => m.id === req.params.id);
    if (x && typeof req.body?.title === "string" && req.body.title.trim()) {
      x.title = req.body.title.trim();
      x.updatedAt = now();
    }
    return x;
  });
  if (!r) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true, item: midiView(r) });
});

/** Save piano-roll edits (raw audio/midi body). The original is kept. */
router.put(
  "/midi/:id/file",
  express.raw({ type: ["audio/midi", "audio/x-midi", "application/octet-stream"], limit: "20mb" }),
  (req: Request, res: Response) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 14 || body.subarray(0, 4).toString("latin1") !== "MThd") {
      res.status(400).json({ error: "Body is not a MIDI file" });
      return;
    }
    fs.mkdirSync(config.midiDir, { recursive: true });
    const r = mutateDb((d) => {
      const x = d.midi.find((m) => m.id === req.params.id);
      if (!x) return undefined;
      x.editedMidiPath = path.join(config.midiDir, `${x.id}.edit.mid`);
      fs.writeFileSync(x.editedMidiPath, body);
      const n = Number(req.query.noteCount);
      if (Number.isFinite(n)) x.noteCount = n;
      x.updatedAt = now();
      addHistory(d, `Saved MIDI edits for "${x.title}"`);
      return x;
    });
    if (!r) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true, item: midiView(r) });
  }
);

/** Discard edits and go back to the original transcription. */
router.delete("/midi/:id/edit", (req: Request, res: Response) => {
  const r = mutateDb((d) => {
    const x = d.midi.find((m) => m.id === req.params.id);
    if (!x) return undefined;
    if (x.editedMidiPath) fs.rmSync(x.editedMidiPath, { force: true });
    x.editedMidiPath = undefined;
    x.updatedAt = now();
    return x;
  });
  if (!r) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true, item: midiView(r) });
});

router.delete("/midi/:id", (req: Request, res: Response) => {
  mutateDb((d) => {
    const x = d.midi.find((m) => m.id === req.params.id);
    if (!x) return;
    for (const p of [x.midiPath, x.quantizedMidiPath, x.editedMidiPath]) if (p) fs.rmSync(p, { force: true });
    // Only delete source audio that was uploaded straight into the MIDI tab.
    if (!x.sourceSongId && x.sourceAudioPath.startsWith(config.midiSourceDir)) fs.rmSync(x.sourceAudioPath, { force: true });
    d.midi = d.midi.filter((m) => m.id !== x.id);
    addHistory(d, `Deleted MIDI "${x.title}"`);
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

router.get("/library", (_req: Request, res: Response) => {
  const db = mutateDb((d) => {
    purgeExpiredTrash(d);
    return d;
  });
  res.json({
    songs: db.songs.filter((s) => !s.trashed),
    trash: db.songs.filter((s) => s.trashed),
    tasks: db.tasks.slice(0, 200),
    workspaces: db.workspaces,
    playlists: db.playlists,
    voices: db.voices,
    styles: db.styles,
    lyrics: db.lyrics,
    hooks: db.hooks,
    coverArt: db.coverArt,
    history: db.history,
    projects: db.projects,
    midi: db.midi.map(midiView),
    settings: db.settings,
  });
});

router.post("/library/workspace", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing workspace name" });
    return;
  }
  const ts = now();
  const workspace = mutateDb((db) => {
    const w = { id: newId("ws"), name, songIds: [], createdAt: ts, updatedAt: ts };
    db.workspaces.push(w);
    addHistory(db, `Created workspace "${name}"`);
    return w;
  });
  res.json({ ok: true, workspace });
});

router.post("/library/playlist", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing playlist name" });
    return;
  }
  const ts = now();
  const playlist = mutateDb((db) => {
    const p = { id: newId("pl"), name, songIds: [] as string[], createdAt: ts, updatedAt: ts };
    db.playlists.push(p);
    addHistory(db, `Created playlist "${name}"`);
    return p;
  });
  res.json({ ok: true, playlist });
});

router.patch("/library/playlist/:id", (req: Request, res: Response) => {
  const updated = mutateDb((db) => {
    const p = db.playlists.find((x) => x.id === req.params.id);
    if (!p) return null;
    if (typeof req.body?.name === "string" && req.body.name.trim()) p.name = req.body.name.trim();
    if (Array.isArray(req.body?.songIds)) p.songIds = req.body.songIds.map(String);
    if (typeof req.body?.coverArtUrl === "string") p.coverArtUrl = req.body.coverArtUrl;
    p.updatedAt = now();
    return p;
  });
  if (!updated) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ ok: true, playlist: updated });
});

router.post("/library/style", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const styles: string[] = Array.isArray(req.body?.styles) ? req.body.styles.map(String).filter(Boolean) : [];
  if (!name || !styles.length) {
    res.status(400).json({ error: "Missing preset name or styles" });
    return;
  }
  const ts = now();
  const style = mutateDb((db) => {
    const s = { id: newId("style"), name, styles, liked: false, createdAt: ts, updatedAt: ts };
    db.styles.push(s);
    addHistory(db, `Saved style preset "${name}"`);
    return s;
  });
  res.json({ ok: true, style });
});

router.patch("/library/style/:id", (req: Request, res: Response) => {
  const style = mutateDb((db) => {
    const s = db.styles.find((x) => x.id === req.params.id);
    if (!s) return null;
    if (typeof req.body?.liked === "boolean") s.liked = req.body.liked;
    if (typeof req.body?.name === "string" && req.body.name.trim()) s.name = req.body.name.trim();
    s.updatedAt = now();
    return s;
  });
  if (!style) {
    res.status(404).json({ error: "Style preset not found" });
    return;
  }
  res.json({ ok: true, style });
});

router.post("/library/voice", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing voice name" });
    return;
  }
  const ts = now();
  const voice = mutateDb((db) => {
    const v = {
      id: newId("voice"),
      name,
      description: req.body?.description ? String(req.body.description) : undefined,
      gender: req.body?.gender ? String(req.body.gender) : undefined,
      sourceAudioId: req.body?.sourceAudioId ? String(req.body.sourceAudioId) : undefined,
      createdAt: ts,
      updatedAt: ts,
    };
    db.voices.push(v);
    addHistory(db, `Created voice profile "${name}"`);
    return v;
  });
  res.json({ ok: true, voice });
});

/** Save a lyric document (Lyrics card 💾). */
router.post("/library/lyrics", (req: Request, res: Response) => {
  const text = String(req.body?.text || "").trim();
  if (!text) {
    res.status(400).json({ error: "Lyrics are empty" });
    return;
  }
  const firstLine = text.split("\n").find((l) => l.trim() && !/^\[.*\]$/.test(l.trim()));
  const title = String(req.body?.title || "").trim() || firstLine?.slice(0, 60) || "Untitled lyrics";
  const ts = now();
  const doc = mutateDb((db) => {
    const d = { id: newId("lyr"), title, text, createdAt: ts, updatedAt: ts };
    db.lyrics.unshift(d);
    addHistory(db, `Saved lyrics "${title}"`);
    return d;
  });
  res.json({ ok: true, lyrics: doc });
});

router.delete("/library/lyrics/:id", (req: Request, res: Response) => {
  mutateDb((db) => {
    db.lyrics = db.lyrics.filter((l) => l.id !== req.params.id);
  });
  res.json({ ok: true });
});

/** Create or update a Studio project. */
router.post("/library/project", (req: Request, res: Response) => {
  const b = req.body || {};
  const ts = now();
  const project = mutateDb((db) => {
    let p = b.id ? db.projects.find((x) => x.id === b.id) : undefined;
    const fields = {
      name: String(b.name || "Untitled Project").trim() || "Untitled Project",
      tracks: Array.isArray(b.tracks) ? b.tracks : [],
      clips: Array.isArray(b.clips) ? b.clips : [],
      region:
        b.region && typeof b.region === "object"
          ? { start: Number(b.region.start) || 0, end: Number(b.region.end) || 16 }
          : { start: 0, end: 16 },
    };
    if (p) {
      Object.assign(p, fields, { trackCount: fields.tracks.length, updatedAt: ts });
    } else {
      p = { id: newId("proj"), ...fields, trackCount: fields.tracks.length, createdAt: ts, updatedAt: ts } as StudioProject;
      db.projects.unshift(p);
    }
    addHistory(db, `Saved Studio project "${p.name}"`);
    return p;
  });
  res.json({ ok: true, project });
});

router.delete("/library/project/:id", (req: Request, res: Response) => {
  mutateDb((db) => {
    db.projects = db.projects.filter((p) => p.id !== req.params.id);
  });
  res.json({ ok: true });
});

router.post("/library/song", (req: Request, res: Response) => {
  const incoming = req.body as Partial<Song>;
  const saved = mutateDb((db) => {
    let song = incoming.id ? db.songs.find((s) => s.id === incoming.id) : undefined;
    if (song) {
      Object.assign(song, incoming, { updatedAt: now() });
    } else {
      song = {
        playlistIds: [],
        liked: false,
        disliked: false,
        public: false,
        playCount: 0,
        commentCount: 0,
        styles: [],
        model: "juno-xl-quality",
        aceModel: "acestep-v15-xl-sft",
        type: "song",
        durationSeconds: 0,
        description: "",
        title: "Untitled",
        metadata: { weirdness: 50, styleInfluence: 50, instrumental: false },
        ...incoming,
        id: incoming.id || newId("song"),
        createdAt: now(),
        updatedAt: now(),
      } as Song;
      db.songs.unshift(song);
    }
    addHistory(db, `Saved "${song.title}"`);
    return song;
  });
  res.json({ ok: true, song: saved });
});

router.patch("/library/song/:id", (req: Request, res: Response) => {
  const updated = mutateDb((db) => {
    const song = db.songs.find((s) => s.id === req.params.id);
    if (!song) return null;
    const allowed = [
      "liked", "disliked", "public", "title", "commentCount", "comments", "playlistIds",
      "workspaceId", "trashed", "playCount", "description", "lyrics", "styles", "durationSeconds",
    ] as const;
    for (const key of allowed) {
      if (key in req.body) (song as any)[key] = req.body[key];
    }
    song.updatedAt = now();
    if ("trashed" in req.body) {
      song.trashedAt = req.body.trashed ? now() : undefined;
      addHistory(db, req.body.trashed ? `Trashed "${song.title}"` : `Restored "${song.title}"`);
    }
    return song;
  });
  if (!updated) {
    res.status(404).json({ error: "Song not found" });
    return;
  }
  res.json({ ok: true, song: updated });
});

router.delete("/library/song/:id", (req: Request, res: Response) => {
  mutateDb((db) => {
    const song = db.songs.find((s) => s.id === req.params.id);
    db.songs = db.songs.filter((s) => s.id !== req.params.id);
    if (song) addHistory(db, `Deleted forever "${song.title}"`);
  });
  res.json({ ok: true });
});

router.post("/export", (req: Request, res: Response) => {
  const ids: string[] = req.body?.songIds || [];
  const db = loadDb();
  const songs = db.songs.filter((s) => ids.includes(s.id));
  const project = req.body?.projectId ? db.projects.find((p) => p.id === req.body.projectId) : undefined;
  const manifest = {
    exportedAt: now(),
    app: "juno",
    project,
    songs: songs.map((s) => ({ ...s, audioFile: s.localAudioPath ? path.basename(s.localAudioPath) : null })),
  };
  const outDir = path.join(config.outputDir, "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `juno-export-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  mutateDb((d) => addHistory(d, project ? `Exported Studio project "${project.name}"` : `Exported ${songs.length} item(s)`));
  res.json({ ok: true, manifest, savedTo: file });
});
