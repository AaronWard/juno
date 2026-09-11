/** MIDI document model for the MIDI tab.
 *
 *  Parsing/writing uses @tonejs/midi. Saving re-parses the ORIGINAL bytes
 *  and swaps only the notes, so the tempo map, PPQ, time signatures,
 *  program changes and controllers MuScriptor wrote are preserved.
 */
import { Midi } from "@tonejs/midi";

export interface MNote {
  id: number;
  track: number;
  pitch: number;
  /** seconds */
  start: number;
  /** seconds */
  dur: number;
  /** 0–1 */
  vel: number;
}

export interface MTrack {
  index: number;
  name: string;
  program: number;
  channel: number;
  drums: boolean;
  color: string;
  noteCount: number;
}

export interface MidiDoc {
  bytes: Uint8Array;
  midi: Midi;
  tracks: MTrack[];
  notes: MNote[];
  duration: number;
  bpm: number;
  beatsPerBar: number;
  ppq: number;
}

/** Distinct, readable on the dark UI; accent pink first to match Juno. */
export const TRACK_COLORS = [
  "#ff4db8", "#4dd0ff", "#ffc94d", "#7cf29a", "#b48cff", "#ff8a4d",
  "#4dffd6", "#ff5c7a", "#c6f24d", "#6c8cff", "#f24dff", "#4dff7c",
];

let nextId = 1;
export const newNoteId = () => nextId++;

export function parseMidi(buf: ArrayBuffer | Uint8Array): MidiDoc {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const midi = new Midi(bytes);
  const tracks: MTrack[] = [];
  const notes: MNote[] = [];
  midi.tracks.forEach((t, i) => {
    const drums = t.channel === 9 || t.instrument.percussion;
    tracks.push({
      index: i,
      name: t.name?.trim() || (drums ? "Drums" : prettyInstrument(t.instrument.name)) || `Track ${i + 1}`,
      program: t.instrument.number || 0,
      channel: t.channel,
      drums,
      color: TRACK_COLORS[i % TRACK_COLORS.length],
      noteCount: t.notes.length,
    });
    for (const n of t.notes) {
      notes.push({ id: newNoteId(), track: i, pitch: n.midi, start: n.time, dur: Math.max(0.01, n.duration), vel: n.velocity });
    }
  });
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const bpm = midi.header.tempos[0]?.bpm || 120;
  const ts = midi.header.timeSignatures[0]?.timeSignature;
  return {
    bytes,
    midi,
    tracks,
    notes,
    duration: Math.max(1, ...notes.map((n) => n.start + n.dur)),
    bpm: Math.round(bpm * 10) / 10,
    beatsPerBar: ts?.[0] || 4,
    ppq: midi.header.ppq || 480,
  };
}

/** Write notes back into a copy of the original file. */
export function serializeMidi(doc: MidiDoc, notes: MNote[]): Uint8Array {
  const out = new Midi(doc.bytes);
  out.tracks.forEach((t) => (t.notes = []));
  // Tracks created in the editor beyond what the file had.
  const maxTrack = Math.max(-1, ...notes.map((n) => n.track));
  while (out.tracks.length <= maxTrack) {
    const t = out.addTrack();
    const meta = doc.tracks[out.tracks.length - 1];
    if (meta) {
      t.name = meta.name;
      t.channel = meta.channel;
      t.instrument.number = meta.program;
    }
  }
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  for (const n of sorted) {
    out.tracks[n.track].addNote({
      midi: clamp(Math.round(n.pitch), 0, 127),
      time: Math.max(0, n.start),
      duration: Math.max(0.01, n.dur),
      velocity: clamp(n.vel, 0.01, 1),
    });
  }
  return out.toArray();
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

export type SnapValue = "off" | "bar" | "1/4" | "1/8" | "1/16" | "1/32" | "1/8T" | "1/16T";
export const SNAP_OPTIONS: { id: SnapValue; label: string }[] = [
  { id: "off", label: "Snap off" },
  { id: "bar", label: "Bar" },
  { id: "1/4", label: "1/4 (beat)" },
  { id: "1/8", label: "1/8" },
  { id: "1/8T", label: "1/8 triplet" },
  { id: "1/16", label: "1/16" },
  { id: "1/16T", label: "1/16 triplet" },
  { id: "1/32", label: "1/32" },
];

function stepTicks(doc: MidiDoc, snap: SnapValue): number {
  const q = doc.ppq; // ticks per quarter
  switch (snap) {
    case "bar":
      return q * doc.beatsPerBar;
    case "1/4":
      return q;
    case "1/8":
      return q / 2;
    case "1/8T":
      return q / 3;
    case "1/16":
      return q / 4;
    case "1/16T":
      return q / 6;
    case "1/32":
      return q / 8;
    default:
      return 0;
  }
}

/** Snap a time (seconds) to the tempo-aware grid. */
export function snapTime(doc: MidiDoc, t: number, snap: SnapValue): number {
  const step = stepTicks(doc, snap);
  if (!step) return Math.max(0, t);
  const h = doc.midi.header;
  const ticks = h.secondsToTicks(Math.max(0, t));
  return h.ticksToSeconds(Math.round(ticks / step) * step);
}

/** Length of one snap step starting at time t (seconds). */
export function snapStepSeconds(doc: MidiDoc, t: number, snap: SnapValue): number {
  const step = stepTicks(doc, snap === "off" ? "1/16" : snap);
  const h = doc.midi.header;
  const t0 = h.secondsToTicks(Math.max(0, t));
  return Math.max(0.01, h.ticksToSeconds(t0 + step) - h.ticksToSeconds(t0));
}

/** Beat lines within [from, to] seconds: {t, bar}. */
export function beatLines(doc: MidiDoc, from: number, to: number, sub = 1): { t: number; bar: boolean; beat: boolean }[] {
  const h = doc.midi.header;
  const step = doc.ppq / sub;
  const startTick = Math.max(0, Math.floor(h.secondsToTicks(Math.max(0, from)) / step) * step);
  const endTick = h.secondsToTicks(Math.max(0, to));
  const out: { t: number; bar: boolean; beat: boolean }[] = [];
  const barTicks = doc.ppq * doc.beatsPerBar;
  for (let k = startTick; k <= endTick && out.length < 4000; k += step) {
    out.push({ t: h.ticksToSeconds(k), bar: k % barTicks === 0, beat: k % doc.ppq === 0 });
  }
  return out;
}

/** Bar.beat label for a time. */
export function barBeat(doc: MidiDoc, t: number): string {
  const ticks = doc.midi.header.secondsToTicks(Math.max(0, t));
  const beat = ticks / doc.ppq;
  const bar = Math.floor(beat / doc.beatsPerBar) + 1;
  const b = Math.floor(beat % doc.beatsPerBar) + 1;
  return `${bar}.${b}`;
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const isBlackKey = (p: number) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
export const noteName = (p: number) => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;

const DRUM_NAMES: Record<number, string> = {
  35: "Kick 2", 36: "Kick", 37: "Side stick", 38: "Snare", 39: "Clap", 40: "Snare 2", 41: "Low tom",
  42: "Closed hat", 43: "Low tom 2", 44: "Pedal hat", 45: "Mid tom", 46: "Open hat", 47: "Mid tom 2",
  48: "High tom", 49: "Crash", 50: "High tom 2", 51: "Ride", 52: "China", 53: "Ride bell", 54: "Tambourine",
  55: "Splash", 56: "Cowbell", 57: "Crash 2", 59: "Ride 2",
};
export const drumName = (p: number) => DRUM_NAMES[p] || `Drum ${p}`;

function prettyInstrument(s?: string) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
