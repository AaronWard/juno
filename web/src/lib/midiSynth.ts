/** Lightweight General-MIDI-ish synthesizer + transport for the MIDI tab.
 *
 *  No soundfont download: each GM family gets a small oscillator/filter
 *  patch and drums are synthesized. It is meant for checking and editing a
 *  transcription (and rendering a quick WAV), not for final production —
 *  export the .mid to a DAW for that. The same voice code runs on a live
 *  AudioContext and an OfflineAudioContext, so "Render to WAV" matches what
 *  you hear.
 */
import { MNote, MTrack } from "./midiModel";

type Ctx = BaseAudioContext;
interface Voice {
  stop(when: number): void;
  end: number;
}

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noise(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

const hz = (p: number) => 440 * Math.pow(2, (p - 69) / 12);

interface Patch {
  waves: { type: OscillatorType; mult: number; gain: number; detune?: number }[];
  attack: number;
  decay: number; // time constant toward sustain
  sustain: number; // 0–1 of peak
  release: number;
  filter?: { freq: number; env?: number; q?: number };
  ring?: boolean; // keeps decaying (piano/pluck) instead of holding
}

function patchFor(program: number): Patch {
  const fam = program >> 3;
  switch (fam) {
    case 0: // piano
      return { waves: [{ type: "triangle", mult: 1, gain: 0.7 }, { type: "sine", mult: 2, gain: 0.25 }], attack: 0.004, decay: 0.9, sustain: 0.0, release: 0.25, filter: { freq: 5200 }, ring: true };
    case 1: // chromatic percussion
      return { waves: [{ type: "sine", mult: 1, gain: 0.7 }, { type: "sine", mult: 4.01, gain: 0.2 }], attack: 0.002, decay: 0.5, sustain: 0, release: 0.3, ring: true };
    case 2: // organ
      return { waves: [{ type: "sine", mult: 1, gain: 0.5 }, { type: "sine", mult: 2, gain: 0.3 }, { type: "square", mult: 4, gain: 0.06 }], attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.08 };
    case 3: // guitar
      return { waves: [{ type: "sawtooth", mult: 1, gain: 0.45 }, { type: "triangle", mult: 1, gain: 0.3, detune: 6 }], attack: 0.003, decay: 0.6, sustain: 0.05, release: 0.2, filter: { freq: 900, env: 3500, q: 1.5 }, ring: true };
    case 4: // bass
      return { waves: [{ type: "triangle", mult: 1, gain: 0.8 }, { type: "sine", mult: 0.5, gain: 0.4 }], attack: 0.005, decay: 0.5, sustain: 0.55, release: 0.12, filter: { freq: 1100 } };
    case 5: // strings
    case 6: // ensemble
      return { waves: [{ type: "sawtooth", mult: 1, gain: 0.3, detune: -7 }, { type: "sawtooth", mult: 1, gain: 0.3, detune: 7 }], attack: 0.09, decay: 0.3, sustain: 0.85, release: 0.35, filter: { freq: 2600, q: 0.7 } };
    case 7: // brass
      return { waves: [{ type: "sawtooth", mult: 1, gain: 0.5 }], attack: 0.03, decay: 0.25, sustain: 0.75, release: 0.15, filter: { freq: 700, env: 2800, q: 1 } };
    case 8: // reed
      return { waves: [{ type: "square", mult: 1, gain: 0.35 }, { type: "sine", mult: 2, gain: 0.15 }], attack: 0.03, decay: 0.2, sustain: 0.8, release: 0.12, filter: { freq: 2200 } };
    case 9: // pipe
      return { waves: [{ type: "sine", mult: 1, gain: 0.7 }, { type: "triangle", mult: 2, gain: 0.12 }], attack: 0.04, decay: 0.2, sustain: 0.85, release: 0.15 };
    case 10: // synth lead
      return { waves: [{ type: "square", mult: 1, gain: 0.3, detune: -5 }, { type: "sawtooth", mult: 1, gain: 0.25, detune: 5 }], attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.12, filter: { freq: 3200 } };
    case 11: // pad
      return { waves: [{ type: "sawtooth", mult: 1, gain: 0.22, detune: -10 }, { type: "sawtooth", mult: 1, gain: 0.22, detune: 10 }, { type: "sine", mult: 0.5, gain: 0.2 }], attack: 0.35, decay: 0.5, sustain: 0.8, release: 0.7, filter: { freq: 1600 } };
    default:
      return { waves: [{ type: "triangle", mult: 1, gain: 0.6 }], attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.15 };
  }
}

function tonalVoice(ctx: Ctx, dest: AudioNode, pitch: number, vel: number, t0: number, dur: number, program: number): Voice {
  const p = patchFor(program);
  const amp = ctx.createGain();
  const peak = 0.16 * (0.25 + 0.75 * vel);
  const noteEnd = t0 + Math.max(0.03, dur);
  const hold = p.ring ? Math.min(noteEnd, t0 + 4) : noteEnd;
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(peak, t0 + p.attack);
  amp.gain.setTargetAtTime(peak * Math.max(p.sustain, 0.0001), t0 + p.attack, p.decay / 3);
  amp.gain.setTargetAtTime(0, hold, p.release / 4);
  const end = hold + p.release * 1.5;

  let out: AudioNode = amp;
  if (p.filter) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = p.filter.q ?? 0.5;
    const base = Math.min(p.filter.freq + hz(pitch) * 1.5, 16000);
    if (p.filter.env) {
      f.frequency.setValueAtTime(base + p.filter.env * vel, t0);
      f.frequency.setTargetAtTime(base, t0 + 0.01, 0.12);
    } else f.frequency.value = base;
    amp.connect(f);
    out = f;
  }
  out.connect(dest);

  const oscs = p.waves.map((w) => {
    const o = ctx.createOscillator();
    o.type = w.type;
    o.frequency.value = hz(pitch) * w.mult;
    if (w.detune) o.detune.value = w.detune;
    const g = ctx.createGain();
    g.gain.value = w.gain;
    o.connect(g).connect(amp);
    o.start(t0);
    o.stop(end);
    return o;
  });
  return {
    end,
    stop(when: number) {
      amp.gain.cancelScheduledValues(when);
      amp.gain.setTargetAtTime(0, when, 0.015);
      for (const o of oscs) {
        try {
          o.stop(when + 0.08);
        } catch {
          /* already stopped */
        }
      }
    },
  };
}

