/** ACE-Step model manager.
 *
 *  Why this exists: three XL DiTs (~9 GB each) + the 4B LM do not fit in
 *  32 GB, and ACE-Step silently falls back to its primary model when a job
 *  asks for one that is not loaded. So Juno keeps exactly ONE DiT resident
 *  and owns every model switch itself:
 *
 *   - Generation jobs go through a single serialized queue. Before a job is
 *     handed to ACE-Step, the manager makes sure the job's model is the one
 *     loaded (POST /v1/init), waiting for in-flight jobs on the old model
 *     to finish first. No silent fallback, no half-loaded slots.
 *   - Task polling runs HERE, not in the browser, so results are downloaded
 *     into the Library even if no tab is open.
 *   - Unload = restart the ACE-Step process (it has no unload endpoint).
 *     Optional idle auto-unload frees VRAM when nothing has run for a while.
 *   - status() is one snapshot the UI polls; no manual refreshing needed.
 */
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { aceClient, AceHealth } from "./aceClient";
import { config, Preset, PresetId, presetByAceModel } from "./config";
import { addHistory, loadDb, mutateDb } from "./storage";
import { normalizeAceStatus, unwrapAudioUrl } from "./tasks";
import { gpuMemory, programState, supervisorctl } from "./supervisor";
import { GenerationTask } from "./types";

type Op =
  | { kind: "task"; id: string }
  | { kind: "load"; preset: PresetId }
  | { kind: "unload"; reason: string; done: (err?: Error) => void };

export type AceActivity = "offline" | "starting" | "idle" | "loading" | "ready" | "generating" | "unloading";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const ops: Op[] = [];
let working = false;
let health: AceHealth = { ok: false, via: "none" };
let wasReachable = false;
/** False until the first health probe: a proxy restart must not fail jobs ACE-Step is still running. */
let healthChecked = false;
let processState = "UNKNOWN";
let busy: { kind: "loading" | "unloading" | "starting"; model?: string; since: string } | null = null;
let lastError: { message: string; at: string } | null = null;
let lastUsedAt = Date.now();
let vram: Awaited<ReturnType<typeof gpuMemory>> = null;
let pollTimer: NodeJS.Timeout | null = null;
let polling = false;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function labelOf(aceModel?: string | null) {
  return presetByAceModel(aceModel)?.label || aceModel || "model";
}

function friendlyError(msg: string): string {
  if (/out of memory|CUDA error: out of memory|OOM/i.test(msg)) {
    return `${msg} — the GPU ran out of memory. Unload models or close other GPU apps, then retry.`;
  }
  return msg;
}

function inFlight(db = loadDb()): GenerationTask[] {
  return db.tasks.filter((t) => t.aceTaskId && (t.status === "queued" || t.status === "running"));
}

function pendingSubmission(db = loadDb()): GenerationTask[] {
  return db.tasks.filter((t) => !t.aceTaskId && (t.status === "queued" || t.status === "running"));
}

/** Update a task and its song together. */
function patchTask(taskId: string, patch: Partial<GenerationTask>, songExtra: Record<string, unknown> = {}) {
  mutateDb((db) => {
    const t = db.tasks.find((x) => x.id === taskId);
    if (!t) return;
    Object.assign(t, patch, { updatedAt: now() });
    const s = db.songs.find((x) => x.id === t.songId);
    if (s) {
      if (patch.status) s.generationStatus = patch.status;
      if ("error" in patch) s.generationError = patch.error;
      if ("stage" in patch) s.generationStage = patch.stage;
      if ("progress" in patch) s.generationProgress = patch.progress;
      if (patch.aceTaskId) s.aceTaskId = patch.aceTaskId;
      Object.assign(s, songExtra);
      s.updatedAt = now();
    }
  });
}

async function refreshHealth(): Promise<AceHealth> {
  health = await aceClient.health();
  if (!health.ok) {
    processState = await programState(config.aceProgram);
  } else {
    processState = "RUNNING";
  }
  // ACE-Step came back after being unreachable: anything that was running
  // inside the old process is gone.
  if (health.ok && !wasReachable && healthChecked) {
    const lost = inFlight();
    if (lost.length) {
      for (const t of lost) {
        patchTask(t.id, {
          status: "failed",
          error: "ACE-Step restarted while this was generating. Press Retry.",
          stage: undefined,
        });
      }
    }
    if (health.loadedModel) lastUsedAt = Date.now();
  }
  wasReachable = health.ok;
  healthChecked = true;
  return health;
}

