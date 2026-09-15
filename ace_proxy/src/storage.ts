/** Local JSON persistence under the host-mounted /data directory.
 *
 * Juno stores its library database as a single JSON document at
 * /data/juno-db.json. This is intentionally simple: it is a single-user,
 * local-only application. Swap for SQLite if the library grows large.
 */
import fs from "fs";
import path from "path";
import { config } from "./config";
import { DEFAULT_SETTINGS, GenerationTask, JunoSettings, MidiRecord, Song, SongOperation, StudioProject } from "./types";

export interface JunoDb {
  songs: Song[];
  tasks: GenerationTask[];
  workspaces: { id: string; name: string; songIds: string[]; createdAt: string; updatedAt: string }[];
  playlists: { id: string; name: string; songIds: string[]; coverArtUrl?: string; createdAt: string; updatedAt: string }[];
  voices: { id: string; name: string; sourceAudioId?: string; description?: string; gender?: string; createdAt: string; updatedAt: string }[];
  styles: { id: string; name: string; styles: string[]; description?: string; liked: boolean; createdAt: string; updatedAt: string }[];
  lyrics: { id: string; title: string; text: string; createdAt: string; updatedAt: string }[];
  hooks: { id: string; title: string; durationSeconds: number; liked: boolean; createdAt: string }[];
  coverArt: { id: string; title: string; url: string; createdAt: string }[];
  history: { id: string; at: string; event: string }[];
  midi: MidiRecord[];
  projects: StudioProject[];
  settings: JunoSettings;
}

const EMPTY: JunoDb = {
  songs: [],
  tasks: [],
  workspaces: [],
  playlists: [],
  voices: [],
  styles: [],
  lyrics: [],
  hooks: [],
  coverArt: [],
  history: [],
  midi: [],
  projects: [],
  settings: DEFAULT_SETTINGS,
};

/** Trashed songs are permanently deleted after this many days. */
export const TRASH_TTL_DAYS = 14;

let corruptBackedUp = false;

function dbPath(): string {
  return path.join(config.dataDir, "juno-db.json");
}

export function loadDb(): JunoDb {
  try {
    const raw = fs.readFileSync(dbPath(), "utf8");
    const parsed = JSON.parse(raw);
    const db = {
      ...structuredClone(EMPTY),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
    backfillLineage(db);
    return db;
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      console.error("[juno-proxy] could not read library DB:", e?.message || e);
      // Never silently overwrite a corrupt DB with an empty one: keep a copy.
      try {
        const backup = dbPath().replace(/\.json$/, `.corrupt-${Date.now()}.json`);
        if (!corruptBackedUp) fs.copyFileSync(dbPath(), backup);
        corruptBackedUp = true;
      } catch {
        /* ignore */
      }
    }
    return structuredClone(EMPTY);
  }
}


/** Map a legacy `type` onto a lineage operation, for songs created before the
 *  lineage fields existed. */
const TYPE_TO_OPERATION: Record<string, SongOperation> = {
  cover: "cover",
  extended: "extend",
  mashup: "mashup",
  sample: "sample",
  reversed: "reverse",
  remix: "speed",
  cropped: "crop",
  replacement: "replace-section",
  upload: "upload",
  song: "generate",
};

/** Populate parentId / rootId / sourceIds / operation for any song that
 *  predates them.
 *
 *  Idempotent and non-destructive: it only ever fills in fields that are
 *  missing, so re-running it (every load) is a no-op once converged, and a
 *  song whose lineage was set explicitly at creation is never overwritten.
 *  Runs in memory on load — nothing is written until the next mutateDb, so a
 *  read-only process never rewrites the user's DB.
 */
export function backfillLineage(db: JunoDb): void {
  const byId = new Map(db.songs.map((s) => [s.id, s]));

  for (const song of db.songs) {
    if (!song.parentId && song.sourceSongId && byId.has(song.sourceSongId)) {
      song.parentId = song.sourceSongId;
    }
    if (!song.sourceIds || song.sourceIds.length === 0) {
      song.sourceIds = song.parentId ? [song.parentId] : [];
    }
    if (!song.operation) {
      song.operation = TYPE_TO_OPERATION[song.type] || (song.parentId ? "cover" : "generate");
    }
  }

  // rootId needs a walk, so resolve it after every parentId is known.
  for (const song of db.songs) {
    if (song.rootId && byId.has(song.rootId)) continue;
    song.rootId = resolveRoot(song, byId);
  }
}

/** Walk to the ultimate ancestor. Depth-capped and cycle-guarded: a corrupt or
 *  hand-edited DB must not hang the proxy on load. */
function resolveRoot(song: Song, byId: Map<string, Song>): string {
  const seen = new Set<string>([song.id]);
  let current = song;
  for (let depth = 0; depth < 64; depth++) {
    const parentId = current.parentId;
    if (!parentId) return current.id;
    const parent = byId.get(parentId);
    // A parent that was deleted ends the chain here rather than dangling.
    if (!parent || seen.has(parent.id)) return current.id;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
}

export function saveDb(db: JunoDb): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = dbPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbPath());
}

export function mutateDb<T>(fn: (db: JunoDb) => T): T {
  const db = loadDb();
  const result = fn(db);
  saveDb(db);
  return result;
}

export function addHistory(db: JunoDb, event: string): void {
  db.history.unshift({
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    event,
  });
  db.history = db.history.slice(0, 500);
}

/** Permanently delete songs trashed more than TRASH_TTL_DAYS ago.
 *  Returns the number of songs purged. Uses `trashedAt` when present,
 *  falling back to `updatedAt` for records trashed before this field
 *  existed. */
export function purgeExpiredTrash(db: JunoDb): number {
  const cutoff = Date.now() - TRASH_TTL_DAYS * 24 * 60 * 60 * 1000;
  const keep: Song[] = [];
  let purged = 0;
  for (const s of db.songs) {
    const trashedAt = s.trashed
      ? new Date(s.trashedAt || s.updatedAt).getTime()
      : Infinity;
    if (s.trashed && isFinite(trashedAt) && trashedAt < cutoff) {
      purged++;
      addHistory(db, `Auto-deleted "${s.title}" (trashed > ${TRASH_TTL_DAYS} days)`);
    } else {
      keep.push(s);
    }
  }
  db.songs = keep;
  return purged;
}
