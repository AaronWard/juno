/** Real client-side audio processing (Web Audio API).
 *
 *  Reverse, Crop, Remove Section, Adjust Speed, Sample and Mashup no longer
 *  create metadata-only placeholder rows: the audio is decoded in the
 *  browser, processed sample-by-sample (or through an OfflineAudioContext),
 *  encoded to 16-bit WAV and saved via /api/upload so the result is a real,
 *  playable, downloadable library track.
 */

let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!sharedCtx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    sharedCtx = new AC();
  }
  return sharedCtx;
}

/** Fetch and decode an audio URL into an AudioBuffer. */
export async function loadBuffer(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio fetch failed (${res.status})`);
  const data = await res.arrayBuffer();
  return await ctx().decodeAudioData(data);
}

function blank(channels: number, length: number, sampleRate: number): AudioBuffer {
  return ctx().createBuffer(Math.max(1, channels), Math.max(1, length), sampleRate);
}

/** Reverse the whole buffer. */
export function reverseBuffer(buf: AudioBuffer): AudioBuffer {
  const out = blank(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    const n = src.length;
    for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

/** Keep only [startSec, endSec]. */
export function cropBuffer(buf: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const s = Math.max(0, Math.floor(startSec * buf.sampleRate));
  const e = Math.min(buf.length, Math.ceil(endSec * buf.sampleRate));
  if (e <= s) throw new Error("Selection is empty");
  const out = blank(buf.numberOfChannels, e - s, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.getChannelData(c).set(buf.getChannelData(c).subarray(s, e));
  }
  return out;
}

/** Remove [startSec, endSec] and join the remainder. */
export function removeSection(buf: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const s = Math.max(0, Math.floor(startSec * buf.sampleRate));
  const e = Math.min(buf.length, Math.ceil(endSec * buf.sampleRate));
  if (e <= s) throw new Error("Selection is empty");
  const outLen = buf.length - (e - s);
  if (outLen < 1) throw new Error("Cannot remove the entire song");
  const out = blank(buf.numberOfChannels, outLen, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, s), 0);
    dst.set(src.subarray(e), s);
  }
  return out;
}

/** Change playback speed. NOTE: this is a resample-style speed change,
 *  so pitch shifts with speed (real time-stretch with pitch preservation
 *  needs a phase vocoder and is out of scope for the offline build). */
export async function changeSpeed(buf: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const r = Math.min(4, Math.max(0.25, rate));
  const length = Math.max(1, Math.ceil(buf.length / r));
  const off = new OfflineAudioContext(buf.numberOfChannels, length, buf.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = r;
  src.connect(off.destination);
  src.start(0);
  return await off.startRendering();
}

/* ------------------------------------------------------------------ */
/* Time-stretching (keep-pitch speed changes)                          */
/* ------------------------------------------------------------------ */

/** WSOLA — Waveform Similarity Overlap-Add.
 *
 *  Changes duration WITHOUT changing pitch, which is what "keep pitch" means:
 *  a resample moves both together like a turntable, while this resequences
 *  overlapping grains of the original waveform so every sample keeps its
 *  original frequency content.
 *
 *  Why WSOLA rather than a phase vocoder: a phase vocoder needs an FFT per
 *  frame plus phase-gradient integration, and its characteristic failure on
 *  music is a smeared, "phasey" transient — exactly wrong for the percussive
 *  material Juno generates. WSOLA works in the time domain, keeps transients
 *  intact, and is a few hundred lines lighter. Its own failure mode is a slight
 *  warble on sustained pure tones, which is the better trade here.
 *
 *  The similarity search is the "WS" part: for each output grain we look within
 *  ±`seek` samples of the ideal input position for the offset whose waveform
 *  best matches the tail of what we already wrote, then cross-fade. Without the
 *  search this degrades to plain OLA, which clicks audibly at every grain.
 *
 *  `stretch` is the OUTPUT/INPUT duration ratio: 2.0 = twice as long (half
 *  speed), 0.5 = half as long (double speed).
 */
export function timeStretch(buf: AudioBuffer, stretch: number): AudioBuffer {
  const ratio = Math.min(4, Math.max(0.25, stretch));
  if (Math.abs(ratio - 1) < 0.001) return buf;

  const sr = buf.sampleRate;
  const channels = buf.numberOfChannels;
  // ~60 ms grains: long enough to hold a low-frequency period, short enough
  // that the similarity search stays cheap and transients are not duplicated.
  const grain = Math.round(sr * 0.06);
  const overlap = Math.round(grain / 2);
  const hopOut = grain - overlap;
  const hopIn = Math.max(1, Math.round(hopOut / ratio));
  const seek = Math.round(sr * 0.015); // ±15 ms similarity search window

  const outLength = Math.max(1, Math.ceil(buf.length * ratio) + grain);
  const out = blank(channels, outLength, sr);

  // Hann cross-fade ramps, precomputed once.
  const fadeIn = new Float32Array(overlap);
  const fadeOut = new Float32Array(overlap);
  for (let i = 0; i < overlap; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / (overlap - 1 || 1));
    fadeIn[i] = w;
    fadeOut[i] = 1 - w;
  }

  // The similarity search runs ONCE on a mono mixdown and the winning offset is
  // applied to every channel. Searching per channel would let left and right
  // drift apart and collapse the stereo image.
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) mono[i] += d[i] / channels;
  }

  const src: Float32Array[] = [];
  const dst: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    src.push(buf.getChannelData(c));
    dst.push(out.getChannelData(c));
  }

  let inPos = 0;
  let outPos = 0;
  // The tail we want the next grain to continue from.
  let template: Float32Array | null = null;

  while (inPos + grain < buf.length && outPos + grain < outLength) {
    let best = inPos;

    if (template) {
      let bestScore = -Infinity;
      const lo = Math.max(0, inPos - seek);
      const hi = Math.min(buf.length - grain - 1, inPos + seek);
      // Cross-correlation, subsampled by 4: at 48 kHz that is still ~180
      // comparison points per candidate, and it makes the search ~4x cheaper
      // with no audible difference.
      for (let cand = lo; cand <= hi; cand += 2) {
        let score = 0;
        for (let i = 0; i < overlap; i += 4) score += mono[cand + i] * template[i];
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }

    for (let c = 0; c < channels; c++) {
      const s = src[c];
      const d = dst[c];
      // Cross-fade the overlap region with whatever is already written.
      for (let i = 0; i < overlap; i++) {
        d[outPos + i] = d[outPos + i] * fadeOut[i] + s[best + i] * fadeIn[i];
      }
      // Copy the rest of the grain straight through.
      for (let i = overlap; i < grain; i++) {
        d[outPos + i] = s[best + i];
      }
    }

    template = mono.slice(best + hopOut, best + hopOut + overlap);
    inPos = best + hopIn;
    outPos += hopOut;
  }

  // Trim the trailing silence the +grain margin left behind.
  const used = Math.min(outLength, outPos + grain);
  if (used >= outLength) return out;
  const trimmed = blank(channels, used, sr);
  for (let c = 0; c < channels; c++) {
    trimmed.getChannelData(c).set(out.getChannelData(c).subarray(0, used));
  }
  return trimmed;
}

/** Speed change that preserves pitch. `rate` matches `changeSpeed`:
 *  1.5 = 1.5x faster, 0.8 = slower. */
export function changeSpeedKeepPitch(buf: AudioBuffer, rate: number): AudioBuffer {
  const r = Math.min(4, Math.max(0.25, rate));
  const stretched = timeStretch(buf, 1 / r);
  // The similarity search drifts by a fraction of a grain per hop, so the raw
  // result lands ~1-3% long. Trim to the exact target so "0.8x" really is
  // 1/0.8 of the original and stays in sync with anything cut against it.
  const target = Math.max(1, Math.round(buf.length / r));
  if (stretched.length <= target) return stretched;
  const out = blank(stretched.numberOfChannels, target, stretched.sampleRate);
  for (let c = 0; c < stretched.numberOfChannels; c++) {
    out.getChannelData(c).set(stretched.getChannelData(c).subarray(0, target));
  }
  return out;
}

/** Blend two buffers: 0 = all A, 100 = all B. Output length = the longer. */
export function mixBuffers(a: AudioBuffer, b: AudioBuffer, blendPct: number): AudioBuffer {
  const blend = Math.min(100, Math.max(0, blendPct)) / 100;
  const rate = a.sampleRate; // decodeAudioData resamples to context rate
  const channels = Math.max(a.numberOfChannels, b.numberOfChannels);
  const length = Math.max(a.length, b.length);
  const out = blank(channels, length, rate);
  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    const ca = a.getChannelData(Math.min(c, a.numberOfChannels - 1));
    const cb = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
    for (let i = 0; i < length; i++) {
      const va = i < ca.length ? ca[i] : 0;
      const vb = i < cb.length ? cb[i] : 0;
      dst[i] = va * (1 - blend) + vb * blend;
    }
  }
  // soft clip guard
  const peak = channels
    ? Math.max(
        ...Array.from({ length: channels }, (_, c) => {
          let m = 0;
          const d = out.getChannelData(c);
          for (let i = 0; i < d.length; i += 97) m = Math.max(m, Math.abs(d[i]));
          return m;
        })
      )
    : 1;
  if (peak > 1) {
    const g = 0.98 / peak;
    for (let c = 0; c < channels; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
  }
  return out;
}

/** Extract the loudest `windowSec` window (RMS scan, 0.5 s hop) — a real
 *  "Sample this song" instead of a copied placeholder row. */
export function extractSample(buf: AudioBuffer, windowSec = 10): AudioBuffer {
  const win = Math.min(buf.length, Math.floor(windowSec * buf.sampleRate));
  if (win >= buf.length) return cropBuffer(buf, 0, buf.duration);
  const hop = Math.floor(buf.sampleRate / 2);
  const mono = buf.getChannelData(0);
  let bestStart = 0;
  let bestEnergy = -1;
  for (let s = 0; s + win <= buf.length; s += hop) {
    let energy = 0;
    for (let i = s; i < s + win; i += 32) energy += mono[i] * mono[i];
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = s;
    }
  }
  return cropBuffer(buf, bestStart / buf.sampleRate, (bestStart + win) / buf.sampleRate);
}

/** Normalized peak heights for waveform rendering. */
export function computePeaks(buf: AudioBuffer, bars: number): number[] {
  const data = buf.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < bars; b++) {
    let p = 0;
    const start = b * block;
    const end = Math.min(data.length, start + block);
    for (let i = start; i < end; i += 8) p = Math.max(p, Math.abs(data[i]));
    peaks.push(p);
    max = Math.max(max, p);
  }
  return peaks.map((p) => Math.max(0.05, max > 0 ? p / max : 0.05));
}

/** Encode an AudioBuffer as a 16-bit PCM WAV blob. */
export function bufferToWavBlob(buf: AudioBuffer): Blob {
  const channels = buf.numberOfChannels;
  const rate = buf.sampleRate;
  const frames = buf.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const arr = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arr);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([arr], { type: "audio/wav" });
}

/** Convenience: AudioBuffer → File ready for /api/upload. */
export function bufferToFile(buf: AudioBuffer, name: string): File {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  return new File([bufferToWavBlob(buf)], `${safe}.wav`, { type: "audio/wav" });
}

/** Trigger a browser download of a song's audio. */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Audition a speed change before committing to it.
 *
 *  Uses the same resample-style rate change as `changeSpeed`, so what you hear
 *  is what gets rendered (pitch moves with speed). Returns a stop function.
 */
export async function previewSpeed(
  url: string,
  rate: number,
  keepPitch: boolean,
  onEnd?: () => void
): Promise<() => void> {
  const buf = await loadBuffer(url);
  const c = ctx();
  if (c.state === "suspended") await c.resume();
  const r = Math.min(4, Math.max(0.25, rate));

  // Preview from ~20% in: intros are often sparse and a speed change is much
  // easier to judge over the body of the track.
  const start = Math.min(buf.duration * 0.2, Math.max(0, buf.duration - 12));
  const src = c.createBufferSource();

  if (keepPitch) {
    // Time-stretching is O(n) over the whole buffer, so stretch only the slice
    // we are about to play — a 12 s excerpt instead of a 4-minute song.
    const excerpt = cropBuffer(buf, start, Math.min(start + 12, buf.duration));
    src.buffer = changeSpeedKeepPitch(excerpt, r);
    src.playbackRate.value = 1;
    src.connect(c.destination);
    src.onended = () => onEnd?.();
    src.start(0);
  } else {
    src.buffer = buf;
    src.playbackRate.value = r;
    src.connect(c.destination);
    src.onended = () => onEnd?.();
    src.start(0, start, Math.min(12 * r, buf.duration - start));
  }

  return () => {
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
  };
}
