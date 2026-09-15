/** MuScriptor (audio -> MIDI) integration.
 *
 *  MuScriptor ships a FastAPI server (`muscriptor serve`). Juno runs it as a
 *  supervisord program with autostart=false and manages it like ACE-Step:
 *
 *   - started on demand when a transcription is queued (first start
 *     downloads the gated weights into the HF cache — accept the licence at
 *     huggingface.co/MuScriptor/muscriptor-medium first);
 *   - one job at a time (the server itself only allows one), streamed over
 *     SSE from POST /transcribe so the UI gets real chunk progress;
 *   - stopped again after N idle minutes to hand the VRAM back.
 *
 *  Results are written to /outputs/midi/<id>.mid (+ .quantized.mid when a
 *  steady tempo was detected). Piano-roll edits are saved as <id>.edit.mid,
 *  so the original transcription is always recoverable.
 */
import fs from "fs";
import path from "path";
import { config } from "./config";
import { addHistory, loadDb, mutateDb } from "./storage";
import { programState, supervisorctl } from "./supervisor";
import { MidiRecord } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const BASE = () => config.midiApiUrl.replace(/\/$/, "");

export const MIDI_INSTRUMENTS = [
  "acoustic_piano", "electric_piano", "chromatic_percussion", "organ", "acoustic_guitar",
  "clean_electric_guitar", "distorted_electric_guitar", "acoustic_bass", "electric_bass",
  "violin", "viola", "cello", "contrabass", "orchestral_harp", "timpani", "string_ensemble",
  "synth_strings", "voice", "orchestra_hit", "trumpet", "trombone", "tuba", "french_horn",
  "brass_section", "soprano_and_alto_sax", "tenor_sax", "baritone_sax", "oboe", "english_horn",
  "bassoon", "clarinet", "flutes", "synth_lead", "synth_pad", "drums",
];

const queue: string[] = [];
let working = false;
let reachable = false;
let procState = "UNKNOWN";
let busy: { kind: "starting" | "stopping"; since: string } | null = null;
let lastError: { message: string; at: string } | null = null;
let lastUsedAt = Date.now();
let currentJob: string | null = null;
let runningSize: string | null = null;

function patch(id: string, p: Partial<MidiRecord>) {
  mutateDb((db) => {
    const r = db.midi.find((x) => x.id === id);
    if (r) Object.assign(r, p, { updatedAt: now() });
  });
}

function readSizeFile(): string | null {
  try {
    return fs.readFileSync(config.midiModelFile, "utf8").trim() || null;
  } catch {
    return null;
  }
}