async function waitForAce(timeoutMs: number, stage?: (s: string) => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let started = false;
  while (Date.now() < deadline) {
    const h = await refreshHealth();
    if (h.ok) return;
    if (!started && /STOPPED|EXITED|FATAL|BACKOFF/.test(processState)) {
      started = true;
      stage?.("Starting ACE-Step…");
      await supervisorctl(["start", config.aceProgram]).catch(() => undefined);
    }
    await sleep(2000);
  }
  throw new Error("ACE-Step API did not come up. Check `docker compose logs juno` for the acestep program.");
}

/* ------------------------------------------------------------------ */
/* Model load / unload                                                 */
/* ------------------------------------------------------------------ */

async function ensureModel(preset: Preset, onStage?: (s: string) => void): Promise<void> {
  if (!health.ok) {
    busy = { kind: "starting", since: now() };
    onStage?.("Waiting for ACE-Step to start…");
    try {
      await waitForAce(4 * 60 * 1000, onStage);
    } finally {
      busy = null;
    }
  }
  await refreshHealth();
  if (health.loadedModel === preset.aceModel) return;

  // Never swap the DiT under a running job.
  let waited = false;
  while (inFlight().length > 0) {
    if (!waited) onStage?.(`Waiting for the current generation to finish before switching to ${preset.label}…`);
    waited = true;
    await sleep(2500);
  }

  const from = health.loadedModel;
  busy = { kind: "loading", model: preset.aceModel, since: now() };
  onStage?.(`Loading ${preset.label}${from ? ` (replacing ${labelOf(from)})` : ""}…`);
  console.log(`[juno-proxy] loading ${preset.aceModel} (was ${from || "nothing"})`);
  try {
    await aceClient.init({
      model: preset.aceModel,
      slot: 1,
      init_llm: !health.llmInitialized,
      lm_model_path: config.lmModel,
    });
    lastError = null;
    lastUsedAt = Date.now();
    mutateDb((db) => addHistory(db, `Loaded ${preset.label}`));
  } catch (e: any) {
    const msg = friendlyError(e?.message || String(e));
    lastError = { message: `Could not load ${preset.label}: ${msg}`, at: now() };
    mutateDb((db) => addHistory(db, `Failed to load ${preset.label}`));
    throw new Error(lastError.message);
  } finally {
    busy = null;
    await refreshHealth();
  }
  // /v1/init can report success while the LM failed; surface it.
  if (health.loadedModel !== preset.aceModel) {
    throw new Error(`ACE-Step reports ${health.loadedModel || "no model"} loaded after initializing ${preset.label}.`);
  }
}

async function doUnload(reason: string): Promise<void> {
  busy = { kind: "unloading", since: now() };
  try {
    for (const t of inFlight()) {
      patchTask(t.id, { status: "failed", error: "Models were unloaded while this was generating. Press Retry.", stage: undefined });
    }
    await supervisorctl(["restart", config.aceProgram], 180000);
    wasReachable = false;
    await waitForAce(4 * 60 * 1000);
    mutateDb((db) => addHistory(db, `Unloaded models (${reason})`));
  } catch (e: any) {
    lastError = { message: `Unload failed: ${e?.message || e}`, at: now() };
    throw e;
  } finally {
    busy = null;
    await refreshHealth();
  }
}

/* ------------------------------------------------------------------ */
/* Serialized worker                                                   */
/* ------------------------------------------------------------------ */

async function processTask(taskId: string): Promise<void> {
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task || task.aceTaskId || task.status === "failed" || task.status === "succeeded") return;
  const song = db.songs.find((s) => s.id === task.songId);
  if (!song || song.trashed) {
    patchTask(taskId, { status: "failed", error: "Cancelled (song was trashed)" });
    return;
  }
  const preset = config.presets[task.model as PresetId] || config.presets["juno-xl-quality"];
  const setStage = (stage: string) => patchTask(taskId, { stage, status: "queued" });

  try {
    await ensureModel(preset, setStage);
    setStage("Submitting to ACE-Step…");
    const aceRes = await aceClient.releaseTask(task.requestPayload as Record<string, unknown>);
    const aceTaskId = String(aceRes?.data?.task_id ?? aceRes?.task_id ?? aceRes?.id ?? "");
    if (!aceTaskId) throw new Error(`ACE-Step did not return a task id: ${JSON.stringify(aceRes).slice(0, 300)}`);
    patchTask(taskId, { aceTaskId, status: "queued", stage: "Queued in ACE-Step", submittedAt: now() });
    lastUsedAt = Date.now();
  } catch (e: any) {
    const msg = friendlyError(e?.message || String(e));
    patchTask(taskId, { status: "failed", error: msg, stage: undefined });
    mutateDb((d) => addHistory(d, `Generation failed for "${song.title}"`));
  }
}

