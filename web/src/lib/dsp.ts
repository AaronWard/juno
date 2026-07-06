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