async function healthOk(timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function logTail(lines = 25): string {
  try {
    const buf = fs.readFileSync(config.midiLogFile, "utf8");
    return buf.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Pull the most useful line out of a failed MuScriptor start. */
function startFailureMessage(): string {
  const tail = logTail(60);
  if (/gated|GatedRepo|cannot download|401|403|accept the model licen/i.test(tail)) {
    return (
      `MuScriptor could not download its weights. Accept the licence at ` +
      `https://huggingface.co/MuScriptor/muscriptor-${readSizeFile() || "medium"} with the account that owns HF_TOKEN, then retry.`
    );
  }
  if (/out of memory/i.test(tail)) return "MuScriptor ran out of GPU memory while loading. Unload ACE-Step models and retry.";
  const last = tail.split("\n").filter((l) => /error|exception|Traceback/i.test(l)).slice(-2).join(" ");
  return `MuScriptor failed to start. ${last || "See /outputs/cache/muscriptor.log."}`.trim();
}

async function ensureServer(size: string, onStage: (s: string) => void): Promise<void> {
  fs.mkdirSync(path.dirname(config.midiModelFile), { recursive: true });
  const fileSize = readSizeFile();
  if (fileSize !== size) fs.writeFileSync(config.midiModelFile, size);

  reachable = await healthOk();
  if (reachable && (runningSize || fileSize) === size) {
    runningSize = size;
    return;
  }

  busy = { kind: "starting", since: now() };
  try {
    if (reachable) {
      onStage(`Switching MuScriptor to the ${size} model…`);
      await supervisorctl(["restart", config.midiProgram], 120000);
    } else {
      onStage(`Starting MuScriptor (${size}) — the first start downloads the model…`);
      await supervisorctl(["start", config.midiProgram], 120000).catch(async (e) => {
        // `start` blocks until RUNNING; a crash during load surfaces here.
        throw new Error(`${e?.message || e}\n${startFailureMessage()}`);
      });
    }
    const deadline = Date.now() + config.midiStartTimeoutMs;
    while (Date.now() < deadline) {
      if (await healthOk()) {
        reachable = true;
        runningSize = size;
        return;
      }
      procState = await programState(config.midiProgram);
      if (/FATAL|EXITED|BACKOFF|STOPPED/.test(procState)) throw new Error(startFailureMessage());
      await sleep(2000);
    }
    throw new Error("MuScriptor did not become ready in time. " + startFailureMessage());
  } finally {
    busy = null;
  }
}

/** Parse the SSE stream from POST /transcribe. */
async function streamTranscription(id: string, res: Response): Promise<void> {
  if (!res.body) throw new Error("MuScriptor returned an empty stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let noteCount = 0;
  let maxEnd = 0;
  let lastWrite = 0;
  let done = false;

  const handle = (ev: any) => {
    if (ev.type === "progress") {
      const p = ev.total > 0 ? ev.completed / ev.total : 0;
      if (Date.now() - lastWrite > 700 || ev.completed === ev.total) {
        lastWrite = Date.now();
        patch(id, { progress: Math.min(0.97, p), stage: `Transcribing chunk ${ev.completed}/${ev.total}`, noteCount });
      }
    } else if (ev.type === "start") {
      noteCount++;
    } else if (ev.type === "end") {
      if (typeof ev.end_time === "number") maxEnd = Math.max(maxEnd, ev.end_time);
    } else if (ev.type === "transcription_complete") {
      fs.mkdirSync(config.midiDir, { recursive: true });
      const midiPath = path.join(config.midiDir, `${id}.mid`);
      fs.writeFileSync(midiPath, Buffer.from(ev.data, "base64"));
      let quantizedMidiPath: string | undefined;
      if (ev.quantized_midi) {
        quantizedMidiPath = path.join(config.midiDir, `${id}.quantized.mid`);
        fs.writeFileSync(quantizedMidiPath, Buffer.from(ev.quantized_midi, "base64"));
      }
      patch(id, {
        status: "succeeded",
        progress: 1,
        stage: undefined,
        midiPath,
        quantizedMidiPath,
        noteCount,
        durationSeconds: Math.round(maxEnd * 10) / 10,
        beatGrid: ev.beat_grid ?? null,
        finishedAt: now(),
      });
      done = true;
    } else if (ev.type === "error" || ev.detail) {
      throw new Error(ev.detail || ev.message || "MuScriptor error");
    }
  };

  for (;;) {
    const { value, done: eof } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) handle(JSON.parse(data));
    }
    if (eof) break;
  }
  if (!done) throw new Error("Transcription stream ended before the MIDI file was produced.");
}

async function runJob(id: string): Promise<void> {
  const db = loadDb();
  const rec = db.midi.find((r) => r.id === id);
  if (!rec || rec.status === "succeeded" || rec.status === "failed") return;
  currentJob = id;
  const size = rec.modelSize || db.settings.midiModelSize;
  const setStage = (stage: string) => patch(id, { status: "starting", stage });

  try {
    if (!fs.existsSync(rec.sourceAudioPath)) throw new Error(`Source audio is missing: ${rec.sourceAudioPath}`);
    await ensureServer(size, setStage);
    patch(id, { status: "running", stage: "Transcribing…", progress: 0, startedAt: now() });

    const bytes = fs.readFileSync(rec.sourceAudioPath);
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.append("file", new Blob([bytes]), path.basename(rec.sourceAudioPath));
      for (const inst of rec.instruments || []) form.append("instruments", inst);
      form.append("detect_tempo", "best-effort");
      const res = await fetch(`${BASE()}/transcribe`, {
        method: "POST",
        body: form,
        headers: { "x-client-id": `juno-${id}` },
      });
      if (res.status === 503 && attempt < 60) {
        setStage("MuScriptor is busy — waiting…");
        await sleep(5000);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let detail = text;
        try {
          detail = JSON.parse(text).detail || text;
        } catch {
          /* raw */
        }
        throw new Error(`MuScriptor ${res.status}: ${detail}`);
      }
      await streamTranscription(id, res);
      break;
    }
    lastError = null;
    mutateDb((d) => addHistory(d, `Extracted MIDI from "${rec.title}"`));
  } catch (e: any) {
    const msg = e?.message || String(e);
    lastError = { message: msg, at: now() };
    patch(id, { status: "failed", error: msg, stage: undefined, finishedAt: now() });
    mutateDb((d) => addHistory(d, `MIDI extraction failed for "${rec.title}"`));
  } finally {
    currentJob = null;
    lastUsedAt = Date.now();
  }
}

async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length) await runJob(queue.shift()!);
  } finally {
    working = false;
  }
}

