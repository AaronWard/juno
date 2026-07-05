/** Local JSON persistence under the host-mounted /data directory.
 *
 * Juno stores its library database as a single JSON document at
 * /data/juno-db.json. This is intentionally simple: it is a single-user,
 * local-only application. Swap for SQLite if the library grows large.
 */
import fs from "fs";
import path from "path";
import { config } from "./config";
import { GenerationTask, Song } from "./types";

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
};

function dbPath(): string {
  return path.join(config.dataDir, "juno-db.json");
}

export function loadDb(): JunoDb {
  try {
    const raw = fs.readFileSync(dbPath(), "utf8");
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY);
  }
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