async function work(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (ops.length) {
      const op = ops.shift()!;
      try {
        if (op.kind === "task") await processTask(op.id);
        else if (op.kind === "load") await ensureModel(config.presets[op.preset]);
        else if (op.kind === "unload") {
          try {
            await doUnload(op.reason);
            op.done();
          } catch (e: any) {
            op.done(e);
          }
        }
      } catch (e: any) {
        console.error("[juno-proxy] model manager op failed:", op.kind, e?.message || e);
      }
    }
  } finally {
    working = false;
  }
}

/* ------------------------------------------------------------------ */
/* Result polling (server-side)                                        */
/* ------------------------------------------------------------------ */

/** Download an ACE-Step audio path into /outputs/library. */
export async function saveLocalCopy(acePath: string, songId?: string): Promise<string> {
  acePath = unwrapAudioUrl(acePath);
  fs.mkdirSync(config.libraryDir, { recursive: true });
  const ext = path.extname(acePath) || ".wav";
  const safe = path.basename(acePath, ext).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 48);
  const local = path.join(config.libraryDir, `${songId || "audio"}_${safe}${ext}`);
  if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;

  const candidates = [acePath];
  if (!path.isAbsolute(acePath)) candidates.push(path.join(config.aceWorkDir, acePath));
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

function pickTaskResult(aceRaw: any, aceTaskId: string): any {
  let raw = aceRaw;
  for (let i = 0; i < 2; i++) {
    if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.data != null && raw.status == null) raw = raw.data;
  }
  if (!raw) return undefined;
  const idOf = (r: any) => String(r?.task_id ?? r?.id ?? r?.taskId ?? "");
  if (Array.isArray(raw)) return raw.find((r) => idOf(r) === aceTaskId) ?? (raw.length === 1 ? raw[0] : undefined);
  if (typeof raw === "object") {
    if (raw[aceTaskId] != null) return raw[aceTaskId];
    const res = raw.results ?? raw.tasks;
    if (Array.isArray(res)) return res.find((r: any) => idOf(r) === aceTaskId);
  }
  return raw;
}

let lastRawLogAt = 0;

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await refreshHealth();
    if (Math.random() < 0.34) vram = await gpuMemory();

    const tasks = inFlight();
    if (tasks.length && health.ok) {
      let aceRaw: any;
      try {
        aceRaw = await aceClient.queryResult(tasks.map((t) => t.aceTaskId));
      } catch (e: any) {
        console.warn("[juno-proxy] query_result failed:", e?.message || e);
        aceRaw = null;
      }
      if (aceRaw) {
        for (const task of tasks) {
          const norm = normalizeAceStatus(pickTaskResult(aceRaw, task.aceTaskId));
          if (norm.status === "succeeded" && norm.audioPath) {
            try {
              const localAudioPath = await saveLocalCopy(norm.audioPath, task.songId);
              patchTask(
                task.id,
                { status: "succeeded", resultAudioPath: norm.audioPath, localAudioPath, stage: undefined, progress: 1, error: undefined },
                { localAudioPath, audioUrl: `/library-audio/${path.basename(localAudioPath)}` }
              );
              mutateDb((d) => {
                const s = d.songs.find((x) => x.id === task.songId);
                addHistory(d, `Generated "${s?.title || task.songId}"`);
              });
              lastUsedAt = Date.now();
            } catch (e: any) {
              patchTask(task.id, { status: "failed", error: `Audio download failed: ${e?.message || e}`, stage: undefined });
            }
          } else if (norm.status === "failed") {
            patchTask(task.id, { status: "failed", error: friendlyError(norm.error || "failed"), stage: undefined });
            lastUsedAt = Date.now();
          } else if (norm.emptySuccess) {
            const n = (task.emptySuccessPolls || 0) + 1;
            if (n > 10) patchTask(task.id, { status: "failed", error: "ACE-Step finished but returned no audio file." });
            else patchTask(task.id, { status: "running", stage: "Finishing", emptySuccessPolls: n });
          } else {
            const stage = norm.status === "queued" ? "Queued in ACE-Step" : prettyStage(norm.stage);
            patchTask(task.id, { status: norm.status, stage, progress: norm.progress });
          }
        }
        if (Date.now() - lastRawLogAt > 60000 && inFlight().length) {
          lastRawLogAt = Date.now();
          console.log("[juno-proxy] ACE /query_result raw (truncated):", JSON.stringify(aceRaw).slice(0, 800));
        }
      }
    }

    // Idle auto-unload.
    const { settings } = loadDb();
    const idleMs = settings.aceIdleUnloadMinutes * 60000;
    if (
      idleMs > 0 &&
      health.ok &&
      health.loadedModel &&
      !busy &&
      !working &&
      ops.length === 0 &&
      inFlight().length === 0 &&
      pendingSubmission().length === 0 &&
      Date.now() - lastUsedAt > idleMs
    ) {
      console.log(`[juno-proxy] idle for ${settings.aceIdleUnloadMinutes} min — unloading models`);
      requestUnload(`idle ${settings.aceIdleUnloadMinutes} min`, false).catch(() => undefined);
    }
  } finally {
    polling = false;
  }
}