async function tick() {
  reachable = await healthOk(1500);
  if (!reachable && !busy) procState = await programState(config.midiProgram);
  if (reachable && !runningSize) runningSize = readSizeFile() || "medium";
  if (!reachable && !busy) runningSize = null;

  const mins = loadDb().settings.midiIdleStopMinutes;
  if (mins > 0 && reachable && !working && !busy && queue.length === 0 && Date.now() - lastUsedAt > mins * 60000) {
    await midiManager.stopServer(`idle ${mins} min`).catch(() => undefined);
  }
}

export const midiManager = {
  start() {
    // Resume anything interrupted by a proxy restart.
    const pending = loadDb().midi.filter((r) => r.status === "queued" || r.status === "starting" || r.status === "running");
    for (const r of pending) {
      patch(r.id, { status: "queued", progress: 0, stage: "Queued" });
      queue.push(r.id);
    }
    if (queue.length) void work();
    setInterval(() => void tick(), 5000);
    void tick();
  },

  enqueue(id: string) {
    queue.push(id);
    void work();
  },

  /** Start MuScriptor on demand, independently of any transcription job.
   *  Previously the only way to get it into VRAM was to run a transcription,
   *  which made "re-transcribe" fail confusingly when nothing was loaded. */
  async startServer(size?: string) {
    const { settings } = loadDb();
    const want = size || settings.midiModelSize;
    await ensureServer(want, (stage) => console.log(`[juno-proxy] muscriptor: ${stage}`));
  },

  async stopServer(reason: string) {
    if (working) throw new Error("A transcription is running.");
    busy = { kind: "stopping", since: now() };
    try {
      await supervisorctl(["stop", config.midiProgram], 60000);
      reachable = false;
      runningSize = null;
      mutateDb((d) => addHistory(d, `Stopped MuScriptor (${reason})`));
    } finally {
      busy = null;
    }
  },

  /** Queue position (0 = running now). */
  positionOf(id: string): number {
    if (currentJob === id) return 0;
    const i = queue.indexOf(id);
    return i < 0 ? -1 : i + 1;
  },

  status() {
    const { settings } = loadDb();
    let activity: "stopped" | "starting" | "ready" | "transcribing" | "stopping" | "error";
    if (busy?.kind === "starting") activity = "starting";
    else if (busy?.kind === "stopping") activity = "stopping";
    else if (currentJob) activity = "transcribing";
    else if (reachable) activity = "ready";
    else if (/FATAL|BACKOFF/.test(procState)) activity = "error";
    else activity = "stopped";
    const idleMs = settings.midiIdleStopMinutes * 60000;
    return {
      activity,
      reachable,
      process: procState,
      modelSize: runningSize,
      wantedSize: settings.midiModelSize,
      queued: queue.length,
      currentJob,
      lastError,
      stopAt: idleMs > 0 && reachable && !currentJob && queue.length === 0 ? new Date(lastUsedAt + idleMs).toISOString() : null,
    };
  },
};
