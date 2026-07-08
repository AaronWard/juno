/** Juno API routes. The React frontend calls ONLY these /api/* endpoints —
 *  never ACE-Step directly. See docs/API_MAPPING.md for the full table.
 */
import { exec } from "child_process";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { aceClient } from "./aceClient";
import { config } from "./config";
import { addHistory, loadDb, mutateDb, purgeExpiredTrash } from "./storage";
import { buildAcePayload, findAudioPath, normalizeAceStatus, presetFor, unwrapAudioUrl } from "./tasks";
import { GenerateRequest, GenerationTask, Song } from "./types";
import { upload } from "./uploads";

export const router = express.Router();

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const SONG_TYPES: Song["type"][] = [
  "song", "upload", "cover", "remix", "extended",
  "mashup", "sample", "reversed", "cropped", "replacement",
];

/* ------------------------------------------------------------------ */
/* GET /api/health                                                     */
/* ------------------------------------------------------------------ */
router.get("/health", async (_req: Request, res: Response) => {
  const ace = await aceClient.health();
  res.json({
    juno: "ok",
    aceStep: ace.ok ? "ok" : "unavailable",
    aceStepCheckedVia: ace.via,
    aceStepDetail: ace.detail,
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

/* ------------------------------------------------------------------ */
/* GET /api/models — normalized Juno presets                           */
/* ------------------------------------------------------------------ */
router.get("/models", async (_req: Request, res: Response) => {
  let aceModels: any = null;
  let aceOk = false;
  try {
    aceModels = await aceClient.models();
    aceOk = true;
  } catch {
    /* ACE-Step offline: presets are still returned so the UI can render */
  }
  const loadedNames = JSON.stringify(aceModels || "");
  const presets = Object.values(config.presets).map((p) => ({
    id: p.id,
    label: p.label,
    aceModel: p.aceModel,
    ditPath: p.ditPath,
    lmPath: p.lmPath,
    inferenceSteps: p.inferenceSteps,
    cfgEnabled: p.cfgEnabled,
    description: p.description,
    available: aceOk,
    loaded: aceOk && loadedNames.includes(p.aceModel),
  }));
  res.json({ presets, aceStep: aceOk ? "ok" : "unavailable", raw: aceModels });
});

/* ------------------------------------------------------------------ */
/* POST /api/models/init — hot-swap the primary (slot 1) XL model      */
/* ------------------------------------------------------------------ */
router.post("/models/init", async (req: Request, res: Response) => {
  const preset = presetFor(req.body?.model);
  try {
    const result = await aceClient.init({
      slot: preset.slot,
      model: preset.aceModel,
      config_path: preset.ditPath,
      init_llm: true,
      lm_model_path: preset.lmPath,
      lm_backend: config.lmBackend,
    });
    mutateDb((db) => addHistory(db, `Initialized model ${preset.label}`));
    res.json({ ok: true, preset: preset.id, aceModel: preset.aceModel, result });
  } catch (e: any) {
    res.status(502).json({
      ok: false,
      preset: preset.id,
      error: `Model initialization failed: ${e?.message || e}`,
    });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/models/unload — free VRAM by restarting the ACE-Step      */
/* process via supervisord. Models lazy-load again on the next task.   */
/* ------------------------------------------------------------------ */
router.post("/models/unload", (_req: Request, res: Response) => {
  exec("supervisorctl restart acestep", { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ ok: false, error: (stderr || err.message || "").trim() });
      return;
    }
    mutateDb((db) => addHistory(db, "Unloaded models (restarted ACE-Step)"));
    res.json({ ok: true, detail: (stdout || "").trim() });
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/generate — submit an ACE-Step task                        */
/* ------------------------------------------------------------------ */
router.post("/generate", async (req: Request, res: Response) => {
  const form = (req.body || {}) as GenerateRequest;
  const preset = presetFor(form.model);
  const acePayload = buildAcePayload(form);
  const now = new Date().toISOString();

  const songId = newId("song");
  const song: Song = {
    id: songId,
    title: form.title || generatedTitle(),
    description: [form.prompt, (form.styles || []).join(", ")]
      .filter(Boolean)
      .join(" — "),
    lyrics: form.instrumental ? undefined : form.lyrics,
    styles: form.styles || [],
    model: preset.id as Song["model"],
    aceModel: preset.aceModel as Song["aceModel"],
    type: typeForTask(form.taskType),
    durationSeconds: form.duration ?? 120,
    playlistIds: [],
    workspaceId: form.workspaceId,
    liked: false,
    disliked: false,
    public: false,
    playCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    sourceSongId: form.sourceSongId,
    generationStatus: "queued",
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

  try {
    const aceRes = await aceClient.releaseTask(acePayload);
    const aceTaskId = String(
      aceRes?.task_id ?? aceRes?.id ?? aceRes?.data?.task_id ?? newId("ace")
    );
    song.aceTaskId = aceTaskId;

    const task: GenerationTask = {
      id: newId("task"),
      aceTaskId,
      songId,
      status: "queued",
      model: song.model,
      aceModel: song.aceModel,
      requestPayload: acePayload,
      createdAt: now,
      updatedAt: now,
    };

    mutateDb((db) => {
      db.songs.unshift(song);
      db.tasks.unshift(task);
      addHistory(db, `Submitted ACE-Step task for "${song.title}"`);
    });

    res.json({ ok: true, taskId: task.id, aceTaskId, song });
  } catch (e: any) {
    song.generationStatus = "failed";
    song.generationError = `ACE-Step task submission failed: ${e?.message || e}`;
    mutateDb((db) => {
      db.songs.unshift(song);
      addHistory(db, `Failed to submit task for "${song.title}"`);
    });
    res
      .status(502)
      .json({ ok: false, song, error: song.generationError });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/tasks/query — poll ACE-Step and normalize status          */
/* ------------------------------------------------------------------ */
let lastRawLogAt = 0;

router.post("/tasks/query", async (req: Request, res: Response) => {
  const ids: string[] = req.body?.taskIds || [];
  const db = loadDb();
  const tasks = db.tasks.filter(
    (t) => ids.includes(t.id) || ids.includes(t.aceTaskId)
  );
  if (tasks.length === 0) {
    res.json({ tasks: [] });
    return;
  }

  let aceRaw: any = null;
  try {
    aceRaw = await aceClient.queryResult(tasks.map((t) => t.aceTaskId));
  } catch (e: any) {
    res.status(502).json({
      error: `ACE-Step query failed: ${e?.message || e}`,
      tasks: tasks.map((t) => ({ ...t })),
    });
    return;
  }

  const results = await Promise.all(
    tasks.map(async (task) => {
      const raw = pickTaskResult(aceRaw, task.aceTaskId);
      const norm = normalizeAceStatus(raw);
      let localAudioUrl: string | undefined;
      let localAudioPath: string | undefined;

      if (norm.status === "succeeded" && norm.audioPath) {
        try {
          localAudioPath = await saveLocalCopy(norm.audioPath, task.songId);
          localAudioUrl = `/library-audio/${path.basename(localAudioPath)}`;
        } catch (e: any) {
          norm.status = "failed";
          norm.error = `Audio download failed: ${e?.message || e}`;
        }
      }

      mutateDb((d) => {
        const t = d.tasks.find((x) => x.id === task.id);
        const s = d.songs.find((x) => x.id === task.songId);
        if (t) {
          t.status = norm.status;
          t.error = norm.error;
          t.resultAudioPath = norm.audioPath;
          t.localAudioPath = localAudioPath ?? t.localAudioPath;
          t.updatedAt = new Date().toISOString();
        }
        if (s) {
          s.generationStatus = norm.status;
          s.generationError = norm.error;
          if (localAudioPath) {
            s.localAudioPath = localAudioPath;
            s.audioUrl = localAudioUrl;
            addHistory(d, `Downloaded generated audio for "${s.title}"`);
          }
          s.updatedAt = new Date().toISOString();
        }
      });

      return {
        taskId: task.id,
        aceTaskId: task.aceTaskId,
        songId: task.songId,
        status: norm.status,
        audioUrl: localAudioUrl,
        error: norm.error,
      };
    })
  );

  // If anything is still not terminal, periodically dump the raw ACE-Step
  // reply so a mismatched response shape is visible in `docker compose logs`.
  if (
    results.some((r) => r.status === "queued" || r.status === "running") &&
    Date.now() - lastRawLogAt > 30000
  ) {
    lastRawLogAt = Date.now();
    try {
      console.log(
        "[juno-proxy] ACE /query_result raw (truncated):",
        JSON.stringify(aceRaw).slice(0, 1500)
      );
    } catch {
      /* ignore */
    }
  }

  res.json({ tasks: results });
});

/* ------------------------------------------------------------------ */
/* GET /api/audio?path= — proxy ACE-Step /v1/audio, keep a local copy  */
/* ------------------------------------------------------------------ */
router.get("/audio", async (req: Request, res: Response) => {
  const p = String(req.query.path || "");
  if (!p) {
    res.status(400).json({ error: "Missing ?path=" });
    return;
  }
  try {
    const local = await saveLocalCopy(p);
    res.sendFile(local);
  } catch (e: any) {
    res.status(502).json({ error: `Audio fetch failed: ${e?.message || e}` });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/upload — save audio.                                      */
/* Plain uploads land in /uploads; PROCESSED derivatives (Reverse,     */
/* Crop, Speed, Sample, Mashup — anything with a type other than       */
/* "upload") are moved into /outputs/library and served from there.    */
/* ------------------------------------------------------------------ */
router.post("/upload", upload.single("file"), (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const b = (req.body || {}) as Record<string, string>;
  const type = SONG_TYPES.includes(b.type as Song["type"])
    ? (b.type as Song["type"])
    : "upload";
  let styles: string[] = [];
  try {
    if (b.styles) styles = JSON.parse(b.styles);
  } catch {
    /* ignore malformed styles */
  }

  // Processed derivatives belong in the Library output dir, not /uploads.
  let filePath = file.path;
  let audioUrl = `/upload-audio/${path.basename(file.path)}`;
  if (type !== "upload") {
    try {
      fs.mkdirSync(config.libraryDir, { recursive: true });
      const dest = path.join(config.libraryDir, path.basename(file.path));
      try {
        fs.renameSync(file.path, dest);
      } catch {
        // /uploads and /outputs are separate bind mounts (EXDEV) — copy.
        fs.copyFileSync(file.path, dest);
        fs.unlinkSync(file.path);
      }
      filePath = dest;
      audioUrl = `/library-audio/${path.basename(dest)}`;
    } catch (e) {
      console.error("[juno-proxy] failed to move processed audio to library:", e);
    }
  }

  const now = new Date().toISOString();
  const song: Song = {
    id: newId(type === "upload" ? "upl" : "song"),
    title:
      b.title ||
      path.basename(file.originalname, path.extname(file.originalname)),
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
    createdAt: now,
    updatedAt: now,
    sourceSongId: b.sourceSongId || undefined,
    localAudioPath: filePath,
    audioUrl,
    generationStatus: "idle",
    metadata: { weirdness: 50, styleInfluence: 50, instrumental: false },
  };
  mutateDb((db) => {
    db.songs.unshift(song);
    addHistory(
      db,
      type === "upload"
        ? `Uploaded "${file.originalname}"`
        : `Saved processed audio "${song.title}"`
    );
  });
  res.json({ ok: true, asset: song });
});

/* ------------------------------------------------------------------ */
/* GET /api/library                                                    */
/* ------------------------------------------------------------------ */
router.get("/library", (_req: Request, res: Response) => {
  const db = mutateDb((d) => {
    purgeExpiredTrash(d);
    return d;
  });
  res.json({
    songs: db.songs.filter((s) => !s.trashed),
    trash: db.songs.filter((s) => s.trashed),
    tasks: db.tasks,
    workspaces: db.workspaces,
    playlists: db.playlists,
    voices: db.voices,
    styles: db.styles,
    lyrics: db.lyrics,
    hooks: db.hooks,
    coverArt: db.coverArt,
    history: db.history,
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/library/workspace — create a workspace                    */
/* ------------------------------------------------------------------ */
router.post("/library/workspace", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing workspace name" });
    return;
  }
  const now = new Date().toISOString();
  const workspace = mutateDb((db) => {
    const w = { id: newId("ws"), name, songIds: [], createdAt: now, updatedAt: now };
    db.workspaces.push(w);
    addHistory(db, `Created workspace "${name}"`);
    return w;
  });
  res.json({ ok: true, workspace });
});

/* ------------------------------------------------------------------ */
/* POST /api/library/playlist — create a playlist                      */
/* PATCH /api/library/playlist/:id — rename / set songIds              */
/* ------------------------------------------------------------------ */
router.post("/library/playlist", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing playlist name" });
    return;
  }
  const now = new Date().toISOString();
  const playlist = mutateDb((db) => {
    const p = { id: newId("pl"), name, songIds: [] as string[], createdAt: now, updatedAt: now };
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
    if (typeof req.body?.name === "string" && req.body.name.trim()) {
      p.name = req.body.name.trim();
    }
    if (Array.isArray(req.body?.songIds)) {
      p.songIds = req.body.songIds.map(String);
    }
    if (typeof req.body?.coverArtUrl === "string") {
      p.coverArtUrl = req.body.coverArtUrl;
    }
    p.updatedAt = new Date().toISOString();
    return p;
  });
  if (!updated) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json({ ok: true, playlist: updated });
});

/* ------------------------------------------------------------------ */
/* POST /api/library/style — save a style preset (used by 🗂 in Styles)*/
/* ------------------------------------------------------------------ */
router.post("/library/style", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const styles: string[] = Array.isArray(req.body?.styles)
    ? req.body.styles.map(String).filter(Boolean)
    : [];
  if (!name || !styles.length) {
    res.status(400).json({ error: "Missing preset name or styles" });
    return;
  }
  const now = new Date().toISOString();
  const style = mutateDb((db) => {
    const s = { id: newId("style"), name, styles, liked: false, createdAt: now, updatedAt: now };
    db.styles.push(s);
    addHistory(db, `Saved style preset "${name}"`);
    return s;
  });
  res.json({ ok: true, style });
});

/* ------------------------------------------------------------------ */
/* POST /api/library/voice — save an offline voice profile             */
/* ------------------------------------------------------------------ */
router.post("/library/voice", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing voice name" });
    return;
  }
  const now = new Date().toISOString();
  const voice = mutateDb((db) => {
    const v = {
      id: newId("voice"),
      name,
      description: req.body?.description ? String(req.body.description) : undefined,
      gender: req.body?.gender ? String(req.body.gender) : undefined,
      sourceAudioId: req.body?.sourceAudioId ? String(req.body.sourceAudioId) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.voices.push(v);
    addHistory(db, `Created voice profile "${name}"`);
    return v;
  });
  res.json({ ok: true, voice });
});

/* ------------------------------------------------------------------ */
/* POST /api/library/song — create/update a song record                */
/* ------------------------------------------------------------------ */
router.post("/library/song", (req: Request, res: Response) => {
  const incoming = req.body as Partial<Song>;
  const saved = mutateDb((db) => {
    let song = incoming.id ? db.songs.find((s) => s.id === incoming.id) : undefined;
    if (song) {
      Object.assign(song, incoming, { updatedAt: new Date().toISOString() });
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Song;
      db.songs.unshift(song);
    }
    addHistory(db, `Saved "${song.title}"`);
    return song;
  });
  res.json({ ok: true, song: saved });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/library/song/:id — metadata updates (like, trash, ...)   */
/* ------------------------------------------------------------------ */
router.patch("/library/song/:id", (req: Request, res: Response) => {
  const updated = mutateDb((db) => {
    const song = db.songs.find((s) => s.id === req.params.id);
    if (!song) return null;
    const allowed = [
      "liked",
      "disliked",
      "public",
      "title",
      "commentCount",
      "comments",
      "playlistIds",
      "workspaceId",
      "trashed",
      "playCount",
      "description",
      "lyrics",
      "styles",
      "durationSeconds",
    ] as const;
    for (const key of allowed) {
      if (key in req.body) (song as any)[key] = req.body[key];
    }
    song.updatedAt = new Date().toISOString();
    if ("trashed" in req.body) {
      song.trashedAt = req.body.trashed ? new Date().toISOString() : undefined;
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

/* Delete forever */
router.delete("/library/song/:id", (req: Request, res: Response) => {
  mutateDb((db) => {
    const song = db.songs.find((s) => s.id === req.params.id);
    db.songs = db.songs.filter((s) => s.id !== req.params.id);
    if (song) addHistory(db, `Deleted forever "${song.title}"`);
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* POST /api/export — local export of metadata or audio                */
/* ------------------------------------------------------------------ */
router.post("/export", (req: Request, res: Response) => {
  const ids: string[] = req.body?.songIds || [];
  const db = loadDb();
  const songs = db.songs.filter((s) => ids.includes(s.id));
  const manifest = {
    exportedAt: new Date().toISOString(),
    app: "juno",
    songs: songs.map((s) => ({
      ...s,
      audioFile: s.localAudioPath ? path.basename(s.localAudioPath) : null,
    })),
  };
  const outDir = path.join(config.outputDir, "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `juno-export-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  mutateDb((d) => addHistory(d, `Exported ${songs.length} item(s)`));
  res.json({ ok: true, manifest, savedTo: file });
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function typeForTask(taskType?: string): Song["type"] {
  switch (taskType) {
    case "cover":
      return "cover";
    case "repaint":
      return "replacement";
    case "lego":
      return "mashup";
    case "complete":
      return "extended";
    default:
      return "song";
  }
}

const TITLES = ["God's Promise", "Late Signal", "Soft Static", "The Long Horizon", "Night Choir", "Glass Weather", "Slow Bloom", "Neon Prayer"];
function generatedTitle(): string {
  return TITLES[Math.floor(Math.random() * TITLES.length)];
}

/** Pull the result object for one task id out of an ACE-Step reply.
 *  Handles: bare objects, arrays, {results: ...}, {tasks: ...},
 *  {data: ...} envelopes (single or nested), and id-keyed maps. */
function pickTaskResult(aceRaw: any, aceTaskId: string): any {
  let raw = aceRaw;
  // Unwrap common {code, message, data} envelopes (possibly nested once).
  for (let i = 0; i < 2; i++) {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      raw.data != null &&
      raw.status == null &&
      raw.audio_path == null
    ) {
      raw = raw.data;
    }
  }
  if (!raw) return aceRaw;

  const idOf = (r: any) => String(r?.task_id ?? r?.id ?? r?.taskId ?? "");
  const matchIn = (arr: any[]) => arr.find((r) => idOf(r) === aceTaskId);

  if (Array.isArray(raw)) return matchIn(raw) ?? raw[0];
  if (typeof raw === "object") {
    if (raw[aceTaskId] != null) return raw[aceTaskId];
    const res = raw.results ?? raw.tasks;
    if (Array.isArray(res)) return matchIn(res) ?? res[0];
    if (res && typeof res === "object") return res[aceTaskId] ?? raw;
  }
  return raw;
}

/** Download an ACE-Step audio path into /outputs/library and return the
 *  local absolute path. Existing copies are reused. Handles absolute
 *  container paths, paths RELATIVE to the ACE-Step working directory, and
 *  falls back to fetching over HTTP via /v1/audio. */
async function saveLocalCopy(acePath: string, songId?: string): Promise<string> {
  acePath = unwrapAudioUrl(acePath);
  fs.mkdirSync(config.libraryDir, { recursive: true });
  const ext = path.extname(acePath) || ".wav";
  const name = `${songId || "audio"}_${sanitize(path.basename(acePath, ext))}${ext}`;
  const local = path.join(config.libraryDir, name);
  if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;

  const candidates = [acePath];
  if (!path.isAbsolute(acePath)) {
    candidates.push(path.join(config.aceWorkDir, acePath));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      fs.copyFileSync(c, local);
      return local;
    }
  }
  const res = await aceClient.fetchAudio(acePath);
  if (!res.body) throw new Error("empty audio response");
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(local));
  return local;
}

// keep the findAudioPath export referenced so tree-shaking/lint stays quiet
void findAudioPath;

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 48);
}