function prettyStage(stage?: string): string {
  if (!stage) return "Generating";
  const s = stage.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export const modelManager = {
  start() {
    // Re-queue anything that was waiting for submission when the proxy died.
    for (const t of pendingSubmission()) ops.push({ kind: "task", id: t.id });
    if (ops.length) void work();
    pollTimer = setInterval(() => void pollOnce(), 3000);
    void pollOnce();
  },

  stop() {
    if (pollTimer) clearInterval(pollTimer);
  },

  enqueueTask(taskId: string) {
    ops.push({ kind: "task", id: taskId });
    void work();
  },

  /** Preload a preset. Coalesces: only the latest requested preload stays queued. */
  requestLoad(preset: PresetId) {
    for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === "load") ops.splice(i, 1);
    if (health.loadedModel === config.presets[preset].aceModel && !busy) return;
    ops.push({ kind: "load", preset });
    void work();
  },

  /** Unload by restarting ACE-Step. Refuses while generating unless forced. */
  async requestUnload(reason: string, force: boolean) {
    return requestUnload(reason, force);
  },

  touch() {
    lastUsedAt = Date.now();
  },

  health: () => health,

  async status() {
    const db = loadDb();
    const active = inFlight(db).length;
    const waiting = pendingSubmission(db).length;
    let activity: AceActivity;
    if (busy?.kind === "unloading") activity = "unloading";
    else if (busy?.kind === "loading") activity = "loading";
    else if (busy?.kind === "starting" || (!health.ok && /STARTING|BACKOFF/.test(processState))) activity = "starting";
    else if (!health.ok) activity = "offline";
    else if (active > 0) activity = "generating";
    else if (health.loadedModel) activity = "ready";
    else activity = "idle";

    const idleMs = db.settings.aceIdleUnloadMinutes * 60000;
    const loadedPreset = presetByAceModel(health.loadedModel);
    return {
      reachable: health.ok,
      process: processState,
      activity,
      loadedModel: health.loadedModel || null,
      loadedPreset: loadedPreset?.id || null,
      loadedLabel: loadedPreset?.label || health.loadedModel || null,
      llmLoaded: !!health.llmInitialized,
      loadedLm: health.loadedLmModel || null,
      busy: busy ? { ...busy, label: busy.model ? labelOf(busy.model) : undefined } : null,
      lastError,
      activeTasks: active,
      waitingTasks: waiting,
      idleUnloadAt:
        idleMs > 0 && health.loadedModel && active === 0 && waiting === 0
          ? new Date(lastUsedAt + idleMs).toISOString()
          : null,
      detail: health.ok ? undefined : health.detail,
    };
  },

  vram: () => vram,
};

async function requestUnload(reason: string, force: boolean): Promise<void> {
  if (busy?.kind === "unloading" || ops.some((o) => o.kind === "unload")) return;
  if (!force && (inFlight().length > 0 || working)) {
    throw new Error("A generation is running. Wait for it to finish, or force unload (it will be cancelled).");
  }
  // Drop queued preloads; unload goes first.
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === "load") ops.splice(i, 1);
  if (working) {
    // Forced while the worker is mid-op (e.g. waiting on a load): restart now,
    // the worker's in-progress call will fail and move on.
    await doUnload(reason);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    ops.unshift({ kind: "unload", reason, done: (err) => (err ? reject(err) : resolve()) });
    void work();
  });
}