function drumVoice(ctx: Ctx, dest: AudioNode, pitch: number, vel: number, t0: number): Voice {
  const g = ctx.createGain();
  g.connect(dest);
  const level = 0.35 * (0.3 + 0.7 * vel);
  const nodes: AudioScheduledSourceNode[] = [];
  let len = 0.2;

  const noiseHit = (hp: number, decay: number, gain: number, bp = false) => {
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = bp ? "bandpass" : "highpass";
    f.frequency.value = hp;
    const e = ctx.createGain();
    e.gain.setValueAtTime(gain * level, t0);
    e.gain.exponentialRampToValueAtTime(0.0008, t0 + decay);
    s.connect(f).connect(e).connect(g);
    s.start(t0);
    s.stop(t0 + decay + 0.05);
    nodes.push(s);
    len = Math.max(len, decay);
  };
  const toneHit = (from: number, to: number, decay: number, gain: number, type: OscillatorType = "sine") => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + decay * 0.6);
    const e = ctx.createGain();
    e.gain.setValueAtTime(gain * level, t0);
    e.gain.exponentialRampToValueAtTime(0.0008, t0 + decay);
    o.connect(e).connect(g);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
    nodes.push(o);
    len = Math.max(len, decay);
  };

  if (pitch === 35 || pitch === 36) toneHit(150, 42, 0.38, 1.4);
  else if (pitch === 38 || pitch === 40 || pitch === 37) {
    noiseHit(1400, 0.18, 0.9);
    toneHit(220, 160, 0.1, 0.5, "triangle");
  } else if (pitch === 39) noiseHit(1200, 0.12, 1.1, true);
  else if (pitch === 42 || pitch === 44) noiseHit(7500, 0.05, 0.5);
  else if (pitch === 46) noiseHit(7000, 0.32, 0.45);
  else if ([41, 43, 45, 47, 48, 50].includes(pitch)) {
    const f = 80 + (pitch - 41) * 18;
    toneHit(f * 1.6, f, 0.3, 1.0);
  } else if ([49, 52, 55, 57].includes(pitch)) noiseHit(4500, 1.1, 0.4);
  else if ([51, 53, 59].includes(pitch)) {
    noiseHit(6000, 0.6, 0.25);
    toneHit(3200, 3100, 0.4, 0.08, "square");
  } else noiseHit(3000, 0.08, 0.5);

  return {
    end: t0 + len + 0.05,
    stop(when: number) {
      g.gain.setTargetAtTime(0, when, 0.01);
      for (const n of nodes) {
        try {
          n.stop(when + 0.05);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function playNote(ctx: Ctx, dest: AudioNode, n: MNote, tr: MTrack | undefined, t0: number, dur: number): Voice {
  return tr?.drums ? drumVoice(ctx, dest, n.pitch, n.vel, t0) : tonalVoice(ctx, dest, n.pitch, n.vel, t0, dur, tr?.program ?? 0);
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export class MidiPlayer {
  readonly ctx: AudioContext;
  private master: GainNode;
  private midiBus: GainNode;
  private audioBus: GainNode;
  private trackGains = new Map<number, GainNode>();
  private notes: MNote[] = [];
  private tracks: MTrack[] = [];
  private voices = new Set<Voice>();
  private timer: number | null = null;
  private startCtxTime = 0;
  private startPos = 0;
  private nextIdx = 0;
  private audioSrc: AudioBufferSourceNode | null = null;
  audioBuffer: AudioBuffer | null = null;
  playing = false;
  duration = 0;
  onEnd?: () => void;
  private pausedAt = 0;
  private muted = new Set<number>();
  private soloed = new Set<number>();

  constructor() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.midiBus = this.ctx.createGain();
    this.audioBus = this.ctx.createGain();
    this.audioBus.gain.value = 0;
    this.midiBus.connect(this.master);
    this.audioBus.connect(this.master);
  }

  get position(): number {
    if (!this.playing) return this.pausedAt;
    return this.startPos + (this.ctx.currentTime - this.startCtxTime);
  }

  setContent(notes: MNote[], tracks: MTrack[], duration: number) {
    this.notes = [...notes].sort((a, b) => a.start - b.start);
    this.tracks = tracks;
    this.duration = Math.max(duration, this.audioBuffer?.duration ?? 0);
    for (const t of tracks) this.gainFor(t.index);
    this.applyMix();
    if (this.playing) this.nextIdx = this.indexAt(this.position);
  }

  setAudio(buf: AudioBuffer | null) {
    this.audioBuffer = buf;
    if (buf) this.duration = Math.max(this.duration, buf.duration);
  }

  setMidiVolume(v: number) {
    this.midiBus.gain.value = v;
  }

  setAudioVolume(v: number) {
    this.audioBus.gain.value = v;
  }

  setMuteSolo(muted: Set<number>, soloed: Set<number>) {
    this.muted = new Set(muted);
    this.soloed = new Set(soloed);
    this.applyMix();
  }

  private applyMix() {
    for (const [i, g] of this.trackGains) {
      const audible = this.soloed.size ? this.soloed.has(i) : !this.muted.has(i);
      g.gain.setTargetAtTime(audible ? 1 : 0, this.ctx.currentTime, 0.01);
    }
  }

  private gainFor(track: number): GainNode {
    let g = this.trackGains.get(track);
    if (!g) {
      g = this.ctx.createGain();
      g.connect(this.midiBus);
      this.trackGains.set(track, g);
      this.applyMix();
    }
    return g;
  }

  private indexAt(t: number): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].start < t - 0.001) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  async play(from?: number) {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.stopVoices();
    const pos = Math.max(0, Math.min(from ?? this.pausedAt, this.duration));
    this.startPos = pos >= this.duration - 0.05 ? 0 : pos;
    this.startCtxTime = this.ctx.currentTime + 0.05;
    this.nextIdx = this.indexAt(this.startPos);
    this.playing = true;
    if (this.audioBuffer && this.startPos < this.audioBuffer.duration) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.audioBuffer;
      s.connect(this.audioBus);
      s.start(this.startCtxTime, this.startPos);
      this.audioSrc = s;
    }
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = Math.min(this.position, this.duration);
    this.halt();
  }

  stop() {
    this.pausedAt = 0;
    this.halt();
  }

  seek(t: number) {
    const was = this.playing;
    this.pausedAt = Math.max(0, Math.min(t, this.duration));
    if (was) void this.play(this.pausedAt);
  }

  private halt() {
    this.playing = false;
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
    this.stopVoices();
    try {
      this.audioSrc?.stop();
    } catch {
      /* ignore */
    }
    this.audioSrc = null;
  }

  private stopVoices() {
    const t = this.ctx.currentTime;
    for (const v of this.voices) v.stop(t);
    this.voices.clear();
  }

  private tick() {
    const pos = this.position;
    const horizon = pos + 0.2;
    while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].start < horizon) {
      const n = this.notes[this.nextIdx++];
      if (n.start < pos - 0.05) continue;
      const tr = this.tracks.find((t) => t.index === n.track);
      const when = this.startCtxTime + (n.start - this.startPos);
      const v = playNote(this.ctx, this.gainFor(n.track), n, tr, Math.max(this.ctx.currentTime, when), n.dur);
      this.voices.add(v);
    }
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.end < now) this.voices.delete(v);
    if (pos >= this.duration + 0.1) {
      this.stop();
      this.onEnd?.();
    }
  }

  /** Audition a single note (clicking keys / placing notes). */
  async preview(pitch: number, track: MTrack | undefined, vel = 0.8) {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const n: MNote = { id: -1, track: track?.index ?? 0, pitch, start: 0, dur: 0.35, vel };
    playNote(this.ctx, track ? this.gainFor(track.index) : this.midiBus, n, track, this.ctx.currentTime + 0.01, 0.35);
  }

  dispose() {
    this.halt();
    void this.ctx.close();
  }
}

/** Render notes to an AudioBuffer offline (for "Render to WAV"). */
export async function renderOffline(
  notes: MNote[],
  tracks: MTrack[],
  duration: number,
  mute: (track: number) => boolean = () => false
): Promise<AudioBuffer> {
  const sr = 44100;
  const len = Math.ceil((duration + 2) * sr);
  const ctx = new OfflineAudioContext(2, len, sr);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  for (const n of notes) {
    if (mute(n.track)) continue;
    const tr = tracks.find((t) => t.index === n.track);
    playNote(ctx, comp, n, tr, n.start, n.dur);
  }
  return await ctx.startRendering();
}
